import type { InstrumentSelection } from "@/lib/schemas";
import type { InstrumentClass } from "@/lib/types";
import {
  isSearchStyleSignalSourceType,
  type SignalSourceType,
} from "@electron/shared/domain";
import { buildSignalInstrumentMetadataJson } from "@electron/shared/domain/signal-timing";
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function unitProbability(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

function readTimingMetadata(signalTrigger: SignalTrigger): string | null {
  const payload = signalTrigger.payloadJson;
  if (!payload) return null;
  let pollCadence: string | null = null;
  if (typeof payload.pollCadence === "string") {
    pollCadence = payload.pollCadence;
  }
  const analysisTimeframe = optionalString(payload.analysisTimeframe) ?? null;
  if (!pollCadence && !analysisTimeframe) return null;
  return buildSignalInstrumentMetadataJson({ pollCadence, analysisTimeframe });
}

const EMPTY_PREDICTION_METADATA = {
  predictionOutcome: null,
  instrumentMetadataJson: null,
} as const;

/**
 * Prediction-event signals carry executable Polymarket fields in payloadJson.
 * Entry-mode short-circuits finalizers, so this must copy them onto the
 * instrument or the edge gate / order placer will always fail.
 */
function readPredictionMarketMetadata(signalTrigger: SignalTrigger): {
  predictionOutcome: "YES" | "NO" | null;
  instrumentMetadataJson: string | null;
} {
  const payload = signalTrigger.payloadJson;
  if (!payload) return EMPTY_PREDICTION_METADATA;

  const conditionId = optionalString(payload.conditionId) ?? null;
  const outcomeTokenId = optionalString(payload.outcomeTokenId) ?? null;
  if (!conditionId || !outcomeTokenId) return EMPTY_PREDICTION_METADATA;

  const predictionOutcome =
    payload.predictionOutcome === "YES" || payload.predictionOutcome === "NO"
      ? payload.predictionOutcome
      : ("YES" as const);

  const timing = readTimingMetadata(signalTrigger);
  const timingFields = timing
    ? (JSON.parse(timing) as Record<string, unknown>)
    : {};

  return {
    predictionOutcome,
    instrumentMetadataJson: JSON.stringify({
      ...timingFields,
      conditionId,
      outcomeTokenId,
      yesOutcomeTokenId:
        optionalString(payload.yesOutcomeTokenId) ??
        (predictionOutcome === "YES" ? outcomeTokenId : undefined),
      noOutcomeTokenId:
        optionalString(payload.noOutcomeTokenId) ??
        (predictionOutcome === "NO" ? outcomeTokenId : undefined),
      slug: optionalString(payload.slug),
      category: optionalString(payload.category),
      liquidity:
        typeof payload.liquidityUsd === "number"
          ? payload.liquidityUsd
          : undefined,
      resolutionTime: optionalString(payload.resolutionTime),
      marketMid: unitProbability(payload.marketMid),
    }),
  };
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
    const instrumentClass = inferInstrumentClass(
      signalTrigger,
      ctx.instrumentClasses,
    );
    const prediction =
      instrumentClass === "prediction_market"
        ? readPredictionMarketMetadata(signalTrigger)
        : null;

    return {
      instruments: [
        {
          symbol: signalTrigger.ticker,
          instrumentClass,
          instrumentDisplayName: signalTrigger.companyName ?? undefined,
          ...(prediction
            ? {
                predictionOutcome: prediction.predictionOutcome,
                instrumentMetadataJson:
                  prediction.instrumentMetadataJson ?? undefined,
              }
            : {
                instrumentMetadataJson:
                  readTimingMetadata(signalTrigger) ?? undefined,
              }),
          rationale: `${signalTrigger.sourceType} signal supplied the instrument directly.`,
        },
      ],
    } satisfies InstrumentSelection;
  },
};

registerEngine(signalSeededEntryEngine);
