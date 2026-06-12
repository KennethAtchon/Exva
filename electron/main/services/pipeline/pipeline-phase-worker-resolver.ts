import type {
  PipelinePhase,
  WorkerDefinition,
} from "@electron/shared/ai/ai-phase";
import { requirePipelineDescriptor } from "./implementations/registry/pipeline-descriptor-store";
import {
  resolvePipelinePhaseWorkerIds,
  resolveWorkersByIds,
} from "./worker-registry";

/** Resolves workers for a pipeline phase from the descriptor's worker graph. */
export function resolvePipelinePhaseWorkers(
  pipelineId: string,
  phase: PipelinePhase,
): readonly WorkerDefinition[] {
  const descriptor = requirePipelineDescriptor(pipelineId);
  const ids = resolvePipelinePhaseWorkerIds(descriptor.phaseWorkers, phase);
  return resolveWorkersByIds(ids);
}
