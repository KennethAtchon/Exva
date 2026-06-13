import type { InstrumentClass } from "@/lib/types";
import { SIGNAL_SOURCE_CAPABILITIES } from "@electron/shared/domain/signal-source-capabilities";
import type { ExperienceDescriptor } from "./types";

const INSTRUMENT_CLASSES: InstrumentClass[] = [
  "stock",
  "crypto",
  "futures",
  "prediction_market",
];

function isInstrumentClass(value: string): value is InstrumentClass {
  return INSTRUMENT_CLASSES.includes(value as InstrumentClass);
}

function emittedClassesForExperienceSource(
  experience: ExperienceDescriptor,
  sourceType: ExperienceDescriptor["signalSource"]["type"],
): InstrumentClass[] {
  const capability = SIGNAL_SOURCE_CAPABILITIES[sourceType];
  if (capability.emittedInstrumentClasses !== "from_config") {
    return capability.emittedInstrumentClasses;
  }

  if (sourceType === experience.signalSource.type) {
    const raw = experience.signalSource.defaultConfig.instrumentClass;
    if (typeof raw === "string" && isInstrumentClass(raw)) {
      return [raw];
    }
  }

  if (sourceType === "mock") {
    const raw = experience.signalSource.defaultConfig.instrumentClass;
    if (typeof raw === "string" && isInstrumentClass(raw)) {
      return [raw];
    }
    return ["stock"];
  }

  if (sourceType === "timer") {
    const raw = experience.signalSource.defaultConfig.instrumentClass;
    if (typeof raw === "string" && isInstrumentClass(raw)) {
      return [raw];
    }
    throw new Error(
      `Experience '${experience.id}' timer source requires defaultConfig.instrumentClass.`,
    );
  }

  if (sourceType === "web_search" || sourceType === "manual") {
    return [...experience.capabilities.instrumentClasses];
  }

  return [];
}

export function validateExperienceSourceEmissions(
  experience: ExperienceDescriptor,
): void {
  const allowed = new Set(experience.capabilities.instrumentClasses);
  for (const sourceType of experience.capabilities.signalSourceTypes) {
    const emitted = emittedClassesForExperienceSource(experience, sourceType);
    for (const instrumentClass of emitted) {
      if (!allowed.has(instrumentClass)) {
        throw new Error(
          `Experience '${experience.id}' allows ${[...allowed].join(", ")} ` +
            `but signal source '${sourceType}' emits '${instrumentClass}'.`,
        );
      }
    }
  }
}
