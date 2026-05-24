import "../engines";
import { registerAIPhase } from "../phases/registry";
import { registerUnifiedPlanRef } from "../implementations/registry/analysis-resolver";
import { DECISION_PHASE } from "./decision.phase";
import { FUNDAMENTAL_PHASE } from "./fundamental.phase";
import { REVIEW_PHASE } from "./review.phase";
import { SELECTOR_PHASE } from "./selector.phase";
import { TECHNICAL_PHASE } from "./technical.phase";

export const ALL_PHASES = [
  SELECTOR_PHASE,
  TECHNICAL_PHASE,
  FUNDAMENTAL_PHASE,
  REVIEW_PHASE,
  DECISION_PHASE,
] as const satisfies readonly import("../phases/types").AIPhase<
  unknown,
  unknown
>[];

export function registerAllPhases(): void {
  for (const phase of ALL_PHASES) {
    registerAIPhase(phase);
    registerUnifiedPlanRef(phase.phase);
  }
}
