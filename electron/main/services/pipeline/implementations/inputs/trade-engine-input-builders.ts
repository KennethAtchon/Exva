import { AppError } from "@electron/shared/infra/errors";
import type { InstrumentClass } from "@/lib/types";
import type {
  AggregationTrace,
  DecisionCheck,
  RiskGateTrace,
  SizingTrace,
  TradeDecisionTrace,
} from "@electron/shared/domain";
import {
  isWaitForOpenRejection,
  type RiskGateType,
} from "../../../risk/risk-engine";
import { resolveAssetGroup } from "../../../risk/correlation-exposure-service";
import type { InstrumentAnalysisState } from "../../analysis/types";
import type {
  EngineInputBuilder,
  EngineRunCtx,
} from "../../execution/input-builder-registry";
import { createOutcomeError } from "../../../orchestration/cycle/runtime-outcome";
import { classifyRiskGateRejection } from "../../../orchestration/policy/outcome-classifier";
import { createLogger } from "../../../infra/log";
import {
  brokerSupportsOrder,
  type BrokerType,
} from "@electron/shared/domain/broker-capabilities";
import type { TradeSide } from "@electron/shared/domain/enums";
import type {
  EdgeEstimate,
  ExecutionCostEstimate,
} from "@electron/shared/domain/edge-estimate";
import { estimateExecutionCost } from "@electron/shared/quant/execution-cost-model";
import { allocateCapital, kellyFractionBinary } from "@electron/shared/quant/kelly";
import { requireExperience } from "../../../../experiences/index";

const logger = createLogger("trade-engine-input-builders");

/**
 * Pre-trade edge + execution-cost + capital-allocation analytics (P4/P5/P6).
 * Derives a proxy edge from the decision's confidence and take-profit/stop
 * (reward:risk), charges the experience's contract costs, and sizes via
 * fractional Kelly with caps. Returned for persistence and gating.
 */
function computePreTradeEconomics(input: {
  experienceId: string;
  instrumentClass: InstrumentClass;
  side: TradeSide;
  confidence: number;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  sizeUsd: number;
  maxPositionUsd: number;
  maxExposureUsd: number | null;
  currentExposureUsd: number;
  kellyFraction: number;
}): {
  edge: EdgeEstimate;
  cost: ExecutionCostEstimate;
  allocation: ReturnType<typeof allocateCapital>;
  expectedNetReturnBps: number;
} {
  const contract = (() => {
    try {
      return requireExperience(input.experienceId).researchContract;
    } catch {
      return null;
    }
  })();
  const costs = contract?.costs ?? {
    spreadBps: 0,
    slippageBps: 0,
    commissionBps: 0,
  };

  const tpBps = (input.takeProfitPct ?? 0) * 100;
  const slBps = (input.stopLossPct ?? 0) * 100;
  const confidence = Math.max(0, Math.min(1, input.confidence));
  const expectedGrossReturnBps = confidence * tpBps - (1 - confidence) * slBps;

  const cost = estimateExecutionCost({
    instrumentClass: input.instrumentClass,
    side: input.side,
    orderSizeUsd: input.sizeUsd,
    contractSpreadBps: costs.spreadBps,
    contractSlippageBps: costs.slippageBps,
    contractCommissionBps: costs.commissionBps,
    contractBorrowBps: costs.borrowBps,
  });
  const expectedCostBps =
    cost.expectedSpreadBps +
    cost.expectedSlippageBps +
    cost.expectedFeeBps +
    cost.expectedBorrowBps;
  const expectedNetReturnBps = expectedGrossReturnBps - expectedCostBps;

  const netOdds = slBps > 0 ? tpBps / slBps : 0;
  const rawKelly = kellyFractionBinary(confidence, netOdds);
  const bankroll =
    input.maxExposureUsd ?? Math.max(input.maxPositionUsd * 20, input.sizeUsd);
  const correlatedExposurePct =
    input.maxExposureUsd && input.maxExposureUsd > 0
      ? Math.min(1, input.currentExposureUsd / input.maxExposureUsd)
      : 0;
  const allocation = allocateCapital({
    bankrollUsd: bankroll,
    riskBudgetPct: 1,
    rawKellyFraction: rawKelly,
    // riskConfig.kellyFraction is already fractional (<1); never full Kelly.
    kellyMultiplier: Math.min(input.kellyFraction, 0.5),
    sampleSize: 1,
    requiredSampleSize: 1,
    correlatedExposurePct,
    maxPositionUsd: input.maxPositionUsd,
    maxExposureRemainingUsd: input.maxExposureUsd
      ? Math.max(0, input.maxExposureUsd - input.currentExposureUsd)
      : input.maxPositionUsd,
  });

  const edge: EdgeEstimate = {
    modelId: `rules:${input.experienceId}`,
    modelVersion: "proxy-1",
    asOf: new Date().toISOString(),
    targetHorizon: contract?.label.horizon ?? "1d",
    predictedProbability: confidence,
    expectedGrossReturnBps,
    expectedCostBps,
    expectedNetReturnBps,
    uncertaintyBps: slBps,
    calibrationBucket: null,
    sampleSize: 1,
  };

  return { edge, cost, allocation, expectedNetReturnBps };
}

