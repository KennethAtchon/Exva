import type { InstrumentClass } from "@/lib/types";
import type { SignalSourceType } from "./signals";

export type BrokerRequirement = "any_supported_class" | "polymarket_broker";

export interface ExperienceCapabilities {
  instrumentClasses: InstrumentClass[];
  signalSourceTypes: SignalSourceType[];
  brokerRequirement: BrokerRequirement;
  defaultInstrumentClass?: InstrumentClass;
}
