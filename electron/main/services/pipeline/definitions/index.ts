// Register all engines before phases. Selector input/entry/cache engines live
// in engines/; aggregator finalizer engines self-register via their phase files.
import "../engines";
import { registerAIPhase } from "../phases/registry";
import { resolveEngine } from "../engines/registry";
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

/**
 * Validates that every engine ID declared in all phase definitions is actually
 * registered in the engine registry. Call this after registerAllPhases() in the
 * boot sequence to catch missing engine registrations at startup rather than at
 * runtime when a phase first executes.
 *
 * Throws if any engine ID is missing or has the wrong kind.
 */
export function validatePhaseEngines(): void {
  const errors: string[] = [];

  for (const phase of ALL_PHASES) {
    const prefix = `Phase '${phase.phase}'`;

    for (const id of phase.inputEngineIds ?? []) {
      try {
        resolveEngine(id, "input");
      } catch (err) {
        errors.push(`${prefix} inputEngineId '${id}': ${String(err)}`);
      }
    }

    for (const id of phase.entryEngineIds ?? []) {
      try {
        resolveEngine(id, "entry_mode");
      } catch (err) {
        errors.push(`${prefix} entryEngineId '${id}': ${String(err)}`);
      }
    }

    if (phase.cacheEngineId) {
      try {
        resolveEngine(phase.cacheEngineId, "cache");
      } catch (err) {
        errors.push(`${prefix} cacheEngineId '${phase.cacheEngineId}': ${String(err)}`);
      }
    }

    for (const id of phase.finalizeEngineIds ?? []) {
      try {
        resolveEngine(id, "finalizer");
      } catch (err) {
        errors.push(`${prefix} finalizeEngineId '${id}': ${String(err)}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Phase engine validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
}
