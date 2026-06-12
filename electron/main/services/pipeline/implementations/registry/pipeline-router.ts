import { registerInstrumentAnalysis } from "../../analysis/registry";
import {
  registerPipelineDescriptor,
  requirePipelineDescriptor,
  resolvePipelineIdForSource,
  requiredSignalPhasesForPipeline,
  validatePipelineDescriptor,
  validatePipelineRegistry,
  type PipelineDescriptor,
} from "./pipeline-descriptor-store";

export type { PipelineDescriptor };
export {
  requirePipelineDescriptor,
  resolvePipelineIdForSource,
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

  // registerInstrumentAnalysis throws on duplicate plan id, covering the case
  // where two descriptors wrap plans with the same id.
  registerInstrumentAnalysis(descriptor.plan);
  registerPipelineDescriptor(descriptor);
}
