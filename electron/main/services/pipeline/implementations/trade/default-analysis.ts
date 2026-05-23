import type { InstrumentAnalysis, InstrumentAnalysisState } from "../../analysis/types";
import {
  buildTradeAnalysisSteps,
  tradeCycleInspectMetadata,
} from "./default-analysis-steps";

export const DEFAULT_TRADE_CYCLE: InstrumentAnalysis<InstrumentAnalysisState> = {
  id: "default-trade-cycle",
  initialState: (_ctx, seed = {}) => ({ ...seed }),
  inspect: tradeCycleInspectMetadata(),
  stages: buildTradeAnalysisSteps(),
};
