import type { EngineInputBuilder } from "../engine/input-builder-registry";

export const candidateValidationInputBuilder: EngineInputBuilder = {
  id: "candidate-validation",
  async build({ planCtx: ctx }) {
    const { adapter } = await ctx.services.brokerRouting.resolveAdapter(ctx.sessionId, ctx.instrument.instrumentClass);
    const wireSymbol = ctx.services.instrumentNormalizer.toBrokerSymbol({
      symbol: ctx.instrument.symbol,
      instrumentClass: ctx.instrument.instrumentClass,
      brokerType: adapter.brokerType,
    });
    const quoteSnapshot = await adapter.getMarketSnapshot(wireSymbol);
    const strategy = ctx.strategyContext;

    return {
      task: {
        sessionId: ctx.sessionId,
        cycleId: ctx.cycleId,
        instrument: {
          symbol: ctx.instrument.symbol,
          instrumentClass: ctx.instrument.instrumentClass,
          selectorEvidence: ctx.instrument.selectorEvidence ?? null,
        },
        sessionInstrumentClasses: ctx.instrumentClasses,
        sideBias: strategy.rules.sideBias,
        holdingStyle: strategy.timeframe.holdingStyle,
        selectorTrace: ctx.instrument.selectorTraces ?? [],
        quoteSnapshot,
      },
      statePatch: { quoteSnapshot },
    };
  },
};

export const executionProfileInputBuilder: EngineInputBuilder = {
  id: "execution-profile",
  build({ planCtx: ctx, state }) {
    const decision = state.decision;
    const review = state.review;
    if (!decision || !review) {
      throw new Error("execution-profile input builder requires decision and review in state");
    }
    return {
      task: {
        signal: decision.output,
        instrumentClass: ctx.instrument.instrumentClass,
        maxPositionUsd: ctx.sessionConfig.max_position_usd,
        maxExposureUsd: ctx.strategyContext.riskConfig.maxExposureUsd ?? null,
        risk: {
          stopLossPct: ctx.strategyContext.riskConfig.stopLossPct,
          takeProfitPct: ctx.strategyContext.riskConfig.takeProfitPct,
          kellyFraction: ctx.strategyContext.riskConfig.kellyFraction,
        },
        reviewRecommendation: review.output.recommendation,
      },
    };
  },
};

export const riskGateInputBuilder: EngineInputBuilder = {
  id: "risk-gate",
  build({ planCtx: ctx, state }) {
    const decision = state.decision;
    const executionProfile = state.executionProfile;
    if (!decision || !executionProfile) {
      throw new Error("risk-gate input builder requires decision and executionProfile in state");
    }

    const stats = ctx.services.statsRepo.dashboardStats(
      ctx.sessionId,
      ctx.services.sessionRepo.getStatus(ctx.sessionId),
      ctx.services.sessionBrokerAssignmentsRepo
        .listAssignments(ctx.sessionId)
        .reduce((sum, assignment) => sum + assignment.allocatedUsd, 0),
      ctx.services.sessionRepo.uptimeMin(ctx.sessionId),
      ctx.sessionConfig.max_api_spend_usd,
    );

    return {
      task: {
        config: ctx.sessionConfig,
        stats,
        holdingStyle: ctx.strategyContext.timeframe.holdingStyle,
        order: {
          instrumentSymbol: ctx.instrument.symbol,
          instrumentDisplayName: ctx.instrument.instrumentDisplayName ?? null,
          predictionOutcome: ctx.instrument.predictionOutcome ?? null,
          instrumentMetadataJson: ctx.instrument.instrumentMetadataJson ?? null,
          instrumentType: ctx.instrument.instrumentClass,
          side: executionProfile.side,
          sizeUsd: executionProfile.positionSizeUsd,
        },
        confidence: decision.output.confidence,
        riskPolicy: {
          waitForOpenThreshold: ctx.strategyContext.riskConfig.waitForOpenThreshold,
          maxExposureUsd:
            ctx.instrument.instrumentClass === "prediction_market" ? ctx.strategyContext.riskConfig.maxExposureUsd : null,
        },
      },
    };
  },
};

export const brokerAllocationInputBuilder: EngineInputBuilder = {
  id: "broker-allocation",
  build({ planCtx: ctx, state }) {
    const riskOrder = state.riskOrder;
    if (!riskOrder) {
      throw new Error("broker-allocation input builder requires riskOrder in state");
    }
    const brokerAccountId = ctx.services.brokerRouting.resolveBrokerAccountId(ctx.sessionId, ctx.instrument.instrumentClass);
    return {
      task: {
        brokerAccountId,
        sessionId: ctx.sessionId,
        sizeUsd: riskOrder.sizeUsd,
        symbol: ctx.instrument.symbol,
      },
      statePatch: { brokerAccountId },
    };
  },
};

export const TRADE_ENGINE_INPUT_BUILDERS = [
  candidateValidationInputBuilder,
  executionProfileInputBuilder,
  riskGateInputBuilder,
  brokerAllocationInputBuilder,
] as const;
