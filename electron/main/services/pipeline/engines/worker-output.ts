import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import type { LLMRunResult } from "../../llm/llm-types";

type WorkerResult = { worker: WorkerDefinition; result: LLMRunResult<unknown> };

export function pickWorkerOutput<T>(
  results: WorkerResult[],
  schema: WorkerDefinition["outputSchema"],
): T | null {
  for (const entry of results) {
    if (entry.worker.outputSchema === schema) {
      return entry.result.output as T;
    }
  }
  return null;
}
