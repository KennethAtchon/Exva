import type { InstrumentClass } from "@/lib/types";
import type { ExperienceCapabilities } from "@electron/shared/domain/experience";
import {
  isSearchEverythingEnabled,
  resolveBrokerInstrumentClasses,
} from "./session-instrument-classes";

type BrokerLike = { supportedInstrumentClasses: readonly InstrumentClass[] };

export function experienceBrokerOverlap(
  brokers: BrokerLike[],
): InstrumentClass[] {
  return resolveBrokerInstrumentClasses(brokers);
}

export function brokerOverlapsExperience(broker: BrokerLike): boolean {
  return broker.supportedInstrumentClasses.length > 0;
}

export function isSessionLaunchable(selectedBrokers: BrokerLike[]): boolean {
  return selectedBrokers.length > 0;
}

export function resolveSessionInstrumentClasses(
  _capabilities: ExperienceCapabilities,
  input: {
    instrumentScope: string;
    selectorSettings: { aiPickerEnabled: boolean };
  },
  brokers: BrokerLike[],
): InstrumentClass[] {
  if (isSearchEverythingEnabled(input)) {
    return resolveBrokerInstrumentClasses(brokers);
  }
  return resolveBrokerInstrumentClasses(brokers);
}
