import type { ExperienceDescriptor } from "./types";

// Experience no longer declares instrumentClasses — no constraint to validate.
export function validateExperienceSourceEmissions(
  _experience: ExperienceDescriptor,
): void {}
