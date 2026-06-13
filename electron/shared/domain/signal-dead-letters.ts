import type { InstrumentClass } from "@/lib/types";
import type { SignalSourceType } from "./signals";

export type SignalDeadLetterReason =
  | "unsupported_by_experience"
  | "unsupported_by_signal_source"
  | "unsupported_by_assigned_broker"
  | "no_compatible_broker_route";

export interface SignalDeadLetter {
  id: string;
  sessionId: string;
  signalEventId: string;
  sourceId: string;
  sourceType: SignalSourceType;
  ticker: string;
  instrumentClass: InstrumentClass | null;
  reason: SignalDeadLetterReason;
  detailJson: string;
  createdAt: string;
  replayedAt: string | null;
  resolvedDeliveryId: string | null;
}
