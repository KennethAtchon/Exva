import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type { PhasePlan } from "./types";

const PHASE_PLANS = new Map<PipelinePhase, PhasePlan<unknown, unknown>>();

export function registerPhasePlan<TState, TOutput>(
  plan: PhasePlan<TState, TOutput>,
): void {
  PHASE_PLANS.set(plan.phase, plan as PhasePlan<unknown, unknown>);
}

export function getPhasePlan(
  phase: PipelinePhase,
): PhasePlan<unknown, unknown> | undefined {
  return PHASE_PLANS.get(phase);
}

export function requirePhasePlan(
  phase: PipelinePhase,
): PhasePlan<unknown, unknown> {
  const plan = getPhasePlan(phase);
  if (!plan) throw new Error(`Phase plan '${phase}' is not registered`);
  return plan;
}

export function listPhasePlans(): Array<{
  phase: PipelinePhase;
  plan: PhasePlan<unknown, unknown>;
}> {
  return [...PHASE_PLANS.entries()].map(([phase, plan]) => ({ phase, plan }));
}
