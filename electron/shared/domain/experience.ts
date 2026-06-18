import type { SignalSourceType } from "./signals";

export type BrokerRequirement = "any_supported_class" | "polymarket_broker";

export interface ExperienceCapabilities {
  signalSourceTypes: SignalSourceType[];
  brokerRequirement: BrokerRequirement;
  mockRehearsalEligible?: boolean;
}
