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
  } catch {
    // Trace persistence is observability-only; never block the trade pipeline.
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
    for (const t of openTrades) {
      if (t.status !== "open") continue;
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
          sizeUsd: scaledSizeUsd,
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
