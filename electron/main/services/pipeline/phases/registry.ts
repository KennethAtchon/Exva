import type { PipelinePhase } from "@electron/shared/ai/ai-phase";
import type { AIPhase } from "./types";

const PHASE_PLANS = new Map<PipelinePhase, AIPhase<unknown, unknown>>();

export function registerAIPhase<TState, TOutput>(
  plan: AIPhase<TState, TOutput>,
): void {
  PHASE_PLANS.set(plan.phase, plan as AIPhase<unknown, unknown>);
}

export function getAIPhase(
  phase: PipelinePhase,
): AIPhase<unknown, unknown> | undefined {
  return PHASE_PLANS.get(phase);
}

export function requireAIPhase(
  phase: PipelinePhase,
): AIPhase<unknown, unknown> {
  const plan = getAIPhase(phase);
  if (!plan) throw new Error(`Phase plan '${phase}' is not registered`);
  return plan;
}
