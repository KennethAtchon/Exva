import {
  PIPELINE_PHASES,
  type PipelinePhase,
} from "@electron/shared/ai/ai-phase";
import type { SignalSourceType } from "@electron/shared/domain";
import { DEFAULT_PIPELINE_ID } from "../../pipeline-constants";
import type {
  InstrumentAnalysis,
  InstrumentAnalysisState,
} from "../../analysis/types";

/**
 * A routable pipeline: the per-instrument trade-cycle plan, plus the metadata
 * used to route signals to it.
 */
export interface PipelineDescriptor {
  id: string;
  displayName: string;
  phases: readonly PipelinePhase[];
  signalSources: readonly SignalSourceType[];
  isDefault?: boolean;
  plan: InstrumentAnalysis<InstrumentAnalysisState>;
  phaseWorkers: Partial<Record<PipelinePhase, readonly string[]>>;
  selectorWorkerIds?: readonly string[];
}

const DESCRIPTORS = new Map<string, PipelineDescriptor>();
const PHASE_POOL = new Set<string>(PIPELINE_PHASES);

const SHAREABLE_SIGNAL_SOURCES = new Set<SignalSourceType>(["timer"]);

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

function defaultPipelineId(): string {
  for (const descriptor of DESCRIPTORS.values()) {
    if (descriptor.isDefault) return descriptor.id;
  }
  return DEFAULT_PIPELINE_ID;
}

export function resolvePipelineIdForSource(
  sourceType: SignalSourceType | undefined,
): string {
  if (sourceType) {
    for (const descriptor of DESCRIPTORS.values()) {
      if (descriptor.signalSources.includes(sourceType)) return descriptor.id;
    }
  }
  return defaultPipelineId();
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
