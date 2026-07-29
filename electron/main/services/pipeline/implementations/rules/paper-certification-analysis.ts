import type {
  InstrumentAnalysis,
  InstrumentAnalysisState,
} from "../../analysis/types";
import type { DeclarativeCycleStageConfig } from "../../execution/input-builder-registry";
import { buildTradeAnalysisSteps } from "../trade/default-analysis-steps";

/**
 * Placeholder cycle for paper-execution-canary. Real order path is
 * PaperCertificationService — this plan exists so the experience registry
 * can resolve a pipelineId.
 */
const PAPER_CERTIFICATION_STAGES: readonly DeclarativeCycleStageConfig[] = [
  {
    id: "certification_noop",
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
];

export const PAPER_CERTIFICATION_CYCLE: InstrumentAnalysis<InstrumentAnalysisState> =
  {
    id: "paper-certification",
    initialState: (_ctx, seed = {}) => ({ ...seed }),
    inspect: {
      stageIds: PAPER_CERTIFICATION_STAGES.map((s) => s.id),
      phaseStages: ["decision"],
      engineStages: ["rules-mean-reversion"],
    },
    stages: buildTradeAnalysisSteps(PAPER_CERTIFICATION_STAGES),
  };
