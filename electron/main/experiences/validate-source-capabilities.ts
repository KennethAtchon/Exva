import type { ExperienceDescriptor } from "./types";

export function validateExperienceSourceEmissions(
  experience: ExperienceDescriptor,
): void {
  const allowed = new Set(experience.capabilities.instrumentClasses);
  for (const signal of experience.signals) {
    if (!allowed.has(signal.instrumentClass)) {
      throw new Error(
        `Experience '${experience.id}' allows [${[...allowed].join(", ")}] ` +
          `but signal '${signal.id}' has instrumentClass '${signal.instrumentClass}'.`,
      );
    }
  }
}
