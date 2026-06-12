import type {
  PipelinePhase,
  PipelineDefinition,
} from "@electron/shared/ai/ai-phase";
import { AppError } from "@electron/shared/infra/errors";
import { listPhaseCatalog } from "../definitions/phase-catalog";
import { SUPPORTED_TOOL_IDS } from "../worker-tools/worker-tool-factory";

export { listPhaseCatalog as listPipelineDefinitions };

const SUPPORTED_TOOL_ID_SET = new Set<string>(SUPPORTED_TOOL_IDS);

function validatePipelineDefinition(
  phase: PipelinePhase,
  definition: PipelineDefinition,
): void {
  if (definition.phase !== phase) {
    throw new AppError(
      `Pipeline definition mismatch: registry key '${phase}' does not match definition phase '${definition.phase}'.`,
      "VALIDATION_FAILED",
    );
  }

  if (definition.workers.length === 0) {
    throw new AppError(
      `Pipeline definition '${phase}' has no workers.`,
      "VALIDATION_FAILED",
    );
  }

  if (definition.outputMode === "object" && !definition.outputSchema) {
    throw new AppError(
      `Pipeline definition '${phase}' uses object mode without outputSchema.`,
      "VALIDATION_FAILED",
    );
  }

  const workerIds = new Set<string>();
  for (const worker of definition.workers) {
    if (!worker.id.trim()) {
      throw new AppError(
        `Pipeline definition '${phase}' contains a worker with empty id.`,
        "VALIDATION_FAILED",
      );
    }
    if (workerIds.has(worker.id)) {
      throw new AppError(
        `Pipeline definition '${phase}' has duplicate worker id '${worker.id}'.`,
        "VALIDATION_FAILED",
      );
    }
    workerIds.add(worker.id);

    if (worker.outputMode === "tool_result" && !worker.outputSchema) {
      throw new AppError(
        `Worker '${worker.id}' in phase '${phase}' uses tool_result mode without outputSchema.`,
        "VALIDATION_FAILED",
      );
    }

    for (const toolId of worker.tools) {
      if (!SUPPORTED_TOOL_ID_SET.has(toolId)) {
        throw new AppError(
          `Worker '${worker.id}' in phase '${phase}' references unknown tool '${toolId}'.`,
          "VALIDATION_FAILED",
        );
      }
    }
  }

  const adjacency = new Map<string, readonly string[]>();
  for (const worker of definition.workers) {
    const deps = worker.dependsOn ?? [];
    for (const dep of deps) {
      if (!workerIds.has(dep)) {
        throw new AppError(
          `Worker '${worker.id}' in phase '${phase}' depends on unknown worker '${dep}'.`,
          "VALIDATION_FAILED",
        );
      }
      if (dep === worker.id) {
        throw new AppError(
          `Worker '${worker.id}' in phase '${phase}' cannot depend on itself.`,
          "VALIDATION_FAILED",
        );
      }
    }
    adjacency.set(worker.id, deps);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (node: string): void => {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      throw new AppError(
        `Pipeline definition '${phase}' contains a dependency cycle at worker '${node}'.`,
        "VALIDATION_FAILED",
      );
    }
    visiting.add(node);
    for (const dep of adjacency.get(node) ?? []) dfs(dep);
    visiting.delete(node);
    visited.add(node);
  };

  for (const workerId of workerIds) dfs(workerId);
}

/** Called at boot after workers and pipelines are registered. */
export function assertValidPipelineDefinitionRegistry(): void {
  for (const { phase, definition } of listPhaseCatalog()) {
    validatePipelineDefinition(phase, definition);
  }
}
