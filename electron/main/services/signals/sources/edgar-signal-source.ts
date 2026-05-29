import type {
  PollResult,
  SignalEvent,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import type {
  ISignalSource,
  SignalSourceActivityEntry,
  SignalSourceSnapshot,
} from "../ISignalSource";
import { CikTickerCache } from "../cache/cik-ticker-cache";
import { createLogger } from "../../infra/log";

const FEED_URL =
  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=40&search_text=&output=atom";

type EdgarConfig = {
  cikWhitelist?: string[];
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
    const result: PollResult = {
      detected: 0,
      passed: 0,
      dropped: 0,
      errors: [],
    };
    const polledAt = new Date().toISOString();
    try {
      const response = await fetch(FEED_URL, {
        headers: {
          "User-Agent": "Exva Signal Monitor",
          Accept: "application/atom+xml",
        },
      });
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
        const event: SignalEvent = {
          id: crypto.randomUUID(),
          sourceId: this.id,
          sourceType: this.type,
          ticker,
          companyName: entry.title ?? null,
          documentUrl: entry.link ?? null,
          accessionNumber: extractAccession(entry.id),
          payloadJson: { rawId: entry.id, summary: entry.summary },
          filedAt: entry.updated,
          detectedAt: new Date().toISOString(),
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
      this.lastPollAt = polledAt;
      this.lastPollResult = result;
      this.pushActivity({
        at: polledAt,
        kind: "ok",
        summary: `Poll OK - ${result.detected} detected, ${result.passed} passed, ${result.dropped} dropped`,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = "error";
      this.lastError = message;
      this.logger.warn({ err: error }, "edgar poll failed");
      result.errors.push(message);
      this.lastPollAt = polledAt;
      this.lastPollResult = result;
      this.pushActivity({
        at: polledAt,
        kind: "error",
        summary: `Poll error - ${message}`,
      });
      return result;
    }
  }

  private pushActivity(entry: SignalSourceActivityEntry): void {
    this.recentActivity = [entry, ...this.recentActivity].slice(0, 20);
  }

  private async resolveTicker(cik: string): Promise<string | null> {
    const cached = this.cikCache.get(cik);
    if (cached !== undefined) return cached;
    const padded = cik.padStart(10, "0");
    try {
      const response = await fetch(
        `https://data.sec.gov/submissions/CIK${padded}.json`,
        {
          headers: {
            "User-Agent": "Exva Signal Monitor",
            Accept: "application/json",
          },
        },
      );
      if (!response.ok) {
        this.cikCache.upsert(cik, null);
        return null;
      }
      const payload = (await response.json()) as { tickers?: string[] };
      const ticker = payload.tickers?.[0] ?? null;
      this.cikCache.upsert(cik, ticker);
      return ticker;
    } catch {
      this.cikCache.upsert(cik, null);
      return null;
    }
  }
}

function safeParseConfig(raw: string): EdgarConfig {
  try {
    return JSON.parse(raw) as EdgarConfig;
  } catch {
    return {};
  }
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
