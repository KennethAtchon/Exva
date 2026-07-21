import type {
  PollResult,
  SignalEvent,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import {
  computeDedupeKey,
  DEFAULT_SIGNAL_TTL,
  type NewsPayload,
} from "@electron/shared/domain/market-signal";
import type { SignalSourcePollOutcome } from "@electron/shared/domain/signal-source-health";
import type {
  ISignalSource,
  SignalSourceActivityEntry,
  SignalSourceSnapshot,
} from "../ISignalSource";
import type { SignalSourceRuntimeRepo } from "../repos/signal-source-runtime-repo";
import {
  classifyPollFailure,
  emptyPollResult,
  persistSourcePoll,
} from "../persist-source-poll";
import { createLogger } from "../../infra/log";
import { safeJsonParse } from "../../infra/safe-json-parse";

export const DEFAULT_NEWS_RSS_URLS = [
  "https://www.prnewswire.com/rss/news-releases-list.rss",
  "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News",
  "https://feeds.businesswire.com/commerce/rss",
] as const;

type NewsSourceConfig = {
  pollIntervalMinutes?: number;
  feedUrls?: string[];
  /** Optional ticker whitelist; empty = accept all with extracted tickers. */
  tickerWhitelist?: string[];
};

/**
 * Polls PR Newswire / GlobeNewswire / Business Wire RSS feeds.
 * Strictly context-enrichment: news signals do NOT create trade candidates;
 * they attach to the evidence engine and feed freshness cross-checks.
 */
export class NewsSource implements ISignalSource {
  readonly type = "news_rss" as const;
  status: SignalSourceRuntimeStatus = "idle";
  lastError: string | null = null;
  private handlers = new Set<(event: SignalEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: NewsSourceConfig;
  private seenKeys = new Set<string>();
  private lastPollAt: string | null = null;
  private lastPollResult: PollResult | null = null;
  private lastSignalAt: string | null = null;
  private lastSignalTicker: string | null = null;
  private recentActivity: SignalSourceActivityEntry[] = [];
  private readonly logger = createLogger("news-source");

  constructor(
    public readonly id: string,
    configJson: string,
    private readonly runtimeRepo: SignalSourceRuntimeRepo | null = null,
  ) {
    this.config = safeParseConfig(configJson);
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.status = "running";
    this.lastError = null;
    await this.pollOnce();
    const intervalMs = Math.max(
      60_000,
      (this.config.pollIntervalMinutes ?? 15) * 60_000,
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

  private async pollOnce(): Promise<PollResult> {
    const polledAt = new Date().toISOString();
    const startedMs = Date.now();
    const result = emptyPollResult();
    let outcome: SignalSourcePollOutcome = "success";
    let httpStatus: number | null = null;
    const urls = this.config.feedUrls?.length
      ? this.config.feedUrls
      : [...DEFAULT_NEWS_RSS_URLS];

    try {
      for (const url of urls) {
        const fetched = await fetchRssItems(url);
        httpStatus = fetched.httpStatus;
        result.detected += fetched.items.length;
        for (const item of fetched.items) {
          const event = this.eventFromItem(item, url, polledAt);
          if (!event) {
            result.dropped += 1;
            continue;
          }
          if (this.seenKeys.has(event.dedupeKey)) {
            result.dropped += 1;
            continue;
          }
          this.seenKeys.add(event.dedupeKey);
          this.emit(event);
          result.passed += 1;
        }
      }
      this.status = "running";
      this.lastError = null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "News RSS poll failed";
      const failure = classifyPollFailure(message);
      outcome = failure.outcome;
      httpStatus = failure.httpStatus;
      this.status = "error";
      this.lastError = message;
      result.errors.push(message);
      this.logger.error({ error: message }, "news poll failed");
    }

    this.lastPollAt = polledAt;
    this.lastPollResult = result;
    this.pushActivity({
      at: polledAt,
      kind: result.errors.length > 0 ? "error" : "ok",
      summary: `News RSS ${result.passed}/${result.detected} emitted`,
    });
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

  private eventFromItem(
    item: RssItem,
    feedUrl: string,
    detectedAt: string,
  ): SignalEvent | null {
    const tickers = extractTickers(`${item.title} ${item.description ?? ""}`);
    const whitelist = this.config.tickerWhitelist ?? [];
    if (whitelist.length > 0) {
      const hit = tickers.some((t) => whitelist.includes(t));
      if (!hit) return null;
    }

    const sourceQuality = qualityForFeed(feedUrl);
    const payload: NewsPayload = {
      headline: item.title,
      url: item.link,
      publishedAt: item.publishedAt ?? detectedAt,
      sourceQuality,
      tickersMentioned: tickers,
      polarityHint: polarityFromHeadline(item.title),
    };
    const dedupeKey = computeDedupeKey("news", {
      url: payload.url,
      publishedAt: payload.publishedAt,
    });

    return {
      id: crypto.randomUUID(),
      sourceId: this.id,
      sourceType: this.type,
      ticker: tickers[0] ?? "NEWS",
      companyName: item.title.slice(0, 120),
      documentUrl: item.link,
      accessionNumber: null,
      payloadJson: {
        instrumentClass: "stock",
        contextOnly: true,
        ...payload,
      },
      filedAt: detectedAt,
      detectedAt,
      kind: "news",
      dedupeKey,
      ttl: DEFAULT_SIGNAL_TTL.news,
      occurredAt: payload.publishedAt,
    };
  }

  private buildSyntheticEvent(): SignalEvent {
    const detectedAt = new Date().toISOString();
    const payload: NewsPayload = {
      headline: "Acme Corp announces synthetic product launch (test)",
      url: "https://example.com/news/synthetic",
      publishedAt: detectedAt,
      sourceQuality: "wire",
      tickersMentioned: ["ACME"],
      polarityHint: "positive",
    };
    return {
      id: crypto.randomUUID(),
      sourceId: this.id,
      sourceType: this.type,
      ticker: "ACME",
      companyName: payload.headline,
      documentUrl: payload.url,
      accessionNumber: null,
      payloadJson: {
        instrumentClass: "stock",
        contextOnly: true,
        synthetic: true,
        ...payload,
      },
      filedAt: detectedAt,
      detectedAt,
      kind: "news",
      dedupeKey: computeDedupeKey("news", {
        url: payload.url,
        publishedAt: payload.publishedAt,
        synthetic: "1",
      }),
      ttl: DEFAULT_SIGNAL_TTL.news,
      occurredAt: detectedAt,
    };
  }

  private emit(event: SignalEvent): void {
    this.lastSignalAt = event.detectedAt;
    this.lastSignalTicker = event.ticker;
    this.pushActivity({
      at: event.detectedAt,
      kind: "ok",
      summary: `News: ${event.ticker}`,
    });
    for (const handler of this.handlers) handler(event);
  }

  private pushActivity(entry: SignalSourceActivityEntry): void {
    this.recentActivity = [entry, ...this.recentActivity].slice(0, 20);
  }
}

export interface RssItem {
  title: string;
  link: string;
  publishedAt: string | null;
  description: string | null;
}

export async function fetchRssItems(
  feedUrl: string,
): Promise<{ items: RssItem[]; httpStatus: number }> {
  const response = await fetch(feedUrl, {
    headers: { "User-Agent": "ExvaNewsBot/1.0" },
  });
  if (!response.ok) {
    throw new Error(`News RSS status ${response.status} for ${feedUrl}`);
  }
  const text = await response.text();
  return { items: parseRssXml(text), httpStatus: response.status };
}

export function parseRssXml(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const title = decodeXml(innerTag(block, "title") ?? "");
    const link = decodeXml(innerTag(block, "link") ?? "");
    if (!title || !link) continue;
    const pub =
      innerTag(block, "pubDate") ?? innerTag(block, "dc:date") ?? null;
    const description = innerTag(block, "description");
    items.push({
      title,
      link,
      publishedAt: pub ? new Date(pub).toISOString() : null,
      description: description ? decodeXml(description) : null,
    });
  }
  return items;
}

export function extractTickers(text: string): string[] {
  const found = new Set<string>();
  // $AAPL style
  for (const m of text.matchAll(/\$([A-Z]{1,5})\b/g)) {
    if (m[1]) found.add(m[1]);
  }
  // NYSE:AAPL / NASDAQ:TSLA
  for (const m of text.matchAll(
    /\b(?:NYSE|NASDAQ|AMEX|OTC):\s*([A-Z]{1,5})\b/gi,
  )) {
    if (m[1]) found.add(m[1].toUpperCase());
  }
  // (NASDAQ: AAPL)
  for (const m of text.matchAll(/\(([A-Z]{1,5})\)/g)) {
    const t = m[1];
    if (t && t.length >= 2 && !COMMON_WORDS.has(t)) found.add(t);
  }
  return [...found];
}

export function polarityFromHeadline(
  headline: string,
): "positive" | "negative" | "unclear" {
  const h = headline.toLowerCase();
  const pos = [
    "beats",
    "surge",
    "raises",
    "upgrade",
    "record",
    "growth",
    "approves",
    "wins",
  ];
  const neg = [
    "misses",
    "falls",
    "cuts",
    "downgrade",
    "probe",
    "lawsuit",
    "fraud",
    "bankruptcy",
    "recall",
  ];
  if (pos.some((w) => h.includes(w))) return "positive";
  if (neg.some((w) => h.includes(w))) return "negative";
  return "unclear";
}

/**
 * Freshness cross-check: flag when a filing/scan polarity contradicts
 * simultaneous news for the same ticker.
 */
export function newsContradictionFlag(input: {
  primaryPolarity?: "positive" | "negative" | "unclear" | null;
  newsPolarities: Array<"positive" | "negative" | "unclear">;
}): { contradicted: boolean; detail: string | null } {
  const primary = input.primaryPolarity;
  if (!primary || primary === "unclear") {
    return { contradicted: false, detail: null };
  }
  const opposing = primary === "positive" ? "negative" : "positive";
  const hits = input.newsPolarities.filter((p) => p === opposing);
  if (hits.length === 0) return { contradicted: false, detail: null };
  return {
    contradicted: true,
    detail: `${hits.length} coincident news item(s) contradict ${primary} primary signal`,
  };
}

function qualityForFeed(url: string): NewsPayload["sourceQuality"] {
  if (/prnewswire|globenewswire|businesswire/i.test(url)) return "wire";
  if (/reuters|bloomberg|wsj|ft\.com/i.test(url)) return "major";
  if (/reddit|twitter|stocktwits/i.test(url)) return "social";
  return "aggregator";
}

function innerTag(xml: string, tag: string): string | null {
  const cdata = xml.match(
    new RegExp(
      `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
      "i",
    ),
  );
  if (cdata?.[1] != null) return cdata[1].trim();
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m?.[1]?.trim() || null;
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

const COMMON_WORDS = new Set([
  "CEO",
  "CFO",
  "CTO",
  "USA",
  "USD",
  "IPO",
  "ETF",
  "FDA",
  "SEC",
  "AI",
  "IT",
  "US",
]);

function safeParseConfig(configJson: string): NewsSourceConfig {
  const parsed = safeJsonParse<NewsSourceConfig>(
    configJson,
    undefined,
    "news-source.config",
  );
  return parsed && typeof parsed === "object" ? parsed : {};
}