/**
 * Write-through a decision-trace fragment for the current cycle. Called from
 * each gate's applyOutput *before* any throw, so cycles rejected mid-pipeline
 * still leave a durable trace. No-op when ctx is unavailable (legacy callers).
 */
function persistTraceFragment(
  ctx: EngineRunCtx | undefined,
  fragment: Partial<TradeDecisionTrace>,
): void {
  if (!ctx) return;
  try {
    ctx.services.decisionTracesRepo.upsertFragment(
      {
        cycleId: ctx.cycleId,
        sessionId: ctx.sessionId,
        instrumentSymbol: ctx.instrument.symbol,
      },
      fragment,
    );
  } catch (err) {
    logger.warn({ err, cycleId: ctx.cycleId }, "decision trace persist failed (non-blocking)");
  }
}

function buildAggregationTrace(
  state: InstrumentAnalysisState,
  ctx: EngineRunCtx,
): AggregationTrace {
  const decision = state.decision?.output;
  const threshold = ctx.strategyContext.riskConfig.waitForOpenThreshold ?? null;
  const confidence = decision?.confidence ?? null;
  const belowThreshold =
    threshold != null && confidence != null && confidence < threshold;
  const action = decision?.action ?? "skip";
  return {
    classifierConfidence: confidence,
    classifierAction: action,
    waitForOpenThreshold: threshold,
    belowThreshold,
    // Timer timing is embedded in the decision reasoning; not separately stored.
    timerTiming: null,
    timerBlocked: false,
    reviewRecommendation: state.review?.output.recommendation ?? null,
    finalAction: action,
    skipReason: action === "skip" ? (decision?.reasoning ?? null) : null,
  };
}

function applyRiskGateNoTrade(
  state: InstrumentAnalysisState,
  reason: string,
): InstrumentAnalysisState {
  const decision = state.decision;
  if (!decision) return state;
  return {
    ...state,
    riskOrder: undefined,
    brokerAllocation: undefined,
    decision: {
      ...decision,
      output: {
        ...decision.output,
        action: "skip",
        reasoning: reason,
      },
    },
  };
}

