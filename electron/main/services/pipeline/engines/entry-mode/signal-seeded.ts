import type { InstrumentSelection } from "@/lib/schemas";
import type { InstrumentClass } from "@/lib/types";
import {
  isSearchStyleSignalSourceType,
  type SignalSourceType,
} from "@electron/shared/domain";
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
  sessionClasses: InstrumentClass[],
): InstrumentClass {
  const payloadClass = signalTrigger.payloadJson?.instrumentClass;
  if (
    typeof payloadClass === "string" &&
    sessionClasses.includes(payloadClass as InstrumentClass)
  ) {
    return payloadClass as InstrumentClass;
  }
  if (
    signalTrigger.sourceType === "edgar_8k" &&
    sessionClasses.includes("stock")
  ) {
    return "stock";
  }
  if (sessionClasses.length === 1) {
    return sessionClasses[0] ?? "stock";
  }
  if (sessionClasses.includes("stock")) {
    return "stock";
  }
  return sessionClasses[0] ?? "stock";
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
