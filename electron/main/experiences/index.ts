import { BTC_MOMENTUM_BREAKOUT_EXPERIENCE } from "./btc-momentum-breakout/descriptor";
import { EDGAR_CATALYST_EXPERIENCE } from "./edgar-catalyst/descriptor";
import { PREDICTION_EVENT_EDGE_EXPERIENCE } from "./prediction-event-edge/descriptor";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "./rules-mean-reversion/descriptor";
import { RULES_QQQ_MEAN_REVERSION_EXPERIENCE } from "./rules-qqq-mean-reversion/descriptor";
import type { ExperienceDescriptor } from "./types";
import { validateExperienceSourceEmissions } from "./validate-source-capabilities";

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

export function validateExperienceRegistry(): void {
  for (const experience of EXPERIENCES.values()) {
    if (!experience.pipeline.id) {
      throw new Error(`Experience '${experience.id}' has no pipeline id.`);
    }
    if (
      !experience.pipeline.signalSources.includes(experience.signalSource.type)
    ) {
      throw new Error(
        `Experience '${experience.id}' signal source '${experience.signalSource.type}' ` +
          `is not routed by pipeline '${experience.pipeline.id}'.`,
      );
    }
    if (!experience.capabilities.instrumentClasses.length) {
      throw new Error(
        `Experience '${experience.id}' must declare at least one instrument class.`,
      );
    }
    if (!experience.capabilities.signalSourceTypes.length) {
      throw new Error(
        `Experience '${experience.id}' must declare at least one signal source type.`,
      );
    }
    if (
      !experience.capabilities.signalSourceTypes.includes(
        experience.signalSource.type,
      )
    ) {
      throw new Error(
        `Experience '${experience.id}' default signal source '${experience.signalSource.type}' ` +
          `is not listed in capabilities.signalSourceTypes.`,
      );
    }
    validateExperienceSourceEmissions(experience);
  }
}

registerExperience(EDGAR_CATALYST_EXPERIENCE);
registerExperience(RULES_MEAN_REVERSION_EXPERIENCE);
registerExperience(RULES_QQQ_MEAN_REVERSION_EXPERIENCE);
registerExperience(BTC_MOMENTUM_BREAKOUT_EXPERIENCE);
registerExperience(PREDICTION_EVENT_EDGE_EXPERIENCE);
validateExperienceRegistry();
