import type {
  PollResult,
  SignalEvent,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import { DEFAULT_SIGNAL_TTL } from "@electron/shared/domain/market-signal";
import type { SignalSourcePollOutcome } from "@electron/shared/domain/signal-source-health";
import type {
  ISignalSource,
  SignalSourceActivityEntry,
  SignalSourceSnapshot,
} from "../ISignalSource";
import { CikTickerCache } from "../cache/cik-ticker-cache";
import type { SignalSourceRuntimeRepo } from "../repos/signal-source-runtime-repo";
import {
  classifyPollFailure,
  emptyPollResult,
  persistSourcePoll,
} from "../persist-source-poll";
import { createLogger } from "../../infra/log";
import { safeJsonParse } from "../../infra/safe-json-parse";

const FEED_URL =
  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=40&search_text=&output=atom";

type EdgarConfig = {
  cikWhitelist?: string[];
  /** Item codes to accept, e.g. ["1.01", "2.02", "8.01"]. Empty/omitted = accept all. */
  itemCodeWhitelist?: string[];
  minFilingAgeMinutes?: number;
  pollIntervalMarketMinutes?: number;
  pollIntervalOffHoursMinutes?: number;
};

export class EdgarSignalSource implements ISignalSource {
  readonly type = "edgar_8k" as const;
  status: SignalSourceRuntimeStatus = "idle";
  lastError: string | null = null;
  private handlers = new Set<(event: SignalEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: EdgarConfig;
  private lastPollAt: string | null = null;
  private lastPollResult: PollResult | null = null;
  private lastSignalAt: string | null = null;
  private lastSignalTicker: string | null = null;
  private recentActivity: SignalSourceActivityEntry[] = [];
  private readonly logger = createLogger("edgar-signal-source");

  constructor(
    public readonly id: string,
    configJson: string,
    private readonly cikCache: CikTickerCache,
    private readonly runtimeRepo: SignalSourceRuntimeRepo | null = null,
  ) {
    this.config = safeParseConfig(configJson);
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.status = "running";
    this.lastError = null;
    await this.pollOnce();
    this.schedule();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status = "paused";
  }

  async restart(newConfig: Record<string, unknown>): Promise<void> {
    this.status = "restarting";
    this.config = safeParseConfig(JSON.stringify(newConfig));
    await this.stop();
    await this.start();
  }

  async test(): Promise<PollResult> {
    return this.pollOnce();
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

  private schedule(): void {
    const minutes = isLikelyMarketHoursEt()
      ? (this.config.pollIntervalMarketMinutes ?? 5)
      : (this.config.pollIntervalOffHoursMinutes ?? 30);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(
      () => {
        void this.pollOnce();
      },
      Math.max(1, minutes) * 60 * 1000,
    );
  }

  private async pollOnce(): Promise<PollResult> {
    const result = emptyPollResult();
    const polledAt = new Date().toISOString();
    const startedMs = Date.now();
    let outcome: SignalSourcePollOutcome = "success";
    let httpStatus: number | null = null;
    try {
      const response = await fetch(FEED_URL, {
        headers: {
          "User-Agent": "Exva Signal Monitor",
          Accept: "application/atom+xml",
        },
      });
      httpStatus = response.status;
      if (!response.ok) throw new Error(`EDGAR feed status ${response.status}`);
      const body = await response.text();
      const entries = parseAtomEntries(body);
      result.detected = entries.length;
      for (const entry of entries) {
        const cik = extractCik(entry.id);
        if (this.config.cikWhitelist?.length && cik) {
          if (!this.config.cikWhitelist.includes(cik)) {
            result.dropped += 1;
            continue;
          }
        }
        const ticker = cik ? await this.resolveTicker(cik) : null;
        if (!ticker) {
          result.dropped += 1;
          continue;
        }
        if (isTooFresh(entry.updated, this.config.minFilingAgeMinutes ?? 0)) {
          result.dropped += 1;
          continue;
        }
        const itemCodes = extractItemCodes(entry.summary, entry.title);
        const itemCodeWhitelist = this.config.itemCodeWhitelist;
        if (
          itemCodeWhitelist?.length &&
          !itemCodes.some((code) => itemCodeWhitelist.includes(code))
        ) {
          result.dropped += 1;
          continue;
        }
        const accessionNumber = extractAccession(entry.id);
        const detectedAt = new Date().toISOString();
        const event: SignalEvent = {
          id: crypto.randomUUID(),
          sourceId: this.id,
          sourceType: this.type,
          ticker,
          companyName: entry.title ?? null,
          documentUrl: entry.link ?? null,
          accessionNumber,
          payloadJson: {
            rawId: entry.id,
            summary: entry.summary,
            itemCodes,
            instrumentClass: "stock",
          },
          filedAt: entry.updated,
          detectedAt,
          kind: "filing",
          dedupeKey: accessionNumber ?? `${this.id}:${ticker}:${detectedAt}`,
          ttl: DEFAULT_SIGNAL_TTL.filing,
          occurredAt: entry.updated,
        };
        this.lastSignalAt = event.detectedAt;
        this.lastSignalTicker = event.ticker;
        this.pushActivity({
          at: event.detectedAt,
          kind: "ok",
          summary: `Signal emitted for ${event.ticker}`,
        });
        for (const handler of this.handlers) handler(event);
        result.passed += 1;
      }
      this.status = "running";
      this.lastError = null;
      this.pushActivity({
        at: polledAt,
        kind: "ok",
        summary: `Poll OK - ${result.detected} detected, ${result.passed} passed, ${result.dropped} dropped`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = classifyPollFailure(message);
      outcome = failure.outcome;
      // Prefer status from the response when the request completed.
      httpStatus = httpStatus ?? failure.httpStatus;
      this.status = "error";
      this.lastError = message;
      this.logger.warn({ err: error }, "edgar poll failed");
      result.errors.push(message);
      this.pushActivity({
        at: polledAt,
        kind: "error",
        summary: `Poll error - ${message}`,
      });
    }

    this.lastPollAt = polledAt;
    this.lastPollResult = result;
    persistSourcePoll(this.runtimeRepo, {
      sourceId: this.id,
      polledAt,
      outcome,
      httpStatus,
      result,
      status: this.status,
      lastError: this.lastError,
      durationMs: Date.now() - startedMs,
    });
    return result;
  }

  private pushActivity(entry: SignalSourceActivityEntry): void {
    this.recentActivity = [entry, ...this.recentActivity].slice(0, 20);
  }

  private async resolveTicker(cik: string): Promise<string | null> {
    const cached = this.cikCache.get(cik);
    if (cached !== undefined) return cached;

    const padded = cik.padStart(10, "0");
    const response = await fetch(
      `https://data.sec.gov/submissions/CIK${padded}.json`,
      {
        headers: {
          "User-Agent": "Exva Signal Monitor",
          Accept: "application/json",
        },
      },
    );
    // Transport/provider failure — fail the poll; do not cache as "no ticker".
    if (!response.ok) {
      throw new Error(`EDGAR CIK lookup status ${response.status}`);
    }

    let payload: { tickers?: string[] };
    try {
      payload = (await response.json()) as { tickers?: string[] };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`EDGAR CIK lookup returned non-JSON: ${detail}`);
    }

    // Empty ticker sets are legitimate and may be cached.
    const ticker = payload.tickers?.[0] ?? null;
    this.cikCache.upsert(cik, ticker);
    return ticker;
  }
}

function safeParseConfig(raw: string): EdgarConfig {
  return (
    safeJsonParse<EdgarConfig>(raw, undefined, "edgar-signal-source.config") ??
    {}
  );
}

function parseAtomEntries(xml: string): Array<{
  id: string;
  title: string | null;
  updated: string;
  summary: string | null;
  link: string | null;
}> {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return entries.map((entryXml) => ({
    id: readTag(entryXml, "id") ?? "",
    title: readTag(entryXml, "title"),
    updated: readTag(entryXml, "updated") ?? new Date().toISOString(),
    summary: readTag(entryXml, "summary"),
    link: readAttr(entryXml, "link", "href"),
  }));
}

function readTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1]?.trim() ?? null;
}

function readAttr(xml: string, tag: string, attr: string): string | null {
  const match = xml.match(
    new RegExp(`<${tag}[^>]*${attr}="([^"]+)"[^>]*\\/?>`),
  );
  return match?.[1] ?? null;
}

function extractAccession(id: string): string | null {
  const match = id.match(/accession-number=([0-9-]+)/i);
  return match?.[1] ?? null;
}

function extractCik(id: string): string | null {
  const match = id.match(/CIK=([0-9]+)/i);
  return match?.[1] ?? null;
}

function isTooFresh(filedAtIso: string, minAgeMinutes: number): boolean {
  if (minAgeMinutes <= 0) return false;
  const filedMs = new Date(filedAtIso).getTime();
  if (Number.isNaN(filedMs)) return false;
  return Date.now() - filedMs < minAgeMinutes * 60 * 1000;
}

/** Parse SEC 8-K item codes from filing text (e.g. Item 1.01, Item 2.02). */
function extractItemCodes(
  summary: string | null,
  title: string | null,
): string[] {
  const text = `${summary ?? ""} ${title ?? ""}`;
  const matches = text.matchAll(/Item\s+(\d+\.\d+)/gi);
  const codes = new Set<string>();
  for (const match of matches) {
    if (match[1]) codes.add(match[1]);
  }
  return [...codes];
}

function isLikelyMarketHoursEt(now = new Date()): boolean {
  const etString = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
  });
  const et = new Date(etString);
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}
