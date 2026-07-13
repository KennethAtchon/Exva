import { EDGAR_CATALYST_EXPERIENCE } from "./edgar-catalyst/descriptor";
import { PREDICTION_EVENT_EDGE_EXPERIENCE } from "./prediction-event-edge/descriptor";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "./rules-mean-reversion/descriptor";
import { RULES_TREND_FOLLOWING_EXPERIENCE } from "./rules-trend-following/descriptor";
import { RULES_BREAKOUT_EXPERIENCE } from "./rules-breakout/descriptor";
import { OPTIONS_FLOW_EDGE_EXPERIENCE } from "./options-flow-edge/descriptor";
import type { ExperienceDescriptor } from "./types";
import { validateExperienceSourceEmissions } from "./validate-source-capabilities";
import {
  describePipelineSteps,
  requirePipelineDescriptor,
  type PipelineStep,
} from "../services/pipeline/implementations/registry/pipeline-descriptor-store";

export { experienceAcceptsScanHit } from "./types";
export type { ExperienceDescriptor } from "./types";

const EXPERIENCES = new Map<string, ExperienceDescriptor>();

export function registerExperience(descriptor: ExperienceDescriptor): void {
  if (EXPERIENCES.has(descriptor.id)) {
    throw new Error(`Experience '${descriptor.id}' is already registered.`);
  }
  EXPERIENCES.set(descriptor.id, descriptor);
}

export function listExperiences(): ExperienceDescriptor[] {
  return [...EXPERIENCES.values()];
}

export function requireExperience(id: string): ExperienceDescriptor {
  const experience = EXPERIENCES.get(id);
  if (!experience) throw new Error(`Experience '${id}' is not registered.`);
  return experience;
}

export function resolvePipelineIdForExperience(experienceId: string): string {
  return requireExperience(experienceId).pipelineId;
}

export function describeExperienceSteps(experienceId: string): PipelineStep[] {
  const pipeline = requirePipelineDescriptor(
    requireExperience(experienceId).pipelineId,
  );
  return describePipelineSteps(pipeline);
}

export function validateExperienceRegistry(): void {
  for (const experience of EXPERIENCES.values()) {
    if (!experience.pipelineId) {
      throw new Error(`Experience '${experience.id}' has no pipelineId.`);
    }

    requirePipelineDescriptor(experience.pipelineId);

    // P0: every experience must declare a falsifiable research contract.
    const contract = experience.researchContract;
    if (!contract || !contract.hypothesis.trim()) {
      throw new Error(
        `Experience '${experience.id}' must declare a researchContract with a hypothesis.`,
      );
    }
    if (contract.validation.requiredFolds < 1) {
      throw new Error(
        `Experience '${experience.id}' researchContract.validation.requiredFolds must be >= 1.`,
      );
    }

    // C1: either declares known signal source types or accepts scan_hit — not neither.
    const hasSourceTypes = experience.capabilities.signalSourceTypes.length > 0;
    const hasScanHit = experience.acceptsScanHit === true;
    if (!hasSourceTypes && !hasScanHit) {
      throw new Error(
        `Experience '${experience.id}' must declare at least one capabilities.signalSourceTypes ` +
          `or set acceptsScanHit: true for scan_hit delivery.`,
      );
    }

    // I5: no experience whose id contains trend/breakout runs mean-reversion pipeline
    if (
      (experience.id.includes("trend") || experience.id.includes("breakout")) &&
      experience.pipelineId === "rules-mean-reversion-cycle"
    ) {
      throw new Error(
        `Experience '${experience.id}' id implies trend/breakout but pipelineId is '${experience.pipelineId}'. ` +
          `Name and pipeline must agree.`,
      );
    }

    validateExperienceSourceEmissions();
  }
}

registerExperience(EDGAR_CATALYST_EXPERIENCE);
registerExperience(RULES_MEAN_REVERSION_EXPERIENCE);
registerExperience(RULES_TREND_FOLLOWING_EXPERIENCE);
registerExperience(RULES_BREAKOUT_EXPERIENCE);
registerExperience(OPTIONS_FLOW_EDGE_EXPERIENCE);
registerExperience(PREDICTION_EVENT_EDGE_EXPERIENCE);
