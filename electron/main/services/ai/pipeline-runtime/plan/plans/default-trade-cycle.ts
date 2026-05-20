import { AppError } from "@electron/shared/infra/errors";
import type { OrderRequest } from "../../../../broker/adapters/broker-adapter";
import { runEngineBinding } from "../../execution/engine-context-runner";
import type { ExecutionProfile } from "../../../engines/execution/execution-profile-engine";
import type {
  BrokerAllocationResult,
  CyclePlan,
  CyclePlanRunContext,
  TradeCycleInstrument,
  TradeCyclePlanState,
} from "../cycle-types";

function requireState<T>(value: T | undefined, label: string): T {
  if (value == null) {
    throw new AppError(`Internal error: ${label} missing before cycle stage.`, "VALIDATION_FAILED");
  }
  return value;
}

async function runCandidateValidation(ctx: CyclePlanRunContext, state: TradeCyclePlanState): Promise<TradeCyclePlanState> {
  const { adapter } = await ctx.services.brokerRouting.resolveAdapter(ctx.sessionId, ctx.instrument.instrumentClass);
  const wireSymbol = ctx.services.instrumentNormalizer.toBrokerSymbol({
    symbol: ctx.instrument.symbol,
    instrumentClass: ctx.instrument.instrumentClass,
    brokerType: adapter.brokerType,
  });
  const quoteSnapshot = await adapter.getMarketSnapshot(wireSymbol);
  const strategy = ctx.strategyContext;

  const validation = runEngineBinding<{ allowed: boolean; reasons: string[] }>({
    phase: "technical",
    sessionId: ctx.sessionId,
    cycleId: ctx.cycleId,
    strategyContext: ctx.strategyContext,
    bindings: [],
    binding: { engine: "candidate-validator", kind: "validator", mode: "read" },
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
  });

  if (!validation.allowed) {
    throw new AppError(`Candidate validation failed: ${validation.reasons.join("; ")}`, "VALIDATION_FAILED");
  }

  return { ...state, quoteSnapshot };
}

async function runTechnical(ctx: CyclePlanRunContext, state: TradeCyclePlanState): Promise<TradeCyclePlanState> {
  const result = await ctx.runPhase<{ instrumentSymbol: string; selectorEvidence?: TradeCycleInstrument["selectorEvidence"] }, import("@electron/shared/ai/pipeline-signals").TechnicalSignal>(
    "technical",
    {
      instrumentSymbol: ctx.instrument.symbol,
      selectorEvidence: ctx.instrument.selectorEvidence ?? null,
    },
  );
  if (!result.output.symbol) {
    throw new AppError("Technical phase returned no signal.", "VALIDATION_FAILED");
  }
  return { ...state, technical: result };
}

async function runFundamental(ctx: CyclePlanRunContext, state: TradeCyclePlanState): Promise<TradeCyclePlanState> {
  const result = await ctx.runPhase<{ instrumentSymbol: string; selectorEvidence?: TradeCycleInstrument["selectorEvidence"] }, import("@electron/shared/ai/pipeline-signals").FundamentalSignal>(
    "fundamental",
    {
      instrumentSymbol: ctx.instrument.symbol,
      selectorEvidence: ctx.instrument.selectorEvidence ?? null,
    },
  );
  if (!result.output.symbol) {
    throw new AppError("Fundamental phase returned no signal.", "VALIDATION_FAILED");
  }
  return { ...state, fundamental: result };
}

async function runReview(ctx: CyclePlanRunContext, state: TradeCyclePlanState): Promise<TradeCyclePlanState> {
  const technical = requireState(state.technical, "technical analysis");
  const fundamental = requireState(state.fundamental, "fundamental analysis");
  const result = await ctx.runPhase<
    { instrumentSymbol: string; technical: typeof technical.output; fundamental: typeof fundamental.output },
    import("@electron/shared/ai/pipeline-signals").ReviewSignal
  >("review", {
    instrumentSymbol: ctx.instrument.symbol,
    technical: technical.output,
    fundamental: fundamental.output,
  });
  if (!result.output.symbol) {
    throw new AppError("Review phase returned no signal.", "VALIDATION_FAILED");
  }
  return { ...state, review: result };
}

async function runDecision(ctx: CyclePlanRunContext, state: TradeCyclePlanState): Promise<TradeCyclePlanState> {
  const technical = requireState(state.technical, "technical analysis");
  const fundamental = requireState(state.fundamental, "fundamental analysis");
  const review = requireState(state.review, "review analysis");
  const result = await ctx.runPhase<
    {
      instrumentSymbol: string;
      technical: typeof technical.output;
      fundamental: typeof fundamental.output;
      review: typeof review.output;
    },
    import("@electron/shared/ai/pipeline-signals").TradeSignal
  >("decision", {
    instrumentSymbol: ctx.instrument.symbol,
    technical: technical.output,
    fundamental: fundamental.output,
    review: review.output,
  });
  return { ...state, decision: result };
}

