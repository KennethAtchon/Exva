import type {
  InstrumentAnalysis,
  InstrumentAnalysisState,
} from "../../analysis/types";
import {
  DEFAULT_TRADE_CYCLE_STAGES,
  buildTradeAnalysisSteps,
  tradeCycleInspectMetadata,
} from "../trade/default-analysis-steps";

/**
 * EDGAR 8-K cycle. The filing already establishes the instrument (the signal is
 * self-describing and short-circuits the selector), so this cycle drops the
 * `candidate_validation` engine pre-stage that the default cycle runs to
 * validate discovered candidates. The AI phases are unchanged from the default
 * (technical → fundamental → review → decision) plus the risk gate.
 */
const EDGAR_8K_STAGES = DEFAULT_TRADE_CYCLE_STAGES.filter(
  (stage) => stage.id !== "candidate_validation",
);

export const EDGAR_8K_TRADE_CYCLE: InstrumentAnalysis<InstrumentAnalysisState> =
  {
    id: "edgar-8k-cycle",
    initialState: (_ctx, seed = {}) => ({ ...seed }),
    inspect: tradeCycleInspectMetadata(EDGAR_8K_STAGES),
    stages: buildTradeAnalysisSteps(EDGAR_8K_STAGES),
  };
