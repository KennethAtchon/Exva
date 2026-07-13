import type {
  PollResult,
  SignalEvent,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import {
  computeDedupeKey,
  DEFAULT_SIGNAL_TTL,
} from "@electron/shared/domain/market-signal";
import type {
  ISignalSource,
  SignalSourceActivityEntry,
  SignalSourceSnapshot,
} from "../ISignalSource";
import { createLogger } from "../../infra/log";

/** Kalshi taker fee ~1.75¢ per contract at mid (~175 bps on $1 notional mid). */
export const KALSHI_FEE_BPS = 175;

type KalshiMarketSourceConfig = {
  pollIntervalMinutes?: number;
  minLiquidityUsd?: number;
  minPriceDeviation?: number;
  /** demo | prod public market list (no auth required for GET /markets). */
  environment?: "demo" | "prod";
  seriesTickerWhitelist?: string[];
};

type KalshiMarketRow = {
  ticker?: string;
  title?: string;
  subtitle?: string;
  status?: string;
  yes_bid?: number;
  yes_ask?: number;
  last_price?: number;
  volume?: number;
  open_interest?: number;
  close_time?: string;
  expiration_time?: string;
  rules_primary?: string;
  category?: string;
};

const DEMO_REST = "https://demo-api.kalshi.co/trade-api/v2";
const PROD_REST = "https://api.elections.kalshi.com/trade-api/v2";

/**
 * Polls Kalshi markets and emits market_dislocation signals with Kalshi fees
 * in the payload cost fields. Reuses the prediction-event pipeline downstream;
 * venue is selected via source definition / input catalog, not a code fork.
 */
export class KalshiMarketSource implements ISignalSource {
  readonly type = "kalshi_market" as const;
  status: SignalSourceRuntimeStatus = "idle";
  lastError: string | null = null;
  private handlers = new Set<(event: SignalEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: KalshiMarketSourceConfig;
  private seenTickers = new Set<string>();
  private lastPollAt: string | null = null;
  private lastPollResult: PollResult | null = null;
  private lastSignalAt: string | null = null;
  private lastSignalTicker: string | null = null;
  private recentActivity: SignalSourceActivityEntry[] = [];
  private readonly logger = createLogger("kalshi-market-source");

  constructor(
    public readonly id: string,
    configJson: string,
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
    this.seenTickers.clear();
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
    const result: PollResult = {
      detected: 0,
      passed: 0,
      dropped: 0,
      errors: [],
    };

    try {
      const rows = await fetchKalshiMarkets(this.config.environment ?? "demo");
      result.detected = rows.length;
      for (const row of rows) {
        const event = this.eventFromMarketRow(row);
        if (!event) {
          result.dropped += 1;
          continue;
        }
        const ticker = event.ticker;
        if (this.seenTickers.has(ticker)) {
          result.dropped += 1;
          continue;
        }
        this.seenTickers.add(ticker);
        this.emit(event);
        result.passed += 1;
      }
      this.status = "running";
      this.lastError = null;
    } catch (error) {
      this.status = "error";
      this.lastError =
        error instanceof Error ? error.message : "Kalshi poll failed";
      result.errors.push(this.lastError);
      this.logger.error({ error: this.lastError }, "kalshi poll failed");
    }

    this.lastPollAt = polledAt;
    this.lastPollResult = result;
    this.pushActivity({
      at: polledAt,
      kind: result.errors.length > 0 ? "error" : "ok",
      summary: `Kalshi poll ${result.passed}/${result.detected} passed`,
    });
    return result;
  }

  private eventFromMarketRow(row: KalshiMarketRow): SignalEvent | null {
    const ticker = typeof row.ticker === "string" ? row.ticker : null;
    const question = typeof row.title === "string" ? row.title : null;
    if (!ticker || !question) return null;
    if (row.status && row.status !== "open" && row.status !== "active") {
      return null;
    }

    const whitelist = this.config.seriesTickerWhitelist ?? [];
    if (whitelist.length > 0) {
      const series = ticker.split("-")[0] ?? ticker;
      if (!whitelist.includes(series) && !whitelist.includes(ticker)) {
        return null;
      }
    }

    const yesBid = Number(row.yes_bid ?? 0) / 100;
    const yesAsk = Number(row.yes_ask ?? 0) / 100;
    const last = Number(row.last_price ?? 50) / 100;
    const mid =
      yesBid > 0 && yesAsk > 0
        ? (yesBid + yesAsk) / 2
        : Number.isFinite(last)
          ? last
          : 0.5;
    const spreadBps =
      yesBid > 0 && yesAsk > 0 && mid > 0
        ? ((yesAsk - yesBid) / mid) * 10_000
        : 200;
    const liquidityUsd = Number(row.volume ?? row.open_interest ?? 0);
    if (liquidityUsd < (this.config.minLiquidityUsd ?? 1000)) return null;

    const deviation = Math.abs(mid - 0.5);
    if (deviation < (this.config.minPriceDeviation ?? 0.12)) return null;

    const detectedAt = new Date().toISOString();
    const resolutionAt = row.close_time ?? row.expiration_time ?? detectedAt;
    const dedupeKey = computeDedupeKey("market_dislocation", {
      venue: "kalshi",
      marketId: ticker,
    });

    return {
      id: crypto.randomUUID(),
      sourceId: this.id,
      sourceType: this.type,
      ticker: `kalshi:${ticker}`,
      companyName: question,
      documentUrl: `https://kalshi.com/markets/${ticker}`,
      accessionNumber: null,
      payloadJson: {
        instrumentClass: "prediction_market",
        kind: "market_dislocation",
        marketId: ticker,
        question,
        outcome: "Yes",
        marketMid: mid,
        spreadBps,
        liquidityUsd,
        resolutionAt,
        resolutionCriteria: row.rules_primary ?? "",
        venue: "kalshi",
        feeBps: KALSHI_FEE_BPS,
      },
      filedAt: detectedAt,
      detectedAt,
      kind: "market_dislocation",
      dedupeKey,
      ttl: DEFAULT_SIGNAL_TTL.market_dislocation,
      occurredAt: detectedAt,
    };
  }

  private buildSyntheticEvent(): SignalEvent {
    const detectedAt = new Date().toISOString();
    const ticker = `TEST-SYNTH-${this.id.slice(0, 8)}`;
    return {
      id: crypto.randomUUID(),
      sourceId: this.id,
      sourceType: this.type,
      ticker: `kalshi:${ticker}`,
      companyName: "Synthetic Kalshi market event (test)",
      documentUrl: "https://kalshi.com",
      accessionNumber: null,
      payloadJson: {
        instrumentClass: "prediction_market",
        kind: "market_dislocation",
        marketId: ticker,
        question: "Synthetic Kalshi market event (test)",
        outcome: "Yes",
        marketMid: 0.62,
        spreadBps: 150,
        liquidityUsd: 10_000,
        resolutionAt: detectedAt,
        resolutionCriteria: "Synthetic",
        venue: "kalshi",
        feeBps: KALSHI_FEE_BPS,
        synthetic: true,
      },
      filedAt: detectedAt,
      detectedAt,
      kind: "market_dislocation",
      dedupeKey: computeDedupeKey("market_dislocation", {
        venue: "kalshi",
        marketId: ticker,
      }),
      ttl: DEFAULT_SIGNAL_TTL.market_dislocation,
      occurredAt: detectedAt,
    };
  }

  private emit(event: SignalEvent): void {
    this.lastSignalAt = event.detectedAt;
    this.lastSignalTicker = event.ticker;
    this.pushActivity({
      at: event.detectedAt,
      kind: "ok",
      summary: `Kalshi dislocation for ${event.ticker}`,
    });
    for (const handler of this.handlers) handler(event);
  }

  private pushActivity(entry: SignalSourceActivityEntry): void {
    this.recentActivity = [entry, ...this.recentActivity].slice(0, 20);
  }
}

export async function fetchKalshiMarkets(
  environment: "demo" | "prod" = "demo",
): Promise<KalshiMarketRow[]> {
  const base = environment === "prod" ? PROD_REST : DEMO_REST;
  const response = await fetch(`${base}/markets?limit=40&status=open`);
  if (!response.ok) return [];
  const body = (await response.json()) as { markets?: KalshiMarketRow[] };
  return Array.isArray(body.markets) ? body.markets : [];
}

function safeParseConfig(configJson: string): KalshiMarketSourceConfig {
  try {
    const parsed = JSON.parse(configJson) as KalshiMarketSourceConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
