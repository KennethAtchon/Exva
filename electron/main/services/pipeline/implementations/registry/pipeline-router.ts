import {
  PIPELINE_PHASES,
  type PipelinePhase,
} from "@electron/shared/ai/ai-phase";
import type { SignalSourceType } from "@electron/shared/domain";
import { DEFAULT_PIPELINE_ID } from "../../effective-ai-phase-config";
import { registerInstrumentAnalysis } from "../../analysis/registry";
import type {
  InstrumentAnalysis,
  InstrumentAnalysisState,
} from "../../analysis/types";

/**
 * Phases that produce a per-instrument trade signal (as opposed to the
 * selector, which produces instruments). A pipeline's required outputs are
 * the intersection of its declared phases with this set.
 */
const SIGNAL_PRODUCING_PHASES: readonly PipelinePhase[] = [
  "technical",
  "fundamental",
  "review",
  "decision",
];

/**
 * A routable pipeline: the per-instrument trade-cycle plan, plus the metadata
 * used to route signals to it. The selector remains a shared, source-adaptive
 * front-door (it fans one signal out to N instruments) and is NOT part of a
 * pipeline — a pipeline is the analysis that runs per resolved instrument.
 */
export interface PipelineDescriptor {
  /** Stable id; also the cycle-plan id passed to runPlan(). */
  id: string;
  /** Human-readable, for logs/diagnostics. Not user-facing. */
  displayName: string;
  /**
   * Ordered subset of the shared phase pool this pipeline runs. Must equal the
   * plan's phase stages (validated at registration) and be a subset of the
   * pool.
   */
  phases: readonly PipelinePhase[];
  /**
   * Signal source types routed to this pipeline. A type may be claimed by at
   * most one pipeline (validated at boot). Empty = reachable only via default.
   */
  signalSources: readonly SignalSourceType[];
  /** Exactly one descriptor must set this; it is the fallback. */
  isDefault?: boolean;
  /** The executable cycle plan. Its phase stages must equal `phases`. */
  plan: InstrumentAnalysis<InstrumentAnalysisState>;
}

const DESCRIPTORS = new Map<string, PipelineDescriptor>();
const PHASE_POOL = new Set<string>(PIPELINE_PHASES);

/**
 * Registers a pipeline descriptor and its underlying cycle plan. Validates the
 * descriptor in isolation here; cross-descriptor invariants (single default,
 * no source-type conflicts) are checked by validatePipelineRegistry() after all
 * pipelines are registered.
 */
export function registerPipeline(descriptor: PipelineDescriptor): void {
  if (DESCRIPTORS.has(descriptor.id)) {
    throw new Error(`Pipeline id '${descriptor.id}' is already registered.`);
  }

  for (const phase of descriptor.phases) {
    if (!PHASE_POOL.has(phase)) {
      throw new Error(
        `Pipeline '${descriptor.id}' declares unknown phase '${phase}'.`,
      );
    }
  }

  const planPhases = descriptor.plan.inspect.phaseStages;
  if (!sameSequence(descriptor.phases, planPhases)) {
    throw new Error(
      `Pipeline '${descriptor.id}' declares phases [${descriptor.phases.join(", ")}] ` +
        `but its plan runs [${planPhases.join(", ")}].`,
    );
  }

  // registerInstrumentAnalysis throws on duplicate plan id, covering the case
  // where two descriptors wrap plans with the same id.
  registerInstrumentAnalysis(descriptor.plan);
  DESCRIPTORS.set(descriptor.id, descriptor);
}

/**
 * Validates cross-descriptor invariants. Call once at boot after all pipelines
 * are registered. Throws (crashing startup) rather than allowing a misrouted
 * signal at runtime.
 */
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
      if (existing) {
        throw new Error(
          `Signal source '${source}' is claimed by both '${existing}' and '${descriptor.id}'.`,
        );
      }
      claimedBy.set(source, descriptor.id);
    }
  }
}

function defaultPipelineId(): string {
  for (const descriptor of DESCRIPTORS.values()) {
    if (descriptor.isDefault) return descriptor.id;
  }
  // Registry not populated (e.g. isolated unit tests). The boot-time
  // validatePipelineRegistry() guarantees a registered default in production;
  // fall back to the canonical id rather than throwing on a routing call.
  return DEFAULT_PIPELINE_ID;
}

/**
 * Resolves the pipeline id for a signal source type. Sources with no explicit
 * mapping (and signal-less cycles, where sourceType is undefined) fall back to
 * the default pipeline.
 */
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

/**
 * The phases of a pipeline whose per-instrument signal output is required.
 * Falls back to all signal-producing phases when the pipeline is not registered
 * (isolated unit tests), preserving the original all-four requirement.
 */
export function requiredSignalPhasesForPipeline(
  id: string,
): readonly PipelinePhase[] {
  const descriptor = DESCRIPTORS.get(id);
  if (!descriptor) return SIGNAL_PRODUCING_PHASES;
  return descriptor.phases.filter((phase) =>
    SIGNAL_PRODUCING_PHASES.includes(phase),
  );
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
