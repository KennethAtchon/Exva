import { AppError } from "@electron/shared/infra/errors";
import type { EngineInputBuilder } from "../engine/input-builder-registry";

export const candidateValidationInputBuilder: EngineInputBuilder = {
  id: "candidate-validation",
  async build({ planCtx: ctx }) {
    const { adapter } = await ctx.services.brokerRouting.resolveAdapter(
      ctx.sessionId,
      ctx.instrument.instrumentClass,
    );
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
  applyOutput(state, output) {
    const validation = output as { allowed: boolean; reasons: string[] };
    if (!validation.allowed) {
      throw new AppError(
        `Candidate validation failed: ${validation.reasons.join("; ")}`,
        "VALIDATION_FAILED",
      );
    }
    return state;
  },
};

export const executionProfileInputBuilder: EngineInputBuilder = {
  id: "execution-profile",
  build({ planCtx: ctx, state }) {
    const decision = state.decision;
    const review = state.review;
    if (!decision || !review) {
      throw new Error(
        "execution-profile input builder requires decision and review in state",
      );
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
  applyOutput(state, output) {
    return {
      ...state,
      executionProfile: output as typeof state.executionProfile,
    };
  },
};

export const riskGateInputBuilder: EngineInputBuilder = {
  id: "risk-gate",
  build({ planCtx: ctx, state }) {
    const decision = state.decision;
    const executionProfile = state.executionProfile;
    if (!decision || !executionProfile) {
      throw new Error(
        "risk-gate input builder requires decision and executionProfile in state",
      );
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
          waitForOpenThreshold:
            ctx.strategyContext.riskConfig.waitForOpenThreshold,
          maxExposureUsd:
            ctx.instrument.instrumentClass === "prediction_market"
              ? ctx.strategyContext.riskConfig.maxExposureUsd
              : null,
        },
      },
    };
  },
  applyOutput(state, output) {
    const risk = output as {
      allowed: boolean;
      reason?: string;
      value?: typeof state.riskOrder;
    };
    if (!risk.allowed || !risk.value) {
      throw new AppError(
        risk.reason ?? "Trade rejected by risk engine",
        "VALIDATION_FAILED",
      );
    }
    return { ...state, riskOrder: risk.value };
  },
};

export const brokerAllocationInputBuilder: EngineInputBuilder = {
  id: "broker-allocation",
  build({ planCtx: ctx, state }) {
    const riskOrder = state.riskOrder;
    if (!riskOrder) {
      throw new Error(
        "broker-allocation input builder requires riskOrder in state",
      );
    }
    const brokerAccountId = ctx.services.brokerRouting.resolveBrokerAccountId(
      ctx.sessionId,
      ctx.instrument.instrumentClass,
    );
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
  applyOutput(state, output) {
    const brokerAllocation = output as typeof state.brokerAllocation;
    const brokerAccountId = (output as { brokerAccountId?: string })
      .brokerAccountId;
    if (!brokerAllocation?.allocation.ok) {
      throw new AppError(
        brokerAllocation?.allocation.reason ??
          "Broker allocation rejected order",
        "VALIDATION_FAILED",
      );
    }
    if (!brokerAllocation.conflict.ok) {
      throw new AppError(
        brokerAllocation.conflict.reason ?? "Instrument conflict blocked order",
        "VALIDATION_FAILED",
      );
    }
    return {
      ...state,
      brokerAllocation,
      brokerAccountId: brokerAccountId ?? state.brokerAccountId,
    };
  },
};

export const TRADE_ENGINE_INPUT_BUILDERS = [
  candidateValidationInputBuilder,
  executionProfileInputBuilder,
  riskGateInputBuilder,
  brokerAllocationInputBuilder,
] as const;
