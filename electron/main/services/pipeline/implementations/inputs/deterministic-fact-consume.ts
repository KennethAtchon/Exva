import {
  deterministicSignalFactV1Schema,
  type DeterministicSignalFactV1,
} from "@electron/shared/domain/deterministic-signal-fact";
import {
  tradeSignalSchema,
  type ExecutionStrategyType,
  type TradeSignal,
} from "@electron/shared/ai/trade-signals";
import type { EngineRunCtx } from "../../execution/input-builder-registry";

const STRATEGY_TO_EXECUTION: Record<string, ExecutionStrategyType> = {
  "mean-reversion": "mean_reversion",
  "rules-mean-reversion": "mean_reversion",
  breakout: "breakout",
  "rules-breakout": "breakout",
  "trend-following": "trend_momentum",
  "rules-trend-following": "trend_momentum",
  "options-flow": "options_flow",
};

export function readDeterministicFactFromCtx(
  ctx: EngineRunCtx,
): DeterministicSignalFactV1 | null {
  const meta = ctx.instrument.instrumentMetadataJson;
  if (!meta) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(meta);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = (parsed as Record<string, unknown>).deterministicFact;
  if (!raw) return null;
  const result = deterministicSignalFactV1Schema.safeParse(raw);
  return result.success ? result.data : null;
}

export function tradeSignalFromDeterministicFact(
  fact: DeterministicSignalFactV1,
  executionStrategy: ExecutionStrategyType,
): TradeSignal {
  const resolved =
    STRATEGY_TO_EXECUTION[fact.strategyId] ?? executionStrategy;
  return tradeSignalSchema.parse({
    symbol: fact.symbol,
    action: fact.action,
    executionStrategy: resolved,
    entryPrice: null,
    confidence: fact.strength,
    strength: fact.strength,
    reasoning: `Scheduled deterministic fact ${fact.signalId} (${fact.barWindowHash.slice(0, 8)}); params/timeframe/lifecycle preserved.`,
    orderMetadata: {
      deterministicFact: fact,
      originKind: fact.originKind,
      timeframe: fact.timeframe,
      strategyParameters: fact.strategyParameters,
      barWindowHash: fact.barWindowHash,
      lifecycle: fact.lifecycle ?? null,
      sessionInputGroupKey: fact.sessionInputGroupKey,
      strategyImplementationVersion: fact.strategyImplementationVersion,
    },
  });
}

/** True when the engine task is already a fully formed TradeSignal from a fact. */
export function isPrecomputedTradeSignal(input: unknown): input is TradeSignal {
  if (!input || typeof input !== "object") return false;
  const record = input as Record<string, unknown>;
  return (
    typeof record.symbol === "string" &&
    (record.action === "buy" ||
      record.action === "sell" ||
      record.action === "skip") &&
    typeof record.executionStrategy === "string" &&
    typeof record.reasoning === "string" &&
    record.orderMetadata != null &&
    typeof record.orderMetadata === "object" &&
    "deterministicFact" in (record.orderMetadata as object)
  );
}
