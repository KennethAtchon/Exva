import type { EventBus } from "../infra/event-bus";
import type { NotificationService } from "../infra/notification-service";
import type { MarketDataService } from "../marketdata/market-data-service";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import {
  runNightlyResearchJobs,
  type NightlyResearchJobDeps,
} from "../research/nightly-jobs";

export type AlarmSeverity = "info" | "warn" | "error" | "kill";

export interface SupervisorAlarm {
  id: string;
  sessionId: string | null;
  kind:
    | "heartbeat_stale"
    | "consecutive_skip"
    | "data_freshness"
    | "drawdown"
    | "drift"
    | "ai_spend";
  severity: AlarmSeverity;
  message: string;
  firedAt: string;
}

export interface SessionHeartbeat {
  sessionId: string;
  lastActivityAt: string;
  /** Expected max gap between activities before stale alarm. */
  expectedIntervalMs: number;
}

export interface WatchedSymbol {
  symbol: string;
  timeframe: TradingTimeframe;
  sessionId: string | null;
}

export interface SupervisorDeps {
  eventBus: EventBus;
  notifications: NotificationService;
  marketData?: MarketDataService;
  /** Optional ntfy topic URL, e.g. https://ntfy.sh/exva-ken */
  ntfyTopicUrl?: string | null;
  /** Optional http(s) webhook that relays supervisor digests (email bridge). */
  smtpUrl?: string | null;
  /** Freshness lag threshold before data_freshness alarm. */
  freshnessLagMs?: number;
  /** Optional nightly research job hooks (calibration, labels, autopsy). */
  nightlyResearch?: NightlyResearchJobDeps;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Small continuous supervisor: heartbeats, data freshness, spend/drawdown hooks.
 * Not a framework — ~alarm fan-out + notification sinks.
 */
export class SupervisorService {
  private heartbeats = new Map<string, SessionHeartbeat>();
  private watchedSymbols = new Map<string, WatchedSymbol>();
  private alarms: SupervisorAlarm[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private aiSpendUsd = new Map<string, number>();
  private readonly freshnessLagMs: number;
  private readonly ntfyTopicUrl: string | null;
  private readonly smtpUrl: string | null;
  private lastNightlyRunMs = 0;

  constructor(private readonly deps: SupervisorDeps) {
    this.freshnessLagMs = deps.freshnessLagMs ?? 30 * 60 * 1000;
    this.ntfyTopicUrl = deps.ntfyTopicUrl ?? null;
    this.smtpUrl = deps.smtpUrl ?? null;
  }

  start(pollMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  recordHeartbeat(input: SessionHeartbeat): void {
    this.heartbeats.set(input.sessionId, input);
  }

  recordAiSpend(sessionId: string, deltaUsd: number): void {
    this.aiSpendUsd.set(
      sessionId,
      (this.aiSpendUsd.get(sessionId) ?? 0) + deltaUsd,
    );
  }

  /** Track a symbol for continuous data-freshness checks in tick(). */
  watchSymbol(
    symbol: string,
    timeframe: TradingTimeframe,
    sessionId: string | null = null,
  ): void {
    const key = `${symbol}|${timeframe}|${sessionId ?? ""}`;
    this.watchedSymbols.set(key, { symbol, timeframe, sessionId });
  }

  getAlarms(): SupervisorAlarm[] {
    return [...this.alarms];
  }

  async raiseConsecutiveSkip(
    sessionId: string,
    message: string,
  ): Promise<void> {
    await this.raise({
      id: crypto.randomUUID(),
      sessionId,
      kind: "consecutive_skip",
      severity: "error",
      message,
      firedAt: new Date().toISOString(),
    });
  }

  async raiseDrawdown(sessionId: string, message: string): Promise<void> {
    await this.raise({
      id: crypto.randomUUID(),
      sessionId,
      kind: "drawdown",
      severity: "kill",
      message,
      firedAt: new Date().toISOString(),
    });
  }

  async raiseDrift(sessionId: string, message: string): Promise<void> {
    await this.raise({
      id: crypto.randomUUID(),
      sessionId,
      kind: "drift",
      severity: "error",
      message,
      firedAt: new Date().toISOString(),
    });
  }

  async tick(nowMs: number = Date.now()): Promise<void> {
    for (const hb of this.heartbeats.values()) {
      const lag = nowMs - Date.parse(hb.lastActivityAt);
      if (lag > hb.expectedIntervalMs * 2) {
        await this.raise({
          id: crypto.randomUUID(),
          sessionId: hb.sessionId,
          kind: "heartbeat_stale",
          severity: "error",
          message: `Session ${hb.sessionId} silent for ${Math.round(lag / 60_000)}m (expected ≤${Math.round(hb.expectedIntervalMs / 60_000)}m).`,
          firedAt: new Date(nowMs).toISOString(),
        });
      }
    }

    for (const watched of this.watchedSymbols.values()) {
      await this.checkSymbolFreshness(
        watched.symbol,
        watched.timeframe,
        watched.sessionId,
      );
    }

    for (const [sessionId, spend] of this.aiSpendUsd) {
      if (spend > 25) {
        await this.raise({
          id: crypto.randomUUID(),
          sessionId,
          kind: "ai_spend",
          severity: "warn",
          message: `Session ${sessionId} AI spend $${spend.toFixed(2)} exceeds $25 day soft limit.`,
          firedAt: new Date(nowMs).toISOString(),
        });
      }
    }

    if (
      this.deps.nightlyResearch &&
      (this.lastNightlyRunMs === 0 || nowMs - this.lastNightlyRunMs >= DAY_MS)
    ) {
      this.lastNightlyRunMs = nowMs;
      try {
        await runNightlyResearchJobs(this.deps.nightlyResearch);
      } catch {
        // Nightly research failures must not take down the supervisor loop.
      }
    }
  }

  async checkSymbolFreshness(
    symbol: string,
    timeframe: TradingTimeframe,
    sessionId: string | null = null,
  ): Promise<void> {
    if (!this.deps.marketData) return;
    const lag = this.deps.marketData.freshnessLagMs(symbol, timeframe);
    if (lag != null && lag > this.freshnessLagMs) {
      await this.raise({
        id: crypto.randomUUID(),
        sessionId,
        kind: "data_freshness",
        severity: "error",
        message: `${symbol} ${timeframe} data lag ${Math.round(lag / 60_000)}m exceeds threshold.`,
        firedAt: new Date().toISOString(),
      });
    }
  }

  private async raise(alarm: SupervisorAlarm): Promise<void> {
    // Dedupe identical kind+session within 15 minutes.
    const recent = this.alarms.find(
      (a) =>
        a.kind === alarm.kind &&
        a.sessionId === alarm.sessionId &&
        Date.parse(alarm.firedAt) - Date.parse(a.firedAt) < 15 * 60 * 1000,
    );
    if (recent) return;

    this.alarms = [alarm, ...this.alarms].slice(0, 200);
    this.deps.notifications.notify(
      `Exva: ${alarm.kind}`,
      alarm.message,
      alarm.severity === "kill" || alarm.severity === "error"
        ? "ERROR"
        : "WARN",
    );

    if (alarm.severity === "error" || alarm.severity === "kill") {
      if (this.ntfyTopicUrl) {
        await pushNtfy(this.ntfyTopicUrl, `Exva: ${alarm.kind}`, alarm.message);
      }
      if (this.smtpUrl) {
        await pushSmtp(this.smtpUrl, `Exva: ${alarm.kind}`, alarm.message);
      }
    }
  }
}

async function pushNtfy(
  topicUrl: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    await fetch(topicUrl, {
      method: "POST",
      headers: {
        Title: title,
        Priority: "high",
      },
      body,
    });
  } catch {
    // Notification sink failures must not take down the supervisor loop.
  }
}

/** Best-effort digest webhook (http/https). Nodemailer not a dependency. */
async function pushSmtp(
  smtpUrl: string,
  title: string,
  body: string,
): Promise<void> {
  if (!smtpUrl.startsWith("http://") && !smtpUrl.startsWith("https://")) {
    return;
  }
  try {
    await fetch(smtpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, source: "exva-supervisor" }),
    });
  } catch {
    // Notification sink failures must not take down the supervisor loop.
  }
}
