import { EDGAR_CATALYST_EXPERIENCE } from "./edgar-catalyst/descriptor";
import { PREDICTION_EVENT_EDGE_EXPERIENCE } from "./prediction-event-edge/descriptor";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "./rules-mean-reversion/descriptor";
import { RULES_TREND_FOLLOWING_EXPERIENCE } from "./rules-trend-following/descriptor";
import { RULES_BREAKOUT_EXPERIENCE } from "./rules-breakout/descriptor";
import type { ExperienceDescriptor } from "./types";
import { validateExperienceSourceEmissions } from "./validate-source-capabilities";
import {
  describePipelineSteps,
  requirePipelineDescriptor,
  type PipelineStep,
} from "../services/pipeline/implementations/registry/pipeline-descriptor-store";

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

    const pipeline = requirePipelineDescriptor(experience.pipelineId);

    if (!experience.signals || experience.signals.length === 0) {
      throw new Error(
        `Experience '${experience.id}' must declare at least one signal.`,
      );
    }

    // I1: every signal.sourceType ∈ pipeline.signalSources
    for (const signal of experience.signals) {
      if (!pipeline.signalSources.includes(signal.sourceType)) {
        throw new Error(
          `Experience '${experience.id}' signal '${signal.id}' has sourceType '${signal.sourceType}' ` +
            `not in pipeline '${pipeline.id}' signalSources [${pipeline.signalSources.join(", ")}].`,
        );
      }
    }

    if (!experience.capabilities.signalSourceTypes.length) {
      throw new Error(
        `Experience '${experience.id}' must declare at least one signal source type.`,
      );
    }

    // I3: capabilities.signalSourceTypes == union of signals[].sourceType
    const signalSourceTypeUnion = new Set(
      experience.signals.map((s) => s.sourceType),
    );
    for (const t of experience.capabilities.signalSourceTypes) {
      if (!signalSourceTypeUnion.has(t)) {
        throw new Error(
          `Experience '${experience.id}' capabilities.signalSourceTypes includes '${t}' ` +
            `which is not in its signals' sourceTypes.`,
        );
      }
    }
    for (const t of signalSourceTypeUnion) {
      if (!experience.capabilities.signalSourceTypes.includes(t)) {
        throw new Error(
          `Experience '${experience.id}' signal sourceType '${t}' ` +
            `is missing from capabilities.signalSourceTypes.`,
        );
      }
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

    validateExperienceSourceEmissions(experience);
  }
}

registerExperience(EDGAR_CATALYST_EXPERIENCE);
registerExperience(RULES_MEAN_REVERSION_EXPERIENCE);
registerExperience(RULES_TREND_FOLLOWING_EXPERIENCE);
registerExperience(RULES_BREAKOUT_EXPERIENCE);
registerExperience(PREDICTION_EVENT_EDGE_EXPERIENCE);
