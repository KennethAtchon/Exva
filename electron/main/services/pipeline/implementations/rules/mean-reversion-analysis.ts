import type {
  InstrumentAnalysis,
  InstrumentAnalysisState,
} from "../../analysis/types";
import type { LLMRunResult } from "../../../llm/llm-types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import type { DeclarativeCycleStageConfig } from "../../execution/input-builder-registry";
import { buildTradeAnalysisSteps } from "../trade/default-analysis-steps";

const RULES_MEAN_REVERSION_STAGES: readonly DeclarativeCycleStageConfig[] = [
  {
    id: "rules_decision",
    kind: "engine",
    executionStage: "decision",
    required: true,
    failurePolicy: "fail",
    engine: {
      engineId: "rules-mean-reversion",
      engineKind: "policy",
      inputBuilderId: "rules-mean-reversion-input",
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

export const RULES_MEAN_REVERSION_CYCLE: InstrumentAnalysis<InstrumentAnalysisState> =
  {
    id: "rules-mean-reversion-cycle",
    initialState: (_ctx, seed = {}) => ({ ...seed }),
    inspect: {
      stageIds: RULES_MEAN_REVERSION_STAGES.map((s) => s.id),
      phaseStages: ["decision"],
      engineStages: [
        "rules-mean-reversion",
        "trade-execution-profile",
        "risk-gate",
        "broker-allocation",
      ],
    },
    stages: buildTradeAnalysisSteps(RULES_MEAN_REVERSION_STAGES),
  };

export function rulesDecisionFromState(
  state: InstrumentAnalysisState,
): LLMRunResult<TradeSignal> | undefined {
  return state.decision;
}
