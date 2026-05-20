import { AppError } from "@electron/shared/infra/errors";
import type { PipelinePhase, WorkerDefinition, WorkerToolRequirement } from "@electron/shared/ai/pipeline-phase";
import type { RunTrace } from "../../ai-runtime/ai-runtime-types";

export function extractToolNamesUsed(trace: RunTrace<unknown>): Set<string> {
  return new Set(trace.steps.flatMap((step) => step.toolCalls.map((call) => call.tool)));
}

export function enforceWorkerToolRequirements(
  worker: WorkerDefinition,
  phase: PipelinePhase,
  trace: RunTrace<unknown>,
): void {
  const requirement = worker.toolRequirements;
  if (!requirement) return;

  const toolNamesUsed = extractToolNamesUsed(trace);
  const toolCallCount = trace.steps.reduce((sum, step) => sum + step.toolCalls.length, 0);
  const usedList = [...toolNamesUsed].sort().join(", ") || "none";

  const missingAll = requirement.requiredAll?.filter((tool) => !toolNamesUsed.has(tool)) ?? [];
  if (missingAll.length > 0) {
    throw new AppError(
      `Worker ${worker.id} (phase ${phase}) missed required tool evidence: ${missingAll.join(", ")}. Used: [${usedList}].`,
      "VALIDATION_FAILED",
    );
  }

  if (
    requirement.requiredAny?.length &&
    !requirement.requiredAny.some((tool) => toolNamesUsed.has(tool))
  ) {
    throw new AppError(
      `Worker ${worker.id} (phase ${phase}) did not call any required evidence tool (need one of: ${requirement.requiredAny.join(", ")}). Used: [${usedList}].`,
      "VALIDATION_FAILED",
    );
  }

  if (requirement.minToolCalls != null && toolCallCount < requirement.minToolCalls) {
    throw new AppError(
      `Worker ${worker.id} (phase ${phase}) did not call required tools (expected >= ${requirement.minToolCalls}, got ${toolCallCount}). Used: [${usedList}].`,
      "VALIDATION_FAILED",
    );
  }
}

export function summarizeWorkerToolCoverage(
  workerId: string,
  requirement: WorkerToolRequirement | undefined,
  usedTools: readonly string[],
): {
  workerId: string;
  requiredTools: string[];
  usedTools: string[];
  satisfied: boolean;
} {
  const requiredTools = [
    ...(requirement?.requiredAll ?? []),
    ...(requirement?.requiredAny ?? []),
  ];
  const usedSet = new Set(usedTools);
  let satisfied = true;
  if (requirement?.requiredAll?.some((tool) => !usedSet.has(tool))) satisfied = false;
  if (requirement?.requiredAny?.length && !requirement.requiredAny.some((tool) => usedSet.has(tool))) {
    satisfied = false;
  }
  if (requirement?.minToolCalls != null && usedTools.length < requirement.minToolCalls) satisfied = false;
  return {
    workerId,
    requiredTools: [...new Set(requiredTools)],
    usedTools: [...usedSet],
    satisfied,
  };
}
