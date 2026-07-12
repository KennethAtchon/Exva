import {
  PIPELINE_PHASES,
  type PipelinePhase,
} from "@electron/shared/ai/ai-phase";
import type { SignalSourceType } from "@electron/shared/domain";
import type {
  InstrumentAnalysis,
  InstrumentAnalysisState,
} from "../../analysis/types";

export type PipelineAutomation = "deterministic" | "ai" | "hybrid";

/**
 * A routable pipeline: the per-instrument trade-cycle plan, plus the metadata
 * used to route signals to it.
 */
export interface PipelineDescriptor {
  id: string;
  displayName: string;
  automation: PipelineAutomation;
  phases: readonly PipelinePhase[];
  signalSources: readonly SignalSourceType[];
  isDefault?: boolean;
  plan: InstrumentAnalysis<InstrumentAnalysisState>;
  // Selector workers live in phaseWorkers.selector — the selector is an
  // ordinary phase. An absent/empty selector key means the pipeline does not
  // research its own universe (it is purely signal-fed).
  phaseWorkers: Partial<Record<PipelinePhase, readonly string[]>>;
}

export interface PipelineStep {
  id: string;
  phase: PipelinePhase;
  kind: "deterministic" | "llm";
  engines: readonly string[];
  workers: readonly string[];
}

const DESCRIPTORS = new Map<string, PipelineDescriptor>();
const PHASE_POOL = new Set<string>(PIPELINE_PHASES);

/** Sources that may appear on more than one pipeline. Empty: schedules replaced timer. */
const SHAREABLE_SIGNAL_SOURCES = new Set<SignalSourceType>();

const SIGNAL_PRODUCING_PHASES: readonly PipelinePhase[] = [
  "technical",
  "fundamental",
  "review",
  "decision",
];

export function validatePipelineDescriptor(
  descriptor: PipelineDescriptor,
): void {
  for (const phase of descriptor.phases) {
    if (!PHASE_POOL.has(phase)) {
      throw new Error(
        `Pipeline '${descriptor.id}' declares unknown phase '${phase}'.`,
      );
    }
  }
  assertPipelinePlanMatchesPhases(descriptor);

  const hasWorkers = Object.values(descriptor.phaseWorkers).some(
    (ws) => (ws?.length ?? 0) > 0,
  );
  if (descriptor.automation === "deterministic" && hasWorkers) {
    throw new Error(
      `Pipeline '${descriptor.id}' marked deterministic but declares phase workers.`,
    );
  }
  if (descriptor.automation === "ai" && !hasWorkers) {
    throw new Error(
      `Pipeline '${descriptor.id}' marked ai but declares no workers.`,
    );
  }
}

export function registerPipelineDescriptor(
  descriptor: PipelineDescriptor,
): void {
  if (DESCRIPTORS.has(descriptor.id)) {
    throw new Error(`Pipeline id '${descriptor.id}' is already registered.`);
  }
  validatePipelineDescriptor(descriptor);
  DESCRIPTORS.set(descriptor.id, descriptor);
}

export function validatePipelineRegistry(): void {
  const defaults = [...DESCRIPTORS.values()].filter((d) => d.isDefault);
  if (defaults.length !== 1) {
    throw new Error(
      `Exactly one pipeline must set isDefault; found ${defaults.length}.`,
    );
  }

  const claimedBy = new Map<SignalSourceType, string>();
  for (const descriptor of DESCRIPTORS.values()) {
    for (const source of descriptor.signalSources) {
      const existing = claimedBy.get(source);
      if (existing && !SHAREABLE_SIGNAL_SOURCES.has(source)) {
        throw new Error(
          `Signal source '${source}' is claimed by both '${existing}' and '${descriptor.id}'.`,
        );
      }
      if (!existing) {
        claimedBy.set(source, descriptor.id);
      }
    }
  }
}

export function requirePipelineDescriptor(id: string): PipelineDescriptor {
  const descriptor = DESCRIPTORS.get(id);
  if (!descriptor) throw new Error(`Pipeline '${id}' is not registered.`);
  return descriptor;
}

export function requiredSignalPhasesForPipeline(
  id: string,
): readonly PipelinePhase[] {
  const descriptor = DESCRIPTORS.get(id);
  if (!descriptor) return SIGNAL_PRODUCING_PHASES;
  return descriptor.phases.filter((phase) =>
    SIGNAL_PRODUCING_PHASES.includes(phase),
  );
}

export function describePipelineSteps(p: PipelineDescriptor): PipelineStep[] {
  const primaryPhase: PipelinePhase =
    p.plan.inspect.phaseStages[0] ?? "decision";
  const workers = p.phaseWorkers[primaryPhase] ?? [];
  return p.plan.inspect.stageIds.map((stageId) => ({
    id: stageId,
    phase: primaryPhase,
    kind: workers.length > 0 ? "llm" : "deterministic",
    engines: p.plan.inspect.engineStages,
    workers,
  }));
}

export function inspectPipelinePlanPhases(
  descriptor: PipelineDescriptor,
): readonly PipelinePhase[] {
  return descriptor.plan.inspect.phaseStages;
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function assertPipelinePlanMatchesPhases(
  descriptor: PipelineDescriptor,
): void {
  const planPhases = inspectPipelinePlanPhases(descriptor);
  if (!sameSequence(descriptor.phases, planPhases)) {
    throw new Error(
      `Pipeline '${descriptor.id}' declares phases [${descriptor.phases.join(", ")}] ` +
        `but its plan runs [${planPhases.join(", ")}].`,
    );
  }
}
