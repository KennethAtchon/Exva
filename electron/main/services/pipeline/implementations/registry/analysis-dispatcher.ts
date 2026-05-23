import { AIPhaseRunner } from "../../phases/interpreter";
import { InstrumentAnalysisRunner } from "../../analysis/interpreter";
import type { AnyAnalysisDefinition } from "./analysis-kinds";
import type { AIPhaseRunInput } from "../../phases/interpreter";
import type { InstrumentAnalysisRunInput } from "../../analysis/interpreter";
import type { InstrumentAnalysisResult } from "../../analysis/types";
import type { AIPhaseResult } from "../../phases/types";

/** Unified plan interpreter — dispatches to phase or cycle interpreters by plan kind. */
export class AnalysisDispatcher {
  private readonly phaseInterpreter = new AIPhaseRunner();
  private readonly cycleInterpreter = new InstrumentAnalysisRunner();

  runPhase<TOutput>(
    input: AIPhaseRunInput,
  ): Promise<AIPhaseResult<TOutput>> {
    return this.phaseInterpreter.run<TOutput>(input);
  }

  runCycle(input: InstrumentAnalysisRunInput): Promise<InstrumentAnalysisResult> {
    return this.cycleInterpreter.run(input);
  }

  run(
    plan: AnyAnalysisDefinition,
    input: AIPhaseRunInput | InstrumentAnalysisRunInput,
  ) {
    if (plan.kind === "phase") {
      return this.phaseInterpreter.run(input as AIPhaseRunInput);
    }
    return this.cycleInterpreter.run(input as InstrumentAnalysisRunInput);
  }
}

export { AIPhaseRunner, InstrumentAnalysisRunner };
