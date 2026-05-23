import type { InstrumentClass } from "@/lib/types";

export const SEARCH_EVERYTHING_SCOPE =
  "Search the entire tradable universe for the selected instrument classes.";

const INSTRUMENT_CLASS_ORDER: InstrumentClass[] = [
  "stock",
  "crypto",
  "futures",
  "prediction_market",
];

export function normalizeInstrumentClasses(
  classes: readonly InstrumentClass[],
): InstrumentClass[] {
  const enabled = new Set(classes);
  return INSTRUMENT_CLASS_ORDER.filter((instrumentClass) =>
    enabled.has(instrumentClass),
  );
}

export function resolveBrokerInstrumentClasses(
  brokers: Array<{ supportedInstrumentClasses: readonly InstrumentClass[] }>,
): InstrumentClass[] {
  return normalizeInstrumentClasses(
    brokers.flatMap((broker) => [...broker.supportedInstrumentClasses]),
  );
}

export function isSearchEverythingEnabled(input: {
  instrumentScope: string;
  selectorSettings: { aiPickerEnabled: boolean };
}): boolean {
  return (
    input.instrumentScope.trim() === SEARCH_EVERYTHING_SCOPE &&
    input.selectorSettings.aiPickerEnabled
  );
}

export function resolveEffectiveInstrumentClasses(
  input: {
    instrumentClasses: readonly InstrumentClass[];
    instrumentScope: string;
    selectorSettings: { aiPickerEnabled: boolean };
  },
  brokers: Array<{ supportedInstrumentClasses: readonly InstrumentClass[] }>,
): InstrumentClass[] {
  if (isSearchEverythingEnabled(input)) {
    return resolveBrokerInstrumentClasses(brokers);
  }
  return normalizeInstrumentClasses(input.instrumentClasses);
}
