/**
 * Rules strategy scans for SessionScheduler.
 * Quiet ticks return []; setups emit one scan_hit MarketSignal with evidence.
 * Live scans and backtests share DeterministicStrategy.evaluate().
 */

import type { InstrumentClass } from "@electron/shared/domain/enums";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import {
  computeDedupeKey,
  DEFAULT_SIGNAL_TTL,
  type MarketSignal,
} from "@electron/shared/domain/market-signal";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";
import {
  hashBarWindow,
  type DeterministicStrategy,
} from "../../backtest/replay-engine";
import { createBreakoutStrategy } from "../strategy/breakout-signal";
import { createMeanReversionStrategy } from "../strategy/mean-reversion-signal";
import { createTrendFollowingStrategy } from "../strategy/trend-following-signal";
import type { ScheduledScan, ScheduleSpec } from "./session-scheduler";

export type RulesStrategyId =
  | "mean-reversion"
  | "breakout"
  | "trend-following"
  | "options-flow";

const WARMUP_BARS = 50;

export interface CreateRulesScheduledScanInput {
  id: string;
  experienceId: string;
  strategyId: RulesStrategyId;
  symbol: string;
  instrumentClass: InstrumentClass;
  analysisTimeframe: string;
  schedule: ScheduleSpec;
  getBars: (symbol: string, tf: string, count: number) => Promise<OhlcvBar[]>;
}

/** Shared DeterministicStrategy adapters for live scans and bar replay. */
export function rulesDeterministicStrategy(
  strategyId: Exclude<RulesStrategyId, "options-flow">,
): DeterministicStrategy {
  switch (strategyId) {
    case "mean-reversion":
      return createMeanReversionStrategy();
    case "breakout":
      return createBreakoutStrategy();
    case "trend-following":
      return createTrendFollowingStrategy();
  }
}

export function createRulesScheduledScan(
  input: CreateRulesScheduledScanInput,
): ScheduledScan {
  return {
    id: input.id,
    experienceId: input.experienceId,
    schedule: input.schedule,
    symbol: input.symbol,
    instrumentClass: input.instrumentClass,
    analysisTimeframe: input.analysisTimeframe,
    async run(ctx): Promise<MarketSignal[]> {
      // Options-flow needs chain volume/OI, not OHLCV — quiet until wired.
      if (input.strategyId === "options-flow") {
        return [];
      }

      let bars: OhlcvBar[];
      try {
        bars = await input.getBars(
          ctx.symbol,
          ctx.analysisTimeframe,
          WARMUP_BARS,
        );
      } catch {
        return [];
      }
      if (bars.length === 0) return [];

      const strategy = rulesDeterministicStrategy(input.strategyId);
      const evaluated = strategy.evaluate(bars, {
        symbol: ctx.symbol,
        timeframe: asTradingTimeframe(ctx.analysisTimeframe),
      });
      if (!evaluated) return [];

      const now = ctx.now.toISOString();
      const barWindowHash = evaluated.barWindowHash || hashBarWindow(bars);
      const dedupeKey = computeDedupeKey("scan_hit", {
        strategyId: input.strategyId,
        symbol: ctx.symbol,
        barWindowHash,
      });

      const signal: MarketSignal = {
        id: crypto.randomUUID(),
        sourceId: input.id,
        kind: "scan_hit",
        instrumentClass: input.instrumentClass,
        symbols: [ctx.symbol],
        occurredAt: now,
        detectedAt: now,
        ttl: DEFAULT_SIGNAL_TTL.scan_hit,
        dedupeKey,
        provenance: {
          raw: {
            strength: evaluated.strength,
          },
        },
        payload: {
          strategyId: input.strategyId,
          evidence: {
            ...evaluated.evidence,
            strength: evaluated.strength,
          },
          barWindowHash,
          proposedAction: evaluated.action,
        },
      };
      return [signal];
    },
  };
}

export function asTradingTimeframe(tf: string): TradingTimeframe {
  if (
    tf === "15m" ||
    tf === "30m" ||
    tf === "1h" ||
    tf === "4h" ||
    tf === "1d" ||
    tf === "1w"
  ) {
    return tf;
  }
  return "1h";
}
