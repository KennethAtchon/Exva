import type { Trade } from "@/lib/types";
import type {
  ReviewSignal,
  TradeSignal,
} from "@electron/shared/ai/trade-signals";
import {
  computeTradeTradeExecutionProfile,
  priceLevelsFromProfile,
} from "../../trade-execution-profile";
import type { InstrumentClass } from "@/lib/types";
import type { TradingCycleContext } from "../trading-cycle-context";
import type { ResolvedInstrument } from "../types";
import { remapPredictionMetadataForOutcome } from "../utils";

function resolvePredictionTradeFields(
  instrument: ResolvedInstrument,
  signal?: TradeSignal,
): Pick<
  Trade,
  "instrumentDisplayName" | "predictionOutcome" | "instrumentMetadataJson"
> {
  const instrumentDisplayName = instrument.instrumentDisplayName ?? null;
  const predictionOutcome = instrument.predictionOutcome ?? null;
  let instrumentMetadataJson =
    instrument.instrumentClass === "prediction_market"
      ? remapPredictionMetadataForOutcome(
          instrument.instrumentMetadataJson ?? null,
          predictionOutcome,
        )
      : (instrument.instrumentMetadataJson ?? null);

  // Solution 10: persist options vertical legs on the trade for order-placer.
  if (signal?.orderMetadata && Object.keys(signal.orderMetadata).length > 0) {
    let base: Record<string, unknown> = {};
    if (instrumentMetadataJson) {
      try {
        base = JSON.parse(instrumentMetadataJson) as Record<string, unknown>;
      } catch {
        base = {};
      }
    }
    instrumentMetadataJson = JSON.stringify({
      ...base,
      ...signal.orderMetadata,
    });
  }

  return { instrumentDisplayName, predictionOutcome, instrumentMetadataJson };
}

function executionFieldsForSignal(
  ctx: TradingCycleContext,
  signal: TradeSignal,
  instrumentClass: InstrumentClass,
  reviewRecommendation?: ReviewSignal["recommendation"],
): {
  position_size_usd: number;
  side: Trade["side"];
  entry_price: number | null;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  execution_strategy: string | null;
} {
  if (signal.action === "skip") {
    return {
      position_size_usd: 0,
      side: "BUY",
      entry_price: null,
      stop_loss_price: null,
      take_profit_price: null,
      execution_strategy: signal.executionStrategy,
    };
  }

  const strategyCtx = ctx.deps.strategyContextService.get(ctx.sessionId);
  const profile = computeTradeTradeExecutionProfile({
    signal,
    instrumentClass,
    maxPositionUsd: strategyCtx.riskConfig.maxPositionUsd,
    maxExposureUsd: strategyCtx.riskConfig.maxExposureUsd ?? null,
    risk: {
      stopLossPct: strategyCtx.riskConfig.stopLossPct,
      takeProfitPct: strategyCtx.riskConfig.takeProfitPct,
      kellyFraction: strategyCtx.riskConfig.kellyFraction,
    },
    reviewRecommendation,
  });

  const entry_price = profile.limitPrice;
  const levels =
    entry_price != null
      ? priceLevelsFromProfile(profile.side, entry_price, profile)
      : { stopLossPrice: null, takeProfitPrice: null };

  return {
    position_size_usd: profile.positionSizeUsd,
    side: profile.side,
    entry_price,
    stop_loss_price: levels.stopLossPrice,
    take_profit_price: levels.takeProfitPrice,
    execution_strategy: signal.executionStrategy,
  };
}

export function buildTradeFromDecision(
  ctx: TradingCycleContext,
  tradeId: string,
  instrument: ResolvedInstrument,
  signal: TradeSignal,
  aiCostUsd: number,
  reviewRecommendation?: ReviewSignal["recommendation"],
): Trade {
  const brokerAccountId = ctx.resolveBrokerAccountId(
    instrument.instrumentClass,
  );
  const prediction = resolvePredictionTradeFields(instrument, signal);
  const strategyCtx = ctx.deps.strategyContextService.get(ctx.sessionId);
  const execution = executionFieldsForSignal(
    ctx,
    signal,
    instrument.instrumentClass,
    reviewRecommendation,
  );
  return {
    id: tradeId,
    sessionId: ctx.sessionId,
    brokerAccountId,
    instrumentSymbol: signal.symbol,
    instrumentDisplayName: prediction.instrumentDisplayName,
    predictionOutcome: prediction.predictionOutcome,
    instrumentMetadataJson: prediction.instrumentMetadataJson,
    instrumentType:
      signal.orderMetadata?.instrumentClass === "options"
        ? "options"
        : instrument.instrumentClass,
    side: execution.side,
    entry_price: execution.entry_price,
    position_size_usd: execution.position_size_usd,
    stop_loss_price: execution.stop_loss_price,
    take_profit_price: execution.take_profit_price,
    strategy: strategyCtx.rules.setupType,
    execution_strategy: execution.execution_strategy,
    status: "pending",
    opened_at: null,
    closed_at: null,
    final_pnl_usd: null,
    ai_cost_usd: aiCostUsd,
    confidence_score: signal.confidence,
    broker_order_id: null,
    high_water_mark_price: null,
    low_water_mark_price: null,
    exit_reason: null,
    created_at: new Date().toISOString(),
  };
}

export function createTradeFromDecision(
  ctx: TradingCycleContext,
  instrument: ResolvedInstrument,
  signal: TradeSignal,
  aiCostUsd: number,
  reviewRecommendation?: ReviewSignal["recommendation"],
): Trade {
  const id = crypto.randomUUID();
  const brokerAccountId = ctx.resolveBrokerAccountId(
    instrument.instrumentClass,
  );
  const isTrade = signal.action !== "skip";
  const prediction = resolvePredictionTradeFields(instrument, signal);
  const strategyCtx = ctx.deps.strategyContextService.get(ctx.sessionId);
  const execution = executionFieldsForSignal(
    ctx,
    signal,
    instrument.instrumentClass,
    isTrade ? reviewRecommendation : undefined,
  );
  return {
    id,
    sessionId: ctx.sessionId,
    brokerAccountId,
    instrumentSymbol: signal.symbol,
    instrumentDisplayName: prediction.instrumentDisplayName,
    predictionOutcome: prediction.predictionOutcome,
    instrumentMetadataJson: prediction.instrumentMetadataJson,
    instrumentType:
      signal.orderMetadata?.instrumentClass === "options"
        ? "options"
        : instrument.instrumentClass,
    side: execution.side,
    entry_price: execution.entry_price,
    position_size_usd: execution.position_size_usd,
    stop_loss_price: execution.stop_loss_price,
    take_profit_price: execution.take_profit_price,
    strategy: strategyCtx.rules.setupType,
    execution_strategy: execution.execution_strategy,
    status: isTrade ? "pending" : "no_trade",
    opened_at: null,
    closed_at: isTrade ? null : new Date().toISOString(),
    final_pnl_usd: isTrade ? null : 0,
    ai_cost_usd: aiCostUsd,
    confidence_score: signal.confidence,
    broker_order_id: null,
    high_water_mark_price: null,
    low_water_mark_price: null,
    exit_reason: null,
    created_at: new Date().toISOString(),
  };
}
