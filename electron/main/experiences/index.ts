import { EDGAR_CATALYST_EXPERIENCE } from "./edgar-catalyst/descriptor";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "./rules-mean-reversion/descriptor";
import type { ExperienceDescriptor } from "./types";

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
  }
}

registerExperience(EDGAR_CATALYST_EXPERIENCE);
registerExperience(RULES_MEAN_REVERSION_EXPERIENCE);
validateExperienceRegistry();
