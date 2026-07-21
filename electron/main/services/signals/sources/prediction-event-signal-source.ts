import {
  normalizePolymarketMarketTokens,
  type PolymarketMarketRow,
} from "../../broker/adapters/broker-adapter";
import type {
  PollResult,
  SignalEvent,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import { DEFAULT_SIGNAL_TTL } from "@electron/shared/domain/market-signal";
import type { PredictionEventTriggerKind } from "@electron/shared/domain/prediction-event-triggers";
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

type PredictionEventConfig = {
  triggerKind?: PredictionEventTriggerKind;
  pollIntervalMinutes?: number;
  minLiquidityUsd?: number;
  minPriceDeviation?: number;
  categoryWhitelist?: string[];
  curatedMarketSlugs?: string[];
};

export class PredictionEventSignalSource implements ISignalSource {
  readonly type = "prediction_event" as const;
  status: SignalSourceRuntimeStatus = "idle";
  lastError: string | null = null;
  private handlers = new Set<(event: SignalEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: PredictionEventConfig;
  private seenConditionIds = new Set<string>();
  private lastPollAt: string | null = null;
  private lastPollResult: PollResult | null = null;
  private lastSignalAt: string | null = null;
  private lastSignalTicker: string | null = null;
  private recentActivity: SignalSourceActivityEntry[] = [];
  private readonly logger = createLogger("prediction-event-signal-source");

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
    this.seenConditionIds.clear();
    await this.stop();
    await this.start();
  }

  async test(): Promise<PollResult> {
    const synthetic = this.buildSyntheticEvent();
    for (const handler of this.handlers) handler(synthetic);
    return {
      detected: 1,
      passed: 1,
      dropped: 0,
      errors: [],
    };
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

    try {
      const triggerKind = this.config.triggerKind ?? "odds_volume_dislocation";
      if (
        triggerKind === "social_spike" ||
        triggerKind === "hybrid_confirmation"
      ) {
        this.status = "running";
        this.lastError = null;
      } else {
        const fetched = await fetchGammaMarkets();
        httpStatus = fetched.httpStatus;
        result.detected = fetched.rows.length;
        for (const row of fetched.rows) {
          const event = this.eventFromMarketRow(row, triggerKind);
          if (!event) {
            result.dropped += 1;
            continue;
          }
          const dedupeKey = event.payloadJson.conditionId as string;
          if (this.seenConditionIds.has(dedupeKey)) {
            result.dropped += 1;
            continue;
          }
          this.seenConditionIds.add(dedupeKey);
          this.emit(event);
          result.passed += 1;
        }
        this.status = "running";
        this.lastError = null;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Prediction poll failed";
      const failure = classifyPollFailure(message);
      outcome = failure.outcome;
      httpStatus = failure.httpStatus;
      this.status = "error";
      this.lastError = message;
      result.errors.push(message);
      this.logger.error({ error: message }, "prediction poll failed");
    }

    this.lastPollAt = polledAt;
    this.lastPollResult = result;
    this.pushActivity({
      at: polledAt,
      kind: result.errors.length > 0 ? "error" : "ok",
      summary: `Poll ${result.passed}/${result.detected} passed (${this.config.triggerKind ?? "odds_volume_dislocation"})`,
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

  private eventFromMarketRow(
    row: PolymarketMarketRow,
    triggerKind: PredictionEventTriggerKind,
  ): SignalEvent | null {
    const conditionId =
      typeof row.conditionId === "string" ? row.conditionId : null;
    const question = typeof row.question === "string" ? row.question : null;
    const slug = typeof row.slug === "string" ? row.slug : null;
    const category = typeof row.category === "string" ? row.category : null;
    if (!conditionId || !question) return null;

    const whitelist = this.config.categoryWhitelist ?? [];
    if (whitelist.length > 0 && category && !whitelist.includes(category)) {
      return null;
    }

    const liquidity = Number(
      row.liquidity ?? row.liquidityClob ?? row.volume ?? 0,
    );
    if (liquidity < (this.config.minLiquidityUsd ?? 5000)) return null;

    const tokens = normalizePolymarketMarketTokens(row) ?? [];
    const yes = tokens.find((token) => token.outcome === "Yes");
    const no = tokens.find((token) => token.outcome === "No");
    const yesTokenId = yes?.token_id ?? null;
    const noTokenId = no?.token_id ?? null;
    // Both tokens required — edge may select NO; missing NO must not fall back to YES.
    if (!yesTokenId || !noTokenId) return null;

    if (triggerKind === "curated_event_feed") {
      const curated = this.config.curatedMarketSlugs ?? [];
      if (curated.length > 0 && slug && !curated.includes(slug)) {
        return null;
      }
    }

    const lastPrice = Number(
      (row as { lastTradePrice?: unknown }).lastTradePrice ?? 0.5,
    );
    const deviation = Math.abs(lastPrice - 0.5);
    if (
      triggerKind === "odds_volume_dislocation" &&
      deviation < (this.config.minPriceDeviation ?? 0.12)
    ) {
      return null;
    }

    // Prefer YES mid; else derive from NO; else last trade — all must be in (0,1).
    let marketMid: number | null = null;
    const yesMid = yes?.price != null ? Number(yes.price) : NaN;
    const noMid = no?.price != null ? Number(no.price) : NaN;
    if (Number.isFinite(yesMid) && yesMid > 0 && yesMid < 1) {
      marketMid = yesMid;
    } else if (Number.isFinite(noMid) && noMid > 0 && noMid < 1) {
      marketMid = 1 - noMid;
    } else if (Number.isFinite(lastPrice) && lastPrice > 0 && lastPrice < 1) {
      marketMid = lastPrice;
    }

    const detectedAt = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      sourceId: this.id,
      sourceType: this.type,
      ticker: `pm:${conditionId}`,
      companyName: question,
      documentUrl: slug ? `https://polymarket.com/event/${slug}` : null,
      accessionNumber: null,
      payloadJson: {
        instrumentClass: "prediction_market",
        triggerKind,
        conditionId,
        predictionOutcome: "YES",
        outcomeTokenId: yesTokenId,
        yesOutcomeTokenId: yesTokenId,
        noOutcomeTokenId: noTokenId,
        slug,
        category,
        liquidityUsd: liquidity,
        lastTradePrice: lastPrice,
        marketMid,
        resolutionTime:
          typeof row.endDate === "string" ? row.endDate : undefined,
      },
      filedAt: detectedAt,
      detectedAt,
      kind: "market_dislocation",
      dedupeKey: conditionId,
      ttl: DEFAULT_SIGNAL_TTL.market_dislocation,
      occurredAt: detectedAt,
    };
  }

  private buildSyntheticEvent(): SignalEvent {
    const detectedAt = new Date().toISOString();
    const conditionId = `test-${this.id}`;
    return {
      id: crypto.randomUUID(),
      sourceId: this.id,
      sourceType: this.type,
      ticker: `pm:${conditionId}`,
      companyName: "Synthetic prediction market event (test)",
      documentUrl: "https://polymarket.com",
      accessionNumber: null,
      payloadJson: {
        instrumentClass: "prediction_market",
        triggerKind: this.config.triggerKind ?? "odds_volume_dislocation",
        conditionId,
        outcomeTokenId: "test-token",
        slug: "synthetic-test-market",
        liquidityUsd: 10_000,
        lastTradePrice: 0.62,
        synthetic: true,
      },
      filedAt: detectedAt,
      detectedAt,
      kind: "market_dislocation",
      dedupeKey: conditionId,
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
      summary: `Prediction event for ${event.ticker}`,
    });
    for (const handler of this.handlers) handler(event);
  }

  private pushActivity(entry: SignalSourceActivityEntry): void {
    this.recentActivity = [entry, ...this.recentActivity].slice(0, 20);
  }
}

async function fetchGammaMarkets(): Promise<{
  rows: PolymarketMarketRow[];
  httpStatus: number;
}> {
  const response = await fetch(
    "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=40",
  );
  if (!response.ok) {
    throw new Error(`Gamma markets status ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Gamma markets parse error (status ${response.status})`);
  }
  if (!Array.isArray(body)) {
    throw new Error(
      `Gamma markets expected array, got ${typeof body} (status ${response.status})`,
    );
  }
  return {
    rows: body as PolymarketMarketRow[],
    httpStatus: response.status,
  };
}

function safeParseConfig(configJson: string): PredictionEventConfig {
  const parsed = safeJsonParse<PredictionEventConfig>(
    configJson,
    undefined,
    "prediction-event.config",
  );
  return parsed && typeof parsed === "object" ? parsed : {};
}
