import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import type { PhaseWorkerResult } from "./registry";

/**
 * Finds the first worker result whose outputSchema matches the given schema
 * by reference equality, then returns its typed output.
 *
 * Schemas must be module-level constants imported from the same path so that
 * reference equality holds. Reconstructed schema objects will not match.
 *
 * Returns null if no matching worker result is found.
 */
export function pickWorkerOutput<T>(
  results: PhaseWorkerResult[],
  schema: WorkerDefinition["outputSchema"],
): T | null {
  for (const entry of results) {
    if (entry.worker.outputSchema === schema) {
      return entry.result.output as T;
    }
  }
  return null;
}
