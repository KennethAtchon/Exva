import type { DeclarativeCycleStageConfig } from "../../execution/input-builder-registry";
import { buildTradeAnalysisSteps } from "../trade/default-analysis-steps";
import type {
  InstrumentAnalysis,
  InstrumentAnalysisState,
} from "../../analysis/types";

const OPTIONS_FLOW_STAGES: readonly DeclarativeCycleStageConfig[] = [
  {
    id: "options_flow_decision",
    kind: "engine",
    executionStage: "decision",
    required: true,
    failurePolicy: "fail",
    engine: {
      engineId: "options-flow",
      engineKind: "policy",
      inputBuilderId: "options-flow-input",
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

export const OPTIONS_FLOW_CYCLE: InstrumentAnalysis<InstrumentAnalysisState> = {
  id: "options-flow-cycle",
  initialState: (_ctx, seed = {}) => ({ ...seed }),
  inspect: {
    stageIds: OPTIONS_FLOW_STAGES.map((s) => s.id),
    phaseStages: ["decision"],
    engineStages: [
      "options-flow",
      "trade-execution-profile",
      "risk-gate",
      "broker-allocation",
    ],
  },
  stages: buildTradeAnalysisSteps(OPTIONS_FLOW_STAGES),
};
