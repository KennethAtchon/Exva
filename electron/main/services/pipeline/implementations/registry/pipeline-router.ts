import {
  getInstrumentAnalysis,
  registerInstrumentAnalysis,
} from "../../analysis/registry";
import {
  registerPipelineDescriptor,
  requirePipelineDescriptor,
  requiredSignalPhasesForPipeline,
  validatePipelineDescriptor,
  validatePipelineRegistry,
  type PipelineDescriptor,
} from "./pipeline-descriptor-store";

export type { PipelineDescriptor };
export {
  requirePipelineDescriptor,
  requiredSignalPhasesForPipeline,
  validatePipelineRegistry,
};

/**
 * Registers a pipeline descriptor and its underlying cycle plan. Validates the
 * descriptor in isolation here; cross-descriptor invariants (single default,
 * no source-type conflicts) are checked by validatePipelineRegistry() after all
 * pipelines are registered.
 */
export function registerPipeline(descriptor: PipelineDescriptor): void {
  validatePipelineDescriptor(descriptor);

  const existingPlan = getInstrumentAnalysis(descriptor.plan.id);
  if (!existingPlan) {
    registerInstrumentAnalysis(descriptor.plan);
  } else if (existingPlan !== descriptor.plan) {
    throw new Error(
      `Cycle plan '${descriptor.plan.id}' is already registered with a different plan instance.`,
    );
  }
  registerPipelineDescriptor(descriptor);
}
