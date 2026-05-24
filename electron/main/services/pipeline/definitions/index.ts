import "../engines";
import { registerAIPhase } from "../phases/registry";
import { resolveEngine } from "../engines/registry";
import { registerUnifiedPlanRef } from "../implementations/registry/analysis-resolver";
import { DECISION_PHASE } from "./decision.phase";
import { FUNDAMENTAL_PHASE } from "./fundamental.phase";
import { REVIEW_PHASE } from "./review.phase";
import { SELECTOR_PHASE } from "./selector.phase";
import { TECHNICAL_PHASE } from "./technical.phase";
import type { AIPhase } from "../phases/types";

export const ALL_PHASES = [
  SELECTOR_PHASE,
  TECHNICAL_PHASE,
  FUNDAMENTAL_PHASE,
  REVIEW_PHASE,
  DECISION_PHASE,
] as const satisfies readonly AIPhase<unknown, unknown>[];

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