async function runRiskGate(ctx: CyclePlanRunContext, state: TradeCyclePlanState): Promise<TradeCyclePlanState> {
  const decision = requireState(state.decision, "decision");
  const review = requireState(state.review, "review");

  if (decision.output.action === "skip") {
    return state;
  }

  const executionProfile = runEngineBinding<ExecutionProfile>({
    phase: "decision",
    sessionId: ctx.sessionId,
    cycleId: ctx.cycleId,
    strategyContext: ctx.strategyContext,
    bindings: [],
    binding: { engine: "execution-profile-engine", kind: "execution", mode: "read" },
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
  });

  const stats = ctx.services.statsRepo.dashboardStats(
    ctx.sessionId,
    ctx.services.sessionRepo.getStatus(ctx.sessionId),
    ctx.services.sessionBrokerAssignmentsRepo
      .listAssignments(ctx.sessionId)
      .reduce((sum, assignment) => sum + assignment.allocatedUsd, 0),
    ctx.services.sessionRepo.uptimeMin(ctx.sessionId),
    ctx.sessionConfig.max_api_spend_usd,
  );

  const side = executionProfile.side;
  const risk = runEngineBinding<{ allowed: boolean; reason?: string; value?: OrderRequest }>({
    phase: "decision",
    sessionId: ctx.sessionId,
    cycleId: ctx.cycleId,
    strategyContext: ctx.strategyContext,
    bindings: [],
    binding: { engine: "risk-gate", kind: "policy", mode: "read" },
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
        side,
        sizeUsd: executionProfile.positionSizeUsd,
      },
      confidence: decision.output.confidence,
      riskPolicy: {
        waitForOpenThreshold: ctx.strategyContext.riskConfig.waitForOpenThreshold,
        maxExposureUsd: ctx.instrument.instrumentClass === "prediction_market" ? ctx.strategyContext.riskConfig.maxExposureUsd : null,
      },
    },
  });

  if (!risk.allowed || !risk.value) {
    throw new AppError(risk.reason ?? "Trade rejected by risk engine", "VALIDATION_FAILED");
  }

  const brokerAccountId = ctx.services.brokerRouting.resolveBrokerAccountId(ctx.sessionId, ctx.instrument.instrumentClass);
  const brokerAllocation = runEngineBinding<BrokerAllocationResult>({
    phase: "decision",
    sessionId: ctx.sessionId,
    cycleId: ctx.cycleId,
    strategyContext: ctx.strategyContext,
    bindings: [],
    binding: { engine: "broker-allocation", kind: "policy", mode: "read" },
    task: {
      brokerAccountId,
      sessionId: ctx.sessionId,
      sizeUsd: risk.value.sizeUsd,
      symbol: ctx.instrument.symbol,
    },
  });

  if (!brokerAllocation.allocation.ok) {
    throw new AppError(brokerAllocation.allocation.reason ?? "Broker allocation rejected order", "VALIDATION_FAILED");
  }
  if (!brokerAllocation.conflict.ok) {
    throw new AppError(brokerAllocation.conflict.reason ?? "Instrument conflict blocked order", "VALIDATION_FAILED");
  }

  return {
    ...state,
    executionProfile,
    riskOrder: risk.value,
    brokerAccountId,
    brokerAllocation,
  };
}

export const DEFAULT_TRADE_CYCLE: CyclePlan<TradeCyclePlanState> = {
  id: "default-trade-cycle",
  initialState: (_ctx, seed = {}) => ({ ...seed }),
  inspect: {
    stageIds: ["candidate_validation", "technical", "fundamental", "review", "decision", "risk_gate"],
    phaseStages: ["technical", "fundamental", "review", "decision"],
    engineStages: ["candidate-validator", "execution-profile-engine", "risk-gate", "broker-allocation"],
  },
  stages: [
    { id: "candidate_validation", executionStage: "candidate_validation", required: false, execute: runCandidateValidation },
    { id: "technical", executionStage: "technical", required: true, execute: runTechnical },
    { id: "fundamental", executionStage: "fundamental", required: true, execute: runFundamental },
    { id: "review", executionStage: "review", required: true, execute: runReview },
    { id: "decision", executionStage: "decision", required: true, execute: runDecision },
    { id: "risk_gate", executionStage: "risk_gate", required: true, execute: runRiskGate },
  ],
};
