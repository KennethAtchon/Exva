import type { SignalSourceRecord } from "@electron/shared/domain";
import { signalDisplayName } from "@electron/shared/domain/signal-descriptor";
import type { SignalSourcesRepo } from "../services/signals/repos/signal-sources-repo";
import { listExperiences, requireExperience } from "./index";
import { signalSourceId } from "@electron/shared/instruments/session-input-model";

export function ensureExperienceSignalSources(
  sourcesRepo: SignalSourcesRepo,
  experienceId: string,
): SignalSourceRecord[] {
  const experience = requireExperience(experienceId);
  return experience.signals.map((signal) => {
    const sourceId = signalSourceId(experienceId, signal.id);
    const existing = sourcesRepo.get(sourceId);
    if (existing) return existing;
    return sourcesRepo.create({
      id: sourceId,
      type: signal.sourceType,
      name: signalDisplayName(signal),
      description: `${experience.displayName} signal`,
      enabled: true,
      experienceId,
      instrumentClass: signal.instrumentClass,
      pollCadence: signal.pollCadence,
      analysisTimeframe: signal.defaultAnalysisTimeframe,
      pipelineId: experience.pipelineId,
      configJson: JSON.stringify({
        signalId: signal.id,
        symbol: signal.symbol,
      }),
    });
  });
}

export function ensureAllExperienceSignalSources(
  sourcesRepo: SignalSourcesRepo,
): SignalSourceRecord[] {
  return listExperiences().flatMap((experience) =>
    ensureExperienceSignalSources(sourcesRepo, experience.id),
  );
}

/** D5: prune signal_sources rows that were experience-owned but no longer match any descriptor signal. */
export function reconcileExperienceSignalSources(
  sourcesRepo: SignalSourcesRepo,
): void {
  const liveIds = new Set(
    listExperiences().flatMap((e) =>
      e.signals.map((s) => signalSourceId(e.id, s.id)),
    ),
  );
  for (const src of sourcesRepo.listExperienceOwned()) {
    if (src.id && !liveIds.has(src.id)) {
      sourcesRepo.delete(src.id);
    }
  }
}
