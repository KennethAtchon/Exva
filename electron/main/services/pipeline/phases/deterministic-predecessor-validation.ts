import { getAIPhase } from "./registry";
import { PIPELINE_PHASES } from "@electron/shared/ai/ai-phase";
import { AppError } from "@electron/shared/infra/errors";

/** Fail review when AI stages omit deterministic predecessor declarations (Solution 07). */
export function assertAIPhaseDeterministicPredecessors(): void {
  const errors: string[] = [];

  for (const phase of PIPELINE_PHASES) {
    const plan = getAIPhase(phase);
    if (!plan) continue;

    const stageIds = new Set(plan.stages.map((stage) => stage.id));
    for (const stage of plan.stages) {
      if (stage.runDeterministic) continue;
      if (stage.frontier > 0 && !stage.deterministicPredecessors?.length) {
        errors.push(
          `Phase '${phase}' stage '${stage.id}' must declare deterministicPredecessors.`,
        );
      }

      for (const pred of stage.deterministicPredecessors ?? []) {
        if (!stageIds.has(pred)) {
          errors.push(
            `Phase '${phase}' stage '${stage.id}' references unknown predecessor '${pred}'.`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new AppError(
      `AI phase deterministic predecessor validation failed:\n${errors.join("\n")}`,
      "VALIDATION_FAILED",
      { errors },
    );
  }
}
