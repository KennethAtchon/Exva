import type { CyclePlan } from "./types";

const cyclePlans = new Map<string, CyclePlan<unknown>>();

export function registerCyclePlan<TState>(plan: CyclePlan<TState>): void {
  if (cyclePlans.has(plan.id)) {
    throw new Error(`Cycle plan '${plan.id}' is already registered.`);
  }
  cyclePlans.set(plan.id, plan as CyclePlan<unknown>);
}

export function getCyclePlan(id: string): CyclePlan<unknown> | undefined {
  return cyclePlans.get(id);
}

export function requireCyclePlan(id: string): CyclePlan<unknown> {
  const plan = getCyclePlan(id);
  if (!plan) {
    throw new Error(`Cycle plan '${id}' is not registered.`);
  }
  return plan;
}

export function listCyclePlanIds(): string[] {
  return [...cyclePlans.keys()];
}
