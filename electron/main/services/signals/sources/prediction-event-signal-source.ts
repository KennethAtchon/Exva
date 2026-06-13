import type { PolymarketMarketRow } from "../../broker/adapters/broker-adapter";
import type {
  PollResult,
  SignalEvent,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import type { PredictionEventTriggerKind } from "@electron/shared/domain/prediction-event-triggers";
import type {
  ISignalSource,
  SignalSourceActivityEntry,
  SignalSourceSnapshot,
} from "../ISignalSource";
import { createLogger } from "../../infra/log";

type PredictionEventConfig = {
  triggerKind?: PredictionEventTriggerKind;
  pollIntervalMinutes?: number;
  minLiquidityUsd?: number;
  minPriceDeviation?: number;
  categoryWhitelist?: string[];
  curatedMarketSlugs?: string[];
};

type PredictionToken = { outcome?: unknown; token_id?: unknown };

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
    const result: PollResult = {
      detected: 0,
      passed: 0,
      dropped: 0,
      errors: [],
    };

    try {
      const triggerKind = this.config.triggerKind ?? "odds_volume_dislocation";
      if (
        triggerKind === "social_spike" ||
        triggerKind === "hybrid_confirmation"
      ) {
        this.status = "running";
        this.lastError = null;
        this.lastPollAt = polledAt;
        this.lastPollResult = result;
        return result;
      }

      const rows = await fetchGammaMarkets();
      result.detected = rows.length;
      for (const row of rows) {
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
    } catch (error) {
      this.status = "error";
      this.lastError =
        error instanceof Error ? error.message : "Prediction poll failed";
      result.errors.push(this.lastError);
      this.logger.error({ error: this.lastError }, "prediction poll failed");
    }

    this.lastPollAt = polledAt;
    this.lastPollResult = result;
    this.pushActivity({
      at: polledAt,
      kind: result.errors.length > 0 ? "error" : "ok",
      summary: `Poll ${result.passed}/${result.detected} passed (${this.config.triggerKind ?? "odds_volume_dislocation"})`,
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

    const tokens = Array.isArray(row.tokens) ? row.tokens : [];
    const yes = tokens.find(
      (token) =>
        token &&
        typeof token === "object" &&
        (token as PredictionToken).outcome === "Yes",
    ) as PredictionToken | undefined;
    const yesTokenId =
      yes && typeof yes.token_id === "string" ? yes.token_id : null;
    if (!yesTokenId) return null;

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
        outcomeTokenId: yesTokenId,
        slug,
        category,
        liquidityUsd: liquidity,
        lastTradePrice: lastPrice,
        resolutionTime:
          typeof row.endDate === "string" ? row.endDate : undefined,
      },
      filedAt: detectedAt,
      detectedAt,
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

async function fetchGammaMarkets(): Promise<PolymarketMarketRow[]> {
  const response = await fetch(
    "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=40",
  );
  if (!response.ok) return [];
  return (await response.json()) as PolymarketMarketRow[];
}

function safeParseConfig(configJson: string): PredictionEventConfig {
  try {
    const parsed = JSON.parse(configJson) as PredictionEventConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
