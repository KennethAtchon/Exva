/**
 * Rules strategy scans for SessionScheduler.
 * Quiet ticks return []; setups emit one scan_hit MarketSignal with evidence.
 */

import type { InstrumentClass } from "@electron/shared/domain/enums";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import {
  computeDedupeKey,
  DEFAULT_SIGNAL_TTL,
  type MarketSignal,
} from "@electron/shared/domain/market-signal";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";
import { hashBarWindow } from "../../backtest/replay-engine";
import { computeBreakoutSignal } from "../strategy/breakout-signal";
import { computeMeanReversionSignal } from "../strategy/mean-reversion-signal";
import { computeTrendFollowingSignal } from "../strategy/trend-following-signal";
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

      const result = evaluateRulesSetup(input.strategyId, ctx.symbol, bars);
      if (!result || result.action === "skip") return [];

      const now = ctx.now.toISOString();
      const barWindowHash = hashBarWindow(bars);
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
        provenance: { raw: { reasoning: result.reasoning } },
        payload: {
          strategyId: input.strategyId,
          evidence: result.evidence,
          barWindowHash,
          proposedAction: result.action,
        },
      };
      return [signal];
    },
  };
}

function evaluateRulesSetup(
  strategyId: Exclude<RulesStrategyId, "options-flow">,
  symbol: string,
  bars: OhlcvBar[],
): {
  action: "buy" | "sell" | "skip";
  reasoning: string;
  evidence: Record<string, number>;
} | null {
  if (strategyId === "mean-reversion") {
    const closes = bars.map((b) => b.close);
    const signal = computeMeanReversionSignal({
      symbol,
      ohlcv: closes.map((close) => ({ close })),
      zScoreEntry: -2,
    });
    const window = closes.slice(-20);
    const mean =
      window.length > 0 ? window.reduce((a, b) => a + b, 0) / window.length : 0;
    const variance =
      window.length > 0
        ? window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window.length
        : 0;
    const std = Math.sqrt(variance) || 1;
    const last = closes[closes.length - 1] ?? mean;
    const zScore = (last - mean) / std;
    const action =
      signal.action === "buy" || signal.action === "sell"
        ? signal.action
        : "skip";
    return {
      action,
      reasoning: signal.reasoning,
      evidence: { zScore, mean, std, close: last },
    };
  }

  if (strategyId === "breakout") {
    const signal = computeBreakoutSignal({
      symbol,
      ohlcv: bars.map((b) => ({
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume ?? undefined,
      })),
      lookback: 20,
      volumeMultiplierThreshold: 1.5,
    });
    const lookback = 20;
    const window = bars.slice(-lookback - 1, -1);
    const resistanceHigh =
      window.length > 0 ? Math.max(...window.map((b) => b.high)) : 0;
    const supportLow =
      window.length > 0 ? Math.min(...window.map((b) => b.low)) : 0;
    const current = bars[bars.length - 1];
    const avgVolume =
      window.length > 0
        ? window.reduce((sum, b) => sum + (b.volume ?? 1), 0) / window.length
        : 1;
    const volumeRatio = current ? (current.volume ?? avgVolume) / avgVolume : 0;
    const action =
      signal.action === "buy" || signal.action === "sell"
        ? signal.action
        : "skip";
    return {
      action,
      reasoning: signal.reasoning,
      evidence: {
        resistanceHigh,
        supportLow,
        close: current?.close ?? 0,
        volumeRatio,
      },
    };
  }

  if (strategyId === "trend-following") {
    const closes = bars.map((b) => b.close);
    const signal = computeTrendFollowingSignal({
      symbol,
      ohlcv: closes.map((close) => ({ close })),
      lookback: 20,
    });
    const lookback = 20;
    const current = closes[closes.length - 1] ?? 0;
    const previous = closes[closes.length - 2] ?? current;
    const sma =
      closes.length >= lookback
        ? closes.slice(-lookback).reduce((a, b) => a + b, 0) / lookback
        : current;
    const action =
      signal.action === "buy" || signal.action === "sell"
        ? signal.action
        : "skip";
    return {
      action,
      reasoning: signal.reasoning,
      evidence: { sma, close: current, previousClose: previous },
    };
  }

  return null;
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
