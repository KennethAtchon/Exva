/**
 * Phase catalog — derives PipelineDefinition metadata for the renderer and
 * effective config layer directly from AIPhase objects in ALL_PHASES.
 *
 * To add a new phase:
 *   1. Create definitions/[name].phase.ts with an AIPhase that includes:
 *      - `catalog` (outputMode, outputSchema, engines)
 *      - `resolveWorkersForMode`
 *      - A side-effect import of its finalizer engine file
 *   2. Add the phase to definitions/all-phases.ts (ALL_PHASES).
 *   3. Create engines/finalizer/[name]-aggregator.ts.
 *
 * No changes needed in this file for new phases.
 */

import type {
  PipelineDefinition,
  PipelinePhase,
  WorkerDefinition,
} from "@electron/shared/ai/ai-phase";
import type { AIPhase } from "../phases/types";
import { ALL_PHASES } from "./all-phases";
import { requirePipelineDescriptor } from "../implementations/registry/pipeline-descriptor-store";
import { DEFAULT_PIPELINE_ID } from "../pipeline-constants";
import { resolvePipelinePhaseWorkers } from "../pipeline-phase-worker-resolver";
import { PIPELINE_WORKER_SETS, resolveWorkersByIds } from "../worker-registry";

function requireCatalog(
  phase: AIPhase<unknown, unknown>,
): NonNullable<AIPhase<unknown, unknown>["catalog"]> {
  if (!phase.catalog) {
    throw new Error(
      `Phase '${phase.phase}' is missing a catalog field. ` +
        `Set catalog: { outputMode, outputSchema?, engines? } on the AIPhase object.`,
    );
  }
  return phase.catalog;
}

/**
 * Indexes ALL_PHASES by phase ID. Built eagerly — any missing catalog field
 * throws immediately at module load time.
 */
const PHASE_INDEX = new Map<PipelinePhase, AIPhase<unknown, unknown>>(
  ALL_PHASES.map((p) => [p.phase, p]),
);

// Validate catalog fields eagerly — catch missing fields at module load.
for (const phase of PHASE_INDEX.values()) {
  requireCatalog(phase);
}

/**
 * Resolves workers for a pipeline phase from the pipeline descriptor graph.
 */
export function resolvePhaseWorkers(
  phase: PipelinePhase,
  pipelineId = DEFAULT_PIPELINE_ID,
): readonly WorkerDefinition[] {
  try {
    if (phase === "selector") {
      try {
        const descriptor = requirePipelineDescriptor(pipelineId);
        const ids = descriptor.selectorWorkerIds ?? [];
        if (ids.length > 0) return resolveWorkersByIds(ids);
      } catch {
        // Registry not populated yet at module load — fall back to default graph.
      }
      return resolveWorkersByIds(PIPELINE_WORKER_SETS.selector.standard);
    }
    return resolvePipelinePhaseWorkers(pipelineId, phase);
  } catch {
    return [];
  }
}

/**
 * Returns the full PipelineDefinition for a phase, with workers resolved
 * using the default "catalyst" processing mode. The catalog is used for
 * validation and renderer metadata; execution always resolves workers
 * via resolvePhaseWorkers(phase, actualDiscoveryMode).
 */
export function getPhaseCatalog(phase: PipelinePhase): PipelineDefinition {
  const p = PHASE_INDEX.get(phase);
  if (!p) throw new Error(`Phase '${phase}' is not in ALL_PHASES`);
  const cat = requireCatalog(p);
  return {
    phase: p.phase,
    outputMode: cat.outputMode,
    ...(cat.outputSchema !== undefined && { outputSchema: cat.outputSchema }),
    ...(cat.engines !== undefined && { engines: cat.engines }),
    workers: [...resolvePhaseWorkers(phase, DEFAULT_PIPELINE_ID)],
    persistence: {
      outputSchemaName: p.outputSchemaName ?? null,
      traceMode: cat.traceMode ?? "aggregate_workers",
    },
  } as PipelineDefinition;
}

export function listPhaseCatalog(): Array<{
  phase: PipelinePhase;
  definition: PipelineDefinition;
}> {
  return [...PHASE_INDEX.keys()].map((phase) => ({
    phase,
    definition: getPhaseCatalog(phase),
  }));
}
