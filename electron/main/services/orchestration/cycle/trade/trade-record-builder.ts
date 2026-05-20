import type { SessionConfig, Trade } from "@/lib/types";
import type {
  ReviewSignal,
  TradeSignal,
} from "@electron/shared/ai/pipeline-signals";
import {
  computeExecutionProfile,
  priceLevelsFromProfile,
} from "../../../ai/engines/execution/execution-profile-engine";
import type { InstrumentClass } from "@/lib/types";
import type { OrchestratorContext } from "../orchestrator-context";
import type { ResolvedInstrument } from "../types";
import { remapPredictionMetadataForOutcome } from "../utils";

export function resolvePredictionTradeFields(
  instrument: ResolvedInstrument,
): Pick<
  Trade,
  "instrumentDisplayName" | "predictionOutcome" | "instrumentMetadataJson"
> {
  const instrumentDisplayName = instrument.instrumentDisplayName ?? null;
  const predictionOutcome = instrument.predictionOutcome ?? null;
  const instrumentMetadataJson =
    instrument.instrumentClass === "prediction_market"
      ? remapPredictionMetadataForOutcome(
          instrument.instrumentMetadataJson ?? null,
          predictionOutcome,
        )
      : (instrument.instrumentMetadataJson ?? null);

  return { instrumentDisplayName, predictionOutcome, instrumentMetadataJson };
}

export function executionFieldsForSignal(
  ctx: OrchestratorContext,
  signal: TradeSignal,
  instrumentClass: InstrumentClass,
  config: SessionConfig,
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
  const profile = computeExecutionProfile({
    signal,
    instrumentClass,
    maxPositionUsd: config.max_position_usd,
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
  ctx: OrchestratorContext,
  tradeId: string,
  instrument: ResolvedInstrument,
  config: SessionConfig,
  signal: TradeSignal,
  aiCostUsd: number,
  reviewRecommendation?: ReviewSignal["recommendation"],
): Trade {
  const brokerAccountId = ctx.resolveBrokerAccountId(
    instrument.instrumentClass,
  );
  const prediction = resolvePredictionTradeFields(instrument);
  const execution = executionFieldsForSignal(
    ctx,
    signal,
    instrument.instrumentClass,
    config,
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
    instrumentType: instrument.instrumentClass,
    side: execution.side,
    entry_price: execution.entry_price,
    position_size_usd: execution.position_size_usd,
    stop_loss_price: execution.stop_loss_price,
    take_profit_price: execution.take_profit_price,
    strategy: config.strategy,
    execution_strategy: execution.execution_strategy,
    status: "pending",
    opened_at: null,
    closed_at: null,
    final_pnl_usd: null,
    ai_cost_usd: aiCostUsd,
    confidence_score: signal.confidence,
    broker_order_id: null,
    high_water_mark_price: null,
    exit_reason: null,
    created_at: new Date().toISOString(),
  };
}

export function createTradeFromDecision(
  ctx: OrchestratorContext,
  instrument: ResolvedInstrument,
  config: SessionConfig,
  signal: TradeSignal,
  aiCostUsd: number,
  reviewRecommendation?: ReviewSignal["recommendation"],
): Trade {
  const id = crypto.randomUUID();
  const brokerAccountId = ctx.resolveBrokerAccountId(
    instrument.instrumentClass,
  );
  const isTrade = signal.action !== "skip";
  const prediction = resolvePredictionTradeFields(instrument);
  const execution = executionFieldsForSignal(
    ctx,
    signal,
    instrument.instrumentClass,
    config,
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
    instrumentType: instrument.instrumentClass,
    side: execution.side,
    entry_price: execution.entry_price,
    position_size_usd: execution.position_size_usd,
    stop_loss_price: execution.stop_loss_price,
    take_profit_price: execution.take_profit_price,
    strategy: config.strategy,
    execution_strategy: execution.execution_strategy,
    status: isTrade ? "pending" : "rejected",
    opened_at: null,
    closed_at: isTrade ? null : new Date().toISOString(),
    final_pnl_usd: isTrade ? null : 0,
    ai_cost_usd: aiCostUsd,
    confidence_score: signal.confidence,
    broker_order_id: null,
    high_water_mark_price: null,
    exit_reason: null,
    created_at: new Date().toISOString(),
  };
}
