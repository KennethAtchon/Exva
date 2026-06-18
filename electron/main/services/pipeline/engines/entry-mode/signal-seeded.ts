import type { InstrumentSelection } from "@/lib/schemas";
import type { InstrumentClass } from "@/lib/types";
import {
  isSearchStyleSignalSourceType,
  type SignalSourceType,
} from "@electron/shared/domain";
import { isInstrumentClass } from "@electron/shared/instruments/instrument-classification";
import { registerEngine, type EntryModeEngine } from "../registry";

type SignalTrigger = {
  sourceType: SignalSourceType;
  ticker: string;
  companyName?: string | null;
  payloadJson?: Record<string, unknown>;
};

function readSignalTrigger(
  input: Record<string, unknown>,
): SignalTrigger | null {
  const candidate = input.signalTrigger;
  if (!candidate || typeof candidate !== "object") return null;
  const sourceType =
    "sourceType" in candidate && typeof candidate.sourceType === "string"
      ? (candidate.sourceType as SignalSourceType)
      : null;
  const ticker =
    "ticker" in candidate && typeof candidate.ticker === "string"
      ? candidate.ticker.trim()
      : "";
  const companyName =
    "companyName" in candidate && typeof candidate.companyName === "string"
      ? candidate.companyName
      : null;
  const payloadJson =
    "payloadJson" in candidate &&
    candidate.payloadJson &&
    typeof candidate.payloadJson === "object"
      ? (candidate.payloadJson as Record<string, unknown>)
      : undefined;
  if (!sourceType || !ticker) return null;
  return { sourceType, ticker, companyName, payloadJson };
}

function inferInstrumentClass(
  signalTrigger: SignalTrigger,
  fallbackClasses: InstrumentClass[],
): InstrumentClass {
  // Trust the signal's own class: by the time a signal reaches this engine the
  // delivery gate has already confirmed an assigned broker supports that class.
  // Re-deriving it against session config is what let, e.g., a crypto signal
  // get mis-routed as stock.
  const payloadClass = signalTrigger.payloadJson?.instrumentClass;
  if (isInstrumentClass(payloadClass)) {
    return payloadClass;
  }
  // No class on the payload — fall back to source convention, then whatever the
  // session can trade.
  if (signalTrigger.sourceType === "edgar_8k") {
    return "stock";
  }
  return fallbackClasses[0] ?? "stock";
}

const signalSeededEntryEngine: EntryModeEngine = {
  id: "signal-seeded",
  kind: "entry_mode",
  source: "phase",
  matches(ctx) {
    const signalTrigger = readSignalTrigger(ctx.input);
    if (!signalTrigger) return false;
    return !isSearchStyleSignalSourceType(signalTrigger.sourceType);
  },
  resolve(ctx) {
    const signalTrigger = readSignalTrigger(ctx.input);
    if (!signalTrigger) {
      return { instruments: [] } satisfies InstrumentSelection;
    }
    return {
      instruments: [
        {
          symbol: signalTrigger.ticker,
          instrumentClass: inferInstrumentClass(
            signalTrigger,
            ctx.instrumentClasses,
          ),
          instrumentDisplayName: signalTrigger.companyName ?? undefined,
          rationale: `${signalTrigger.sourceType} signal supplied the instrument directly.`,
        },
      ],
    } satisfies InstrumentSelection;
  },
};

registerEngine(signalSeededEntryEngine);
