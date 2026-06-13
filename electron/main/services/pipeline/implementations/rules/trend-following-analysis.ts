import type { DeclarativeCycleStageConfig } from "../../execution/input-builder-registry";
import { buildTradeAnalysisSteps } from "../trade/default-analysis-steps";
import type {
  InstrumentAnalysis,
  InstrumentAnalysisState,
} from "../../analysis/types";

const RULES_TREND_FOLLOWING_STAGES: readonly DeclarativeCycleStageConfig[] = [
  {
    id: "rules_decision",
    kind: "engine",
    executionStage: "decision",
    required: true,
    failurePolicy: "fail",
    engine: {
      engineId: "rules-trend-following",
      engineKind: "policy",
      inputBuilderId: "rules-trend-following-input",
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

export const RULES_TREND_FOLLOWING_CYCLE: InstrumentAnalysis<InstrumentAnalysisState> =
  {
    id: "rules-trend-following-cycle",
    initialState: (_ctx, seed = {}) => ({ ...seed }),
    inspect: {
      stageIds: RULES_TREND_FOLLOWING_STAGES.map((s) => s.id),
      phaseStages: ["decision"],
      engineStages: [
        "rules-trend-following",
        "trade-execution-profile",
        "risk-gate",
        "broker-allocation",
      ],
    },
    stages: buildTradeAnalysisSteps(RULES_TREND_FOLLOWING_STAGES),
  };
