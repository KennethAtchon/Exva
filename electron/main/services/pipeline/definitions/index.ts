// Register all engines before phases. Selector input/entry/cache engines live
// in engines/; aggregator finalizer engines self-register via their phase files.
import "../engines";
import { registerAIPhase } from "../phases/registry";
import { registerUnifiedPlanRef } from "../implementations/registry/analysis-resolver";
import { ALL_PHASES } from "./all-phases";

export { ALL_PHASES } from "./all-phases";

export function registerAllPhases(): void {
  for (const phase of ALL_PHASES) {
    registerAIPhase(phase);
    // Makes phase IDs appear in listAnalysisIds() alongside trade cycle analyses,
    // so the analysis resolver can look up phases by their string ID the same way
    // it looks up instrument analyses.
    registerUnifiedPlanRef(phase.phase);
  }
}
