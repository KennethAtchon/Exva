import type { SignalSourceRecord } from "@electron/shared/domain";
import type { SignalSourcesRepo } from "../services/signals/repos/signal-sources-repo";
import { listExperiences, requireExperience } from "./index";
import { experienceSignalSourceId } from "@electron/shared/instruments/session-input-model";

export function ensureExperienceSignalSource(
  sourcesRepo: SignalSourcesRepo,
  experienceId: string,
): SignalSourceRecord {
  const sourceId = experienceSignalSourceId(experienceId);
  const existing = sourcesRepo.get(sourceId);
  if (existing) return existing;

  const experience = requireExperience(experienceId);
  return sourcesRepo.create({
    id: sourceId,
    type: experience.signalSource.type,
    name: experience.displayName,
    description: `Auto-provisioned source for ${experience.displayName}`,
    enabled: true,
    configJson: JSON.stringify(experience.signalSource.defaultConfig),
  });
}

export function ensureAllExperienceSignalSources(
  sourcesRepo: SignalSourcesRepo,
): SignalSourceRecord[] {
  return listExperiences().map((experience) =>
    ensureExperienceSignalSource(sourcesRepo, experience.id),
  );
}
