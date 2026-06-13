import type { InstrumentClass } from "@/lib/types";
import type { ExperienceCapabilities } from "@electron/shared/domain/experience";
import {
  isSearchEverythingEnabled,
  resolveBrokerInstrumentClasses,
} from "./session-instrument-classes";

const INSTRUMENT_CLASS_ORDER: InstrumentClass[] = [
  "stock",
  "crypto",
  "futures",
  "prediction_market",
];

function normalizeInstrumentClasses(
  classes: readonly InstrumentClass[],
): InstrumentClass[] {
  const enabled = new Set(classes);
  return INSTRUMENT_CLASS_ORDER.filter((instrumentClass) =>
    enabled.has(instrumentClass),
  );
}

export function experienceBrokerOverlap(
  experienceClasses: readonly InstrumentClass[],
  brokers: Array<{ supportedInstrumentClasses: readonly InstrumentClass[] }>,
): InstrumentClass[] {
  const brokerClasses = new Set(
    brokers.flatMap((broker) => broker.supportedInstrumentClasses),
  );
  return normalizeInstrumentClasses(
    experienceClasses.filter((instrumentClass) =>
      brokerClasses.has(instrumentClass),
    ),
  );
}

export function brokerOverlapsExperience(
  broker: { supportedInstrumentClasses: readonly InstrumentClass[] },
  experienceClasses: readonly InstrumentClass[],
): boolean {
  return broker.supportedInstrumentClasses.some((instrumentClass) =>
    experienceClasses.includes(instrumentClass),
  );
}

export function isSessionLaunchable(
  experienceClasses: readonly InstrumentClass[],
  selectedBrokers: Array<{
    supportedInstrumentClasses: readonly InstrumentClass[];
  }>,
): boolean {
  return experienceBrokerOverlap(experienceClasses, selectedBrokers).length > 0;
}

export function resolveSessionInstrumentClasses(
  capabilities: ExperienceCapabilities,
  input: {
    instrumentScope: string;
    selectorSettings: { aiPickerEnabled: boolean };
  },
  brokers: Array<{ supportedInstrumentClasses: readonly InstrumentClass[] }>,
): InstrumentClass[] {
  const experienceClasses = normalizeInstrumentClasses(
    capabilities.instrumentClasses,
  );
  if (isSearchEverythingEnabled(input)) {
    const brokerClasses = resolveBrokerInstrumentClasses(brokers);
    return normalizeInstrumentClasses(
      brokerClasses.filter((instrumentClass) =>
        experienceClasses.includes(instrumentClass),
      ),
    );
  }
  return experienceClasses;
}

export function uncoveredExperienceClasses(
  experienceClasses: readonly InstrumentClass[],
  brokers: Array<{ supportedInstrumentClasses: readonly InstrumentClass[] }>,
): InstrumentClass[] {
  const overlap = new Set(experienceBrokerOverlap(experienceClasses, brokers));
  return normalizeInstrumentClasses(
    experienceClasses.filter(
      (instrumentClass) => !overlap.has(instrumentClass),
    ),
  );
}