const candidateValidationInputBuilder: EngineInputBuilder = {
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
        selectionMode: ctx.session.selectionMode,
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

const executionProfileInputBuilder: EngineInputBuilder = {
  id: "execution-profile",
  build({ planCtx: ctx, state }) {
    const decision = state.decision;
    if (!decision) {
      throw new Error(
        "execution-profile input builder requires decision in state",
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
        reviewRecommendation: state.review?.output.recommendation ?? "proceed",
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
  async build({ planCtx: ctx, state }) {
    const decision = state.decision;
    const executionProfile = state.executionProfile;
    if (!decision || !executionProfile) {
      throw new Error(
        "risk-gate input builder requires decision and executionProfile in state",
      );
    }

    const { adapter } = await ctx.services.brokerRouting.resolveAdapter(
      ctx.sessionId,
      ctx.instrument.instrumentClass,
    );
    const side = executionProfile.side as TradeSide;
    if (
      !brokerSupportsOrder(
        adapter.brokerType as BrokerType,
        ctx.instrument.instrumentClass,
        side,
      )
    ) {
      throw createOutcomeError(
        `Broker ${adapter.brokerType} does not support ${side} orders for ${ctx.instrument.instrumentClass} (${ctx.instrument.symbol})`,
        "VALIDATION_FAILED",
        { outcome: "no_trade", reasonCategory: "broker_capability" },
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

    const sessionRow = ctx.services.sessionRepo.requireById(ctx.sessionId);
    const sizeMultiplier =
      ctx.services.experienceCapitalAllocator?.multiplierForExperience(
        sessionRow.experienceId,
      ) ?? 1;
    const scaledSizeUsd = executionProfile.positionSizeUsd * sizeMultiplier;

    const openTrades = ctx.services.tradesRepo.listOpenAndPending(
      ctx.sessionId,
    );
    const openExposureByGroupUsd: Partial<
      Record<ReturnType<typeof resolveAssetGroup>, number>
    > = {};
    let currentExposureUsd = 0;
    for (const t of openTrades) {
      if (t.status !== "open") continue;
      currentExposureUsd += t.position_size_usd;
      const group = resolveAssetGroup(
        t.instrumentType as InstrumentClass,
        t.instrumentSymbol,
      );
      openExposureByGroupUsd[group] =
        (openExposureByGroupUsd[group] ?? 0) + t.position_size_usd;
    }
    const assetGroup = resolveAssetGroup(
      ctx.instrument.instrumentClass,
      ctx.instrument.symbol,
    );
    const maxSameGroupExposureUsd =
      ctx.strategyContext.riskConfig.maxPositionUsd * 3;

    // P4/P5/P6: compute pre-trade edge, cost hurdle, and capital-allocator
    // size. Persist to the decision trace (observability), cap the order to the
    // allocator recommendation, and skip negative-expectancy trades.
    const economics = computePreTradeEconomics({
      experienceId: sessionRow.experienceId,
      instrumentClass: ctx.instrument.instrumentClass,
      side,
      confidence: decision.output.confidence,
      takeProfitPct: executionProfile.takeProfitPct,
      stopLossPct: executionProfile.stopLossPct,
      sizeUsd: scaledSizeUsd,
      maxPositionUsd: ctx.strategyContext.riskConfig.maxPositionUsd,
      maxExposureUsd: ctx.strategyContext.riskConfig.maxExposureUsd ?? null,
      currentExposureUsd,
      kellyFraction: ctx.strategyContext.riskConfig.kellyFraction,
    });
    persistTraceFragment(ctx, {
      edgeEstimate: economics.edge,
      executionCost: economics.cost,
      capitalAllocation: {
        recommendedSizeUsd: economics.allocation.sizeUsd,
        fractionalKelly: economics.allocation.fractionalKelly,
        cappedBy: economics.allocation.cappedBy,
      },
    });
    if (economics.expectedNetReturnBps < 0) {
      throw createOutcomeError(
        `Edge does not survive execution cost: expected net ${economics.expectedNetReturnBps.toFixed(1)}bps for ${ctx.instrument.symbol}`,
        "VALIDATION_FAILED",
        { outcome: "no_trade", reasonCategory: "cost_gate" },
      );
    }
    // Cap to the allocator recommendation when it is positive and smaller.
    const allocatorSizeUsd =
      economics.allocation.sizeUsd > 0
        ? Math.min(scaledSizeUsd, economics.allocation.sizeUsd)
        : scaledSizeUsd;

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
          sizeUsd: allocatorSizeUsd,
        },
        confidence: decision.output.confidence,
        quoteSnapshot: state.quoteSnapshot,
        volatilityHaltMaxSpreadPct:
          ctx.strategyContext.riskConfig.volatilityHaltMaxSpreadPct,
        assetGroup,
        openExposureByGroupUsd,
        maxSameGroupExposureUsd,
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
      gateType?: string;
      value?: typeof state.riskOrder;
    };
    if (!risk.allowed || !risk.value) {
      if (isWaitForOpenRejection(risk.reason)) {
        return applyRiskGateNoTrade(
          state,
          risk.reason ?? "Decision confidence is below wait-for-open threshold",
        );
      }
      throw classifyRiskGateRejection({
        reason: risk.reason,
        gateType: risk.gateType as RiskGateType | undefined,
      });
    }
    return { ...state, riskOrder: risk.value };
  },
};

const brokerAllocationInputBuilder: EngineInputBuilder = {
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
      throw createOutcomeError(
        brokerAllocation?.allocation.reason ??
          "Broker allocation rejected order",
        "VALIDATION_FAILED",
        {
          outcome: "session_capacity",
          reasonCategory: "session_capacity",
        },
      );
    }
    if (!brokerAllocation.conflict.ok) {
      throw createOutcomeError(
        brokerAllocation.conflict.reason ?? "Instrument conflict blocked order",
        "VALIDATION_FAILED",
        {
          outcome: "no_trade",
          reasonCategory: "broker_allocation",
        },
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
