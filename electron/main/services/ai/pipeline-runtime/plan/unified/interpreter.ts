import { PhasePlanInterpreter } from "../phase/interpreter";
import { CyclePlanInterpreter } from "../cycle/interpreter";
import type { UnifiedPlanDefinition } from "./types";
import type { PhasePlanInterpreterRunInput } from "../phase/interpreter";
import type { CyclePlanInterpreterRunInput } from "../cycle/interpreter";
import type { TradePipelineResult } from "../cycle/types";
import type { PhasePlanRunResult } from "../phase/types";

/** Unified plan interpreter — dispatches to phase or cycle interpreters by plan kind. */
export class PlanInterpreter {
  private readonly phaseInterpreter = new PhasePlanInterpreter();
  private readonly cycleInterpreter = new CyclePlanInterpreter();

  runPhase<TOutput>(input: PhasePlanInterpreterRunInput): Promise<PhasePlanRunResult<TOutput>> {
    return this.phaseInterpreter.run<TOutput>(input);
  }

  runCycle(input: CyclePlanInterpreterRunInput): Promise<TradePipelineResult> {
    return this.cycleInterpreter.run(input);
  }

  run(plan: UnifiedPlanDefinition, input: PhasePlanInterpreterRunInput | CyclePlanInterpreterRunInput) {
    if (plan.kind === "phase") {
      return this.phaseInterpreter.run(input as PhasePlanInterpreterRunInput);
    }
    return this.cycleInterpreter.run(input as CyclePlanInterpreterRunInput);
  }
}

export { PhasePlanInterpreter, CyclePlanInterpreter };
