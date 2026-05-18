import type { PipelinePhase, PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import { SELECTOR_PHASE } from "../definitions/selector.phase";
import { TECHNICAL_PHASE } from "../definitions/technical.phase";
import { FUNDAMENTAL_PHASE } from "../definitions/fundamental.phase";
import { REVIEW_PHASE } from "../definitions/review.phase";
import { DECISION_PHASE } from "../definitions/decision.phase";

const REGISTRY: Record<PipelinePhase, PipelineDefinition> = {
  selector: SELECTOR_PHASE as PipelineDefinition,
  technical: TECHNICAL_PHASE as PipelineDefinition,
  fundamental: FUNDAMENTAL_PHASE as PipelineDefinition,
  review: REVIEW_PHASE as PipelineDefinition,
  decision: DECISION_PHASE as PipelineDefinition,
};

export function getPipelineDefinition(phase: PipelinePhase): PipelineDefinition {
  return REGISTRY[phase];
}
