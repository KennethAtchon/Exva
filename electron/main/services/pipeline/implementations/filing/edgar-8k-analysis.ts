import type {
  InstrumentAnalysis,
  InstrumentAnalysisState,
} from "../../analysis/types";
import type { LLMRunResult } from "../../../llm/llm-types";
import type {
  FundamentalSignal,
  ReviewSignal,
} from "@electron/shared/ai/trade-signals";
import type { DeclarativeCycleStageConfig } from "../../execution/input-builder-registry";
import { buildTradeAnalysisSteps } from "../trade/default-analysis-steps";
import {
  aggregateAdversarialReview,
  aggregateCatalystTradeSignal,
  type AdversarialReviewerOutput,
  type CatalystAnalystOutput,
} from "../../../signals/aggregators/catalyst-two-call-aggregator";

function requirePhaseOutput<T>(
  result: LLMRunResult<T> | undefined,
  name: string,
): LLMRunResult<T> {
  if (!result) {
    throw new Error(`${name} phase output is required before decision.`);
  }
  return result;
}

/** Two-call EDGAR cycle: catalyst-analyst → adversarial-reviewer → deterministic decision. */
const EDGAR_8K_STAGES: readonly DeclarativeCycleStageConfig[] = [
  {
    id: "catalyst_analysis",
    kind: "phase",
    phase: "fundamental",
    executionStage: "fundamental",
    required: true,
    buildInput: (ctx) => ({
      instrumentSymbol: ctx.instrument.symbol,
      selectorEvidence: ctx.instrument.selectorEvidence ?? null,
      recentFailureHistory: ctx.instrument.recentFailureHistory ?? [],
    }),
    applyOutput: (state, result) => ({
      ...state,
      fundamental: result as LLMRunResult<FundamentalSignal>,
    }),
  },
  {
    id: "adversarial_review",
    kind: "phase",
    phase: "review",
    executionStage: "review",
    required: true,
    buildInput: (ctx, state) => {
      const fundamental = requirePhaseOutput(state.fundamental, "fundamental");
      return {
        instrumentSymbol: ctx.instrument.symbol,
        analystOutput: JSON.stringify(fundamental.output),
        recentFailureHistory: ctx.instrument.recentFailureHistory ?? [],
      };
    },
    applyOutput: (state, result) => ({
      ...state,
      review: result as LLMRunResult<ReviewSignal>,
    }),
  },
  {
    id: "catalyst_decision",
    kind: "engine",
    executionStage: "decision",
    required: true,
    failurePolicy: "fail",
    engine: {
      engineId: "catalyst-trade-decision",
      engineKind: "policy",
      inputBuilderId: "catalyst-trade-decision-input",
      bindingPhase: "decision",
    },
  },
  {
    id: "risk_gate",
    kind: "engine-chain",
    skipIf: (state) => state.decision?.output.action === "skip",
    executionStage: "risk_gate",
    required: true,
    failurePolicy: "reject_trade",
    engines: [
      {
        engineId: "trade-execution-profile",
        engineKind: "execution",
        inputBuilderId: "execution-profile",
        bindingPhase: "decision",
      },
      {
        engineId: "risk-gate",
        engineKind: "policy",
        inputBuilderId: "risk-gate",
        bindingPhase: "decision",
      },
      {
        engineId: "broker-allocation",
        engineKind: "policy",
        inputBuilderId: "broker-allocation",
        bindingPhase: "decision",
      },
    ],
  },
];

export const EDGAR_8K_TRADE_CYCLE: InstrumentAnalysis<InstrumentAnalysisState> =
  {
    id: "edgar-8k-cycle",
    initialState: (_ctx, seed = {}) => ({ ...seed }),
    inspect: {
      stageIds: EDGAR_8K_STAGES.map((s) => s.id),
      phaseStages: ["fundamental", "review", "decision"],
      engineStages: [
        "catalyst-trade-decision",
        "trade-execution-profile",
        "risk-gate",
        "broker-allocation",
      ],
    },
    stages: buildTradeAnalysisSteps(EDGAR_8K_STAGES),
  };

export {
  aggregateAdversarialReview,
  aggregateCatalystTradeSignal,
  type CatalystAnalystOutput,
  type AdversarialReviewerOutput,
};
