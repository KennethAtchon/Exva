import type { InstrumentClass } from "@/lib/types";

export const SEARCH_EVERYTHING_SCOPE =
  "Search the entire tradable universe for the selected instrument classes.";
const SEARCH_EVERYTHING_FOCUS_PREFIX = "Focus instrument class: ";

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

export function resolveBrokerInstrumentClasses(
  brokers: Array<{ supportedInstrumentClasses: readonly InstrumentClass[] }>,
): InstrumentClass[] {
  return normalizeInstrumentClasses(
    brokers.flatMap((broker) => [...broker.supportedInstrumentClasses]),
  );
}

export function buildSearchEverythingScope(
  focusInstrumentClass?: InstrumentClass | null,
): string {
  return focusInstrumentClass
    ? `${SEARCH_EVERYTHING_SCOPE}\n${SEARCH_EVERYTHING_FOCUS_PREFIX}${focusInstrumentClass}`
    : SEARCH_EVERYTHING_SCOPE;
}

export function isSearchEverythingScope(instrumentScope: string): boolean {
  return instrumentScope.trim().startsWith(SEARCH_EVERYTHING_SCOPE);
}

export function parseSearchEverythingFocusInstrumentClass(
  instrumentScope: string,
): InstrumentClass | null {
  if (!isSearchEverythingScope(instrumentScope)) return null;
  const focusLine = instrumentScope
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(SEARCH_EVERYTHING_FOCUS_PREFIX));
  if (!focusLine) return null;
  const raw = focusLine.slice(SEARCH_EVERYTHING_FOCUS_PREFIX.length).trim();
  return INSTRUMENT_CLASS_ORDER.includes(raw as InstrumentClass)
    ? (raw as InstrumentClass)
    : null;
}

export function isSearchEverythingEnabled(input: {
  instrumentScope: string;
  selectorSettings: { aiPickerEnabled: boolean };
}): boolean {
  return (
    isSearchEverythingScope(input.instrumentScope) &&
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
