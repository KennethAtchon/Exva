import type { SignalSourceRecord } from "@electron/shared/domain";
import { signalDisplayName } from "@electron/shared/domain/signal-descriptor";
import type { SignalDescriptor } from "@electron/shared/domain/signal-descriptor";
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
    const desired = desiredExperienceSignalSource(experience, signal, sourceId);
    const existing = sourcesRepo.get(sourceId);
    if (existing) {
      const patch = generatedSourcePatch(existing, desired);
      return Object.keys(patch).length > 0
        ? sourcesRepo.update(sourceId, patch)
        : existing;
    }
    return sourcesRepo.create(desired);
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

function desiredExperienceSignalSource(
  experience: ReturnType<typeof requireExperience>,
  signal: SignalDescriptor,
  sourceId: string,
): Omit<SignalSourceRecord, "createdAt" | "updatedAt"> {
  return {
    id: sourceId,
    type: signal.sourceType,
    name: signalDisplayName(signal),
    description: `${experience.displayName} signal`,
    enabled: signal.enabledByDefault,
    experienceId: experience.id,
    instrumentClass: signal.instrumentClass,
    pollCadence: signal.pollCadence,
    analysisTimeframe: signal.defaultAnalysisTimeframe,
    pipelineId: experience.pipelineId,
    configJson: JSON.stringify({
      signalId: signal.id,
      symbol: signal.symbol,
      cadence: signal.pollCadence,
      instrumentClass: signal.instrumentClass,
    }),
  };
}

function generatedSourcePatch(
  existing: SignalSourceRecord,
  desired: Omit<SignalSourceRecord, "createdAt" | "updatedAt">,
): GeneratedSourcePatch {
  const patch: GeneratedSourcePatch = {};

  if (existing.type !== desired.type) patch.type = desired.type;
  if (existing.name !== desired.name) patch.name = desired.name;
  if (existing.description !== desired.description) {
    patch.description = desired.description;
  }
  if (existing.experienceId !== desired.experienceId) {
    patch.experienceId = desired.experienceId;
  }
  if (existing.instrumentClass !== desired.instrumentClass) {
    patch.instrumentClass = desired.instrumentClass;
  }
  if (existing.pollCadence !== desired.pollCadence) {
    patch.pollCadence = desired.pollCadence;
  }
  if (existing.analysisTimeframe !== desired.analysisTimeframe) {
    patch.analysisTimeframe = desired.analysisTimeframe;
  }
  if (existing.pipelineId !== desired.pipelineId) {
    patch.pipelineId = desired.pipelineId;
  }
  if (existing.configJson !== desired.configJson) {
    patch.configJson = desired.configJson;
  }

  return patch;
}

type GeneratedSourcePatch = Partial<
  Pick<
    SignalSourceRecord,
    | "type"
    | "name"
    | "description"
    | "experienceId"
    | "instrumentClass"
    | "pollCadence"
    | "analysisTimeframe"
    | "pipelineId"
    | "configJson"
  >
>;
