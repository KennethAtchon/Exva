import type {
  InstrumentClass,
  TradingTimeframe,
} from "@electron/shared/domain/enums";
import type { MarketDataService } from "./market-data-service";
import type {
  HistoricalBackfillInput,
  HistoricalBackfillService,
} from "./historical-backfill-service";
import { createLogger } from "../infra/log";

const logger = createLogger("history-provisioning");

export interface InstrumentHistoryContract {
  minEvaluableBars: number;
  preferredContextBars: number;
  warmupBars: number;
}

export type HistoryProvisionResult =
  | {
      kind: "satisfied";
      storedBars: number;
      oldestTs: string;
      newestTs: string;
    }
  | {
      kind: "partial";
      storedBars: number;
      minEvaluableBars: number;
      reason: string;
    }
  | { kind: "unavailable"; reason: string; provider: string };

export interface HistoryProvisioningDeps {
  marketData: MarketDataService;
  backfill: Pick<HistoricalBackfillService, "backfill">;
  now?: () => Date;
}

export interface HistoryProvisionInput {
  symbol: string;
  instrumentClass: InstrumentClass;
  timeframe: TradingTimeframe;
  contract: InstrumentHistoryContract;
  brokerAccountId: string;
}

/**
 * Ensure stored history meets preferred context before first scan (Solution 06 WS2).
 */
export class HistoryProvisioningService {
  private readonly inFlight = new Map<
    string,
    Promise<HistoryProvisionResult>
  >();

  constructor(private readonly deps: HistoryProvisioningDeps) {}

  ensure(input: HistoryProvisionInput): Promise<HistoryProvisionResult> {
    const key = [
      input.symbol,
      input.instrumentClass,
      input.timeframe,
      input.brokerAccountId,
    ].join(":");
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const pending = this.provision(input).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, pending);
    return pending;
  }

  private async provision(
    input: HistoryProvisionInput,
  ): Promise<HistoryProvisionResult> {
    const targetBars = Math.max(
      input.contract.preferredContextBars,
      input.contract.warmupBars + 1,
      input.contract.minEvaluableBars,
    );
    const recent = await this.safeRead(input, targetBars);
    const recentOldest = recent[0];
    const recentNewest = recent.at(-1);

    if (recent.length >= targetBars && recentOldest && recentNewest) {
      return {
        kind: "satisfied",
        storedBars: recent.length,
        oldestTs: recentOldest.ts,
        newestTs: recentNewest.ts,
      };
    }

    const now = this.deps.now?.() ?? new Date();
    const lookbackMs = estimateLookbackMs(
      input.timeframe,
      targetBars,
      input.instrumentClass,
    );
    const startIso = new Date(now.getTime() - lookbackMs).toISOString();
    const endIso = now.toISOString();

    try {
      const backfillInput: HistoricalBackfillInput = {
        symbol: input.symbol,
        instrumentClass: input.instrumentClass,
        timeframe: input.timeframe,
        startIso,
        endIso,
        brokerAccountId: input.brokerAccountId,
      };
      await this.deps.backfill.backfill(backfillInput);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn({ symbol: input.symbol, err }, "history backfill failed");
      const stored = await this.safeRead(input, targetBars);
      if (stored.length >= input.contract.minEvaluableBars) {
        return {
          kind: "partial",
          storedBars: stored.length,
          minEvaluableBars: input.contract.minEvaluableBars,
          reason,
        };
      }
      return { kind: "unavailable", reason, provider: "alpaca" };
    }

    const after = await this.safeRead(input, targetBars);
    const afterOldest = after[0];
    const afterNewest = after.at(-1);
    if (after.length >= targetBars && afterOldest && afterNewest) {
      return {
        kind: "satisfied",
        storedBars: after.length,
        oldestTs: afterOldest.ts,
        newestTs: afterNewest.ts,
      };
    }
    if (after.length >= input.contract.minEvaluableBars) {
      return {
        kind: "partial",
        storedBars: after.length,
        minEvaluableBars: input.contract.minEvaluableBars,
        reason: "below_preferred_context",
      };
    }
    return {
      kind: "partial",
      storedBars: after.length,
      minEvaluableBars: input.contract.minEvaluableBars,
      reason: "insufficient_after_backfill",
    };
  }

  private async safeRead(
    input: {
      symbol: string;
      instrumentClass: InstrumentClass;
      timeframe: TradingTimeframe;
    },
    barCount: number,
  ) {
    try {
      return await this.deps.marketData.getBars({
        symbol: input.symbol,
        instrumentClass: input.instrumentClass,
        timeframe: input.timeframe,
        barCount,
        failOnGaps: true,
        skipFreshnessCheck: true,
      });
    } catch {
      return [];
    }
  }
}

const TF_MS: Record<TradingTimeframe, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

function estimateLookbackMs(
  timeframe: TradingTimeframe,
  bars: number,
  instrumentClass: InstrumentClass,
): number {
  const raw = TF_MS[timeframe] * bars;
  if (timeframe === "1d" || timeframe === "1w") return raw * 1.5;
  // Listed equities expose only 6.5 trading hours on weekdays. Six times the
  // wall-clock duration covers closed hours, weekends, and ordinary holidays.
  if (instrumentClass === "stock" || instrumentClass === "options") {
    return raw * 6;
  }
  return raw * 1.5;
}
