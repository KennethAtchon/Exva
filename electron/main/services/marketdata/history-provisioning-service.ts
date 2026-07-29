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
  locks?: Set<string>;
  now?: () => Date;
}

/**
 * Ensure stored history meets preferred context before first scan (Solution 06 WS2).
 */
export class HistoryProvisioningService {
  private readonly locks: Set<string>;

  constructor(private readonly deps: HistoryProvisioningDeps) {
    this.locks = deps.locks ?? new Set();
  }

  async ensure(input: {
    symbol: string;
    instrumentClass: InstrumentClass;
    timeframe: TradingTimeframe;
    contract: InstrumentHistoryContract;
    brokerAccountId: string;
  }): Promise<HistoryProvisionResult> {
    const key = `${input.symbol}:${input.timeframe}`;
    if (this.locks.has(key)) {
      return {
        kind: "partial",
        storedBars: 0,
        minEvaluableBars: input.contract.minEvaluableBars,
        reason: "provisioning_in_flight",
      };
    }
    this.locks.add(key);
    try {
      const recent = await this.safeRead(
        input,
        input.contract.preferredContextBars,
      );

      if (recent.length >= input.contract.preferredContextBars) {
        return {
          kind: "satisfied",
          storedBars: recent.length,
          oldestTs: recent[0]!.ts,
          newestTs: recent[recent.length - 1]!.ts,
        };
      }

      const now = this.deps.now?.() ?? new Date();
      const lookbackMs = estimateLookbackMs(
        input.timeframe,
        input.contract.preferredContextBars,
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
        const stored = await this.safeRead(
          input,
          input.contract.preferredContextBars,
        );
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

      const after = await this.safeRead(
        input,
        input.contract.preferredContextBars,
      );
      if (after.length >= input.contract.preferredContextBars) {
        return {
          kind: "satisfied",
          storedBars: after.length,
          oldestTs: after[0]!.ts,
          newestTs: after[after.length - 1]!.ts,
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
    } finally {
      this.locks.delete(key);
    }
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
): number {
  // Equity sessions ≈ 6.5h/day; pad 2.5x for weekends/holidays.
  const raw = TF_MS[timeframe] * bars;
  if (timeframe === "1d" || timeframe === "1w" || timeframe === "4h") {
    return raw * 1.5;
  }
  return raw * 2.5;
}
