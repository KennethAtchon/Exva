import type { LLMRunResult } from "../../../llm/llm-types";
import type {
  FundamentalSignal,
  ReviewSignal,
} from "@electron/shared/ai/trade-signals";
import { decodeForecastSummary } from "@electron/shared/ai/prediction-research";
import { buildTradeAnalysisSteps } from "../trade/default-analysis-steps";
import type { DeclarativeCycleStageConfig } from "../../execution/input-builder-registry";
import type {
  InstrumentAnalysis,
  InstrumentAnalysisState,
} from "../../analysis/types";

/**
 * Prediction-market cycle (Part C): an LLM forecaster researches the market
 * (fundamental phase) and a red team challenges it (review phase); a
 * deterministic edge gate then decides and sizes (decision phase). No LLM in
 * the decision — the model forms the view, the math takes the trade.
 */
const PREDICTION_EDGE_STAGES: readonly DeclarativeCycleStageConfig[] = [
  {
    id: "fundamental",
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
    id: "review",
    kind: "phase",
    phase: "review",
    executionStage: "review",
    required: true,
    buildInput: (ctx, state) => {
      const forecast = decodeForecastSummary(
        state.fundamental?.output.rawSummary,
      );
      return {
        instrumentSymbol: ctx.instrument.symbol,
        // Surfaces {forecastPHat} for the red-team prompt to attack.
        forecastPHat: forecast?.pHat ?? null,
        recentFailureHistory: ctx.instrument.recentFailureHistory ?? [],
      };
    },
    applyOutput: (state, result) => ({
      ...state,
      review: result as LLMRunResult<ReviewSignal>,
    }),
  },
  {
    id: "prediction_decision",
    kind: "engine",
    executionStage: "decision",
    required: true,
    failurePolicy: "fail",
    engine: {
      engineId: "prediction-edge",
      engineKind: "policy",
      inputBuilderId: "prediction-edge-input",
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

export const PREDICTION_EDGE_CYCLE: InstrumentAnalysis<InstrumentAnalysisState> =
  {
    id: "prediction-edge-cycle",
    initialState: (_ctx, seed = {}) => ({ ...seed }),
    inspect: {
      stageIds: PREDICTION_EDGE_STAGES.map((s) => s.id),
      phaseStages: ["fundamental", "review", "decision"],
      engineStages: [
        "prediction-edge",
        "trade-execution-profile",
        "risk-gate",
        "broker-allocation",
      ],
    },
    stages: buildTradeAnalysisSteps(PREDICTION_EDGE_STAGES),
  };
