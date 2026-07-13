import type {
  PollResult,
  SignalEvent,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import {
  computeDedupeKey,
  DEFAULT_SIGNAL_TTL,
  type CalendarPayload,
} from "@electron/shared/domain/market-signal";
import type {
  ISignalSource,
  SignalSourceActivityEntry,
  SignalSourceSnapshot,
} from "../ISignalSource";
import { createLogger } from "../../infra/log";
import type { CalendarEventsRepo } from "../../../db/repositories/signals/calendar-events-repo";
import { MACRO_CALENDAR_SEED_2026_2027 } from "./macro-calendar-seed";

type CalendarSourceConfig = {
  pollIntervalMinutes?: number;
  /** Hours ahead to emit upcoming events. */
  lookaheadHours?: number;
  /** Fetch earnings from a free JSON endpoint when set. */
  earningsApiUrl?: string;
  symbols?: string[];
};

/**
 * Emits calendar_event signals for upcoming earnings + seeded macro events
 * (FOMC/CPI). Primary consumer is the risk-gate blackout; secondary is the
 * Dashboard attention queue.
 */
export class CalendarSource implements ISignalSource {
  readonly type = "calendar" as const;
  status: SignalSourceRuntimeStatus = "idle";
  lastError: string | null = null;
  private handlers = new Set<(event: SignalEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: CalendarSourceConfig;
  private seenKeys = new Set<string>();
  private lastPollAt: string | null = null;
  private lastPollResult: PollResult | null = null;
  private lastSignalAt: string | null = null;
  private lastSignalTicker: string | null = null;
  private recentActivity: SignalSourceActivityEntry[] = [];
  private readonly logger = createLogger("calendar-source");
  private seeded = false;

  constructor(
    public readonly id: string,
    configJson: string,
    private readonly calendarRepo: CalendarEventsRepo,
  ) {
    this.config = safeParseConfig(configJson);
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.status = "running";
    this.lastError = null;
    this.ensureMacroSeed();
    await this.pollOnce();
    const intervalMs = Math.max(
      60_000,
      (this.config.pollIntervalMinutes ?? 60) * 60_000,
    );
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status = "paused";
  }

  async restart(newConfig: Record<string, unknown>): Promise<void> {
    this.status = "restarting";
    this.config = safeParseConfig(JSON.stringify(newConfig));
    this.seenKeys.clear();
    await this.stop();
    await this.start();
  }

  async test(): Promise<PollResult> {
    const synthetic = this.buildSyntheticEvent();
    for (const handler of this.handlers) handler(synthetic);
    return { detected: 1, passed: 1, dropped: 0, errors: [] };
  }

  snapshot(): SignalSourceSnapshot {
    return {
      lastPollAt: this.lastPollAt,
      lastPollResult: this.lastPollResult,
      lastSignalAt: this.lastSignalAt,
      lastSignalTicker: this.lastSignalTicker,
      recentActivity: [...this.recentActivity],
    };
  }

  onSignal(handler: (event: SignalEvent) => void): void {
    this.handlers.add(handler);
  }

  offSignal(handler: (event: SignalEvent) => void): void {
    this.handlers.delete(handler);
  }

  private ensureMacroSeed(): void {
    if (this.seeded) return;
    this.calendarRepo.seedMacroEvents(MACRO_CALENDAR_SEED_2026_2027);
    this.seeded = true;
  }

  private async pollOnce(): Promise<PollResult> {
    const polledAt = new Date().toISOString();
    const result: PollResult = {
      detected: 0,
      passed: 0,
      dropped: 0,
      errors: [],
    };

    try {
      await this.ingestEarningsIfConfigured();
      const lookaheadHours = this.config.lookaheadHours ?? 72;
      const upcoming = this.calendarRepo.listUpcoming({
        withinHours: lookaheadHours,
        symbols: this.config.symbols,
      });
      result.detected = upcoming.length;
      for (const row of upcoming) {
        const payload: CalendarPayload = {
          eventType: row.eventType as CalendarPayload["eventType"],
          scheduledAt: row.scheduledAt,
          symbol: row.symbol ?? undefined,
          title: row.title ?? undefined,
          source: row.source,
        };
        const dedupeKey = computeDedupeKey("calendar_event", {
          type: payload.eventType,
          at: payload.scheduledAt,
          symbol: payload.symbol ?? "",
        });
        if (this.seenKeys.has(dedupeKey)) {
          result.dropped += 1;
          continue;
        }
        this.seenKeys.add(dedupeKey);
        this.emit(this.toEvent(payload, dedupeKey, polledAt));
        result.passed += 1;
      }
      this.status = "running";
      this.lastError = null;
    } catch (error) {
      this.status = "error";
      this.lastError =
        error instanceof Error ? error.message : "Calendar poll failed";
      result.errors.push(this.lastError);
      this.logger.error({ error: this.lastError }, "calendar poll failed");
    }

    this.lastPollAt = polledAt;
    this.lastPollResult = result;
    this.pushActivity({
      at: polledAt,
      kind: result.errors.length > 0 ? "error" : "ok",
      summary: `Calendar ${result.passed}/${result.detected} emitted`,
    });
    return result;
  }

  private async ingestEarningsIfConfigured(): Promise<void> {
    const url = this.config.earningsApiUrl;
    if (!url) return;
    const response = await fetch(url);
    if (!response.ok) return;
    const body = (await response.json()) as unknown;
    const rows = normalizeEarningsPayload(body);
    for (const row of rows) {
      this.calendarRepo.upsert({
        eventType: "earnings",
        scheduledAt: row.scheduledAt,
        symbol: row.symbol,
        title: `${row.symbol} earnings`,
        source: "earnings_api",
      });
    }
  }

  private toEvent(
    payload: CalendarPayload,
    dedupeKey: string,
    detectedAt: string,
  ): SignalEvent {
    return {
      id: crypto.randomUUID(),
      sourceId: this.id,
      sourceType: this.type,
      ticker: payload.symbol ?? payload.eventType.toUpperCase(),
      companyName: payload.title ?? null,
      documentUrl: null,
      accessionNumber: null,
      payloadJson: {
        instrumentClass: "stock",
        ...payload,
      },
      filedAt: detectedAt,
      detectedAt,
      kind: "calendar_event",
      dedupeKey,
      ttl: DEFAULT_SIGNAL_TTL.calendar_event,
      occurredAt: payload.scheduledAt,
    };
  }

  private buildSyntheticEvent(): SignalEvent {
    const detectedAt = new Date().toISOString();
    const scheduledAt = new Date(Date.now() + 36 * 3_600_000).toISOString();
    const payload: CalendarPayload = {
      eventType: "earnings",
      scheduledAt,
      symbol: "NVDA",
      title: "NVDA earnings (synthetic)",
      source: "synthetic",
    };
    const dedupeKey = computeDedupeKey("calendar_event", {
      type: "earnings",
      at: scheduledAt,
      symbol: "NVDA",
      synthetic: "1",
    });
    return this.toEvent(payload, dedupeKey, detectedAt);
  }

  private emit(event: SignalEvent): void {
    this.lastSignalAt = event.detectedAt;
    this.lastSignalTicker = event.ticker;
    this.pushActivity({
      at: event.detectedAt,
      kind: "ok",
      summary: `Calendar event ${event.ticker}`,
    });
    for (const handler of this.handlers) handler(event);
  }

  private pushActivity(entry: SignalSourceActivityEntry): void {
    this.recentActivity = [entry, ...this.recentActivity].slice(0, 20);
  }
}

function normalizeEarningsPayload(
  body: unknown,
): Array<{ symbol: string; scheduledAt: string }> {
  if (!Array.isArray(body)) return [];
  const out: Array<{ symbol: string; scheduledAt: string }> = [];
  for (const row of body) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const symbol =
      typeof r.symbol === "string"
        ? r.symbol
        : typeof r.ticker === "string"
          ? r.ticker
          : null;
    const scheduledAt =
      typeof r.scheduledAt === "string"
        ? r.scheduledAt
        : typeof r.date === "string"
          ? r.date
          : typeof r.reportDate === "string"
            ? r.reportDate
            : null;
    if (symbol && scheduledAt) out.push({ symbol, scheduledAt });
  }
  return out;
}

function safeParseConfig(configJson: string): CalendarSourceConfig {
  try {
    const parsed = JSON.parse(configJson) as CalendarSourceConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
