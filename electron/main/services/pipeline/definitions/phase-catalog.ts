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
import type { ResearchDiscoveryMode } from "@electron/shared/domain";
import type { AIPhase } from "../phases/types";
import { ALL_PHASES } from "./all-phases";

type WorkerResolver = (
  discoveryMode: ResearchDiscoveryMode,
) => readonly WorkerDefinition[];

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

function requireResolver(phase: AIPhase<unknown, unknown>): WorkerResolver {
  if (!phase.resolveWorkersForMode) {
    throw new Error(
      `Phase '${phase.phase}' must declare resolveWorkersForMode to participate in the phase catalog.`,
    );
  }
  return phase.resolveWorkersForMode as WorkerResolver;
}

/**
 * Indexes ALL_PHASES by phase ID. Built eagerly — any missing catalog or
 * resolveWorkersForMode field throws immediately at module load time.
 */
const PHASE_INDEX = new Map<
  PipelinePhase,
  { phase: AIPhase<unknown, unknown>; resolver: WorkerResolver }
>(
  ALL_PHASES.map((p) => [
    p.phase,
    { phase: p, resolver: requireResolver(p) },
  ]),
);

// Validate catalog fields eagerly — catch missing fields at module load.
for (const { phase } of PHASE_INDEX.values()) {
  requireCatalog(phase);
}

/**
 * Resolves the workers a phase will run for a given discovery mode.
 *
 * Delegates to the AIPhase's resolveWorkersForMode(), which is the same
 * function the runtime's stages[].resolveWorkers() calls — so execution and
 * metadata always agree.
 */
export function resolvePhaseWorkers(
  phase: PipelinePhase,
  discoveryMode: ResearchDiscoveryMode,
): readonly WorkerDefinition[] {
  return PHASE_INDEX.get(phase)?.resolver(discoveryMode) ?? [];
}

/**
 * Returns the full PipelineDefinition for a phase, with workers resolved
 * using the default "trend_scan" discovery mode. The catalog is used for
 * validation and renderer metadata; execution always resolves workers
 * via resolvePhaseWorkers(phase, actualDiscoveryMode).
 */
export function getPhaseCatalog(phase: PipelinePhase): PipelineDefinition {
  const entry = PHASE_INDEX.get(phase);
  if (!entry) throw new Error(`Phase '${phase}' is not in ALL_PHASES`);
  const { phase: p, resolver } = entry;
  const cat = requireCatalog(p);
  return {
    phase: p.phase,
    outputMode: cat.outputMode,
    ...(cat.outputSchema !== undefined && { outputSchema: cat.outputSchema }),
    ...(cat.engines !== undefined && { engines: cat.engines }),
    workers: [...resolver("trend_scan")],
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
