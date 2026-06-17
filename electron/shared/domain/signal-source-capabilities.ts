import type { InstrumentClass } from "@/lib/types";
import type { SignalEvent, SignalSourceType } from "./signals";

const INSTRUMENT_CLASSES: InstrumentClass[] = [
  "stock",
  "crypto",
  "futures",
  "prediction_market",
];

function isInstrumentClass(value: string): value is InstrumentClass {
  return INSTRUMENT_CLASSES.includes(value as InstrumentClass);
}

export const SIGNAL_SOURCE_CAPABILITIES: Record<
  SignalSourceType,
  {
    emittedInstrumentClasses: InstrumentClass[] | "from_config";
  }
> = {
  edgar_8k: { emittedInstrumentClasses: ["stock"] },
  mock: { emittedInstrumentClasses: "from_config" },
  timer: { emittedInstrumentClasses: "from_config" },
  web_search: { emittedInstrumentClasses: "from_config" },
  manual: { emittedInstrumentClasses: "from_config" },
  prediction_event: { emittedInstrumentClasses: ["prediction_market"] },
};

export function extractSignalInstrumentClass(
  signal: SignalEvent,
): InstrumentClass | null {
  const raw = signal.payloadJson.instrumentClass;
  if (typeof raw === "string" && isInstrumentClass(raw)) {
    return raw;
  }
  if (signal.sourceType === "edgar_8k") {
    return "stock";
  }
  if (signal.sourceType === "mock") {
    return null;
  }
  if (signal.sourceType === "prediction_event") {
    return "prediction_market";
  }
  return null;
}

export function signalSourceEmitsClass(
  sourceType: SignalSourceType,
  signal: SignalEvent,
  instrumentClass: InstrumentClass,
): boolean {
  const capability = SIGNAL_SOURCE_CAPABILITIES[sourceType];
  if (capability.emittedInstrumentClasses === "from_config") {
    return extractSignalInstrumentClass(signal) === instrumentClass;
  }
  return capability.emittedInstrumentClasses.includes(instrumentClass);
}
