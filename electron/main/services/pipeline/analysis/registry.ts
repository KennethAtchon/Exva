import type { InstrumentAnalysis } from "./types";

const cyclePlans = new Map<string, InstrumentAnalysis<unknown>>();

export function registerInstrumentAnalysis<TState>(
  plan: InstrumentAnalysis<TState>,
): void {
  if (cyclePlans.has(plan.id)) {
    throw new Error(`Cycle plan '${plan.id}' is already registered.`);
  }
  cyclePlans.set(plan.id, plan as InstrumentAnalysis<unknown>);
}

export function getInstrumentAnalysis(
  id: string,
): InstrumentAnalysis<unknown> | undefined {
  return cyclePlans.get(id);
}

export function requireInstrumentAnalysis(
  id: string,
): InstrumentAnalysis<unknown> {
  const plan = getInstrumentAnalysis(id);
  if (!plan) {
    throw new Error(`Cycle plan '${id}' is not registered.`);
  }
  return plan;
}

export function listInstrumentAnalysisIds(): string[] {
  return [...cyclePlans.keys()];
}
