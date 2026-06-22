import { isTradingTimeframe, type TradingTimeframe } from "./enums";
import type { SignalDescriptor } from "./signal-descriptor";
import type { SignalSourceRecord, SignalSourceType } from "./signals";

export type OhlcvTimeframe = TradingTimeframe;

export interface SignalInstrumentMetadata {
  pollCadence?: string | null;
  analysisTimeframe?: string | null;
  /** Legacy timer alias — prefer pollCadence. */
  cadence?: string | null;
}

export interface SignalTimingSummary {
  tradeCadence: string;
  ohlcvTimeframe: string;
}

export function parseSignalInstrumentMetadata(
  raw: string | null | undefined,
): SignalInstrumentMetadata | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as SignalInstrumentMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function buildSignalInstrumentMetadataJson(input: {
  pollCadence?: string | null;
  analysisTimeframe?: string | null;
}): string {
  return JSON.stringify({
    pollCadence: input.pollCadence ?? null,
    analysisTimeframe: input.analysisTimeframe ?? null,
  });
}

export function resolveOhlcvTimeframe(
  metadata: SignalInstrumentMetadata | null | undefined,
  fallback: OhlcvTimeframe = "1h",
): OhlcvTimeframe {
  const candidate = metadata?.analysisTimeframe;
  if (candidate && isTradingTimeframe(candidate)) return candidate;
  return fallback;
}

export function defaultBarCountForTimeframe(timeframe: OhlcvTimeframe): number {
  return timeframe === "15m" ? 40 : 30;
}

function sourceTypeSymbol(
  sourceType: SignalSourceType,
  symbol: string | null,
): string {
  if (symbol?.trim()) return symbol.trim();
  switch (sourceType) {
    case "edgar_8k":
      return "EDGAR 8-K";
    case "prediction_event":
      return "Prediction Event";
    case "web_search":
      return "Web Search";
    case "mock":
      return "Mock";
    case "manual":
      return "Manual";
    default:
      return sourceType;
  }
}

export function summarizeSignalTiming(input: {
  sourceType: SignalSourceType;
  pollCadence?: string | null;
  analysisTimeframe?: TradingTimeframe | string | null;
  defaultAnalysisTimeframe?: TradingTimeframe | string | null;
}): SignalTimingSummary {
  const pollCadence = input.pollCadence ?? null;
  const analysisTimeframe =
    input.analysisTimeframe ?? input.defaultAnalysisTimeframe ?? null;

  switch (input.sourceType) {
    case "timer":
      return {
        tradeCadence: pollCadence
          ? `checks every ${pollCadence}`
          : "timer-driven",
        ohlcvTimeframe: analysisTimeframe
          ? `OHLCV ${analysisTimeframe}`
          : "OHLCV session default",
      };
    case "edgar_8k":
      return {
        tradeCadence:
          "on 8-K filing (polls ~5m market / ~30m off-hours)",
        ohlcvTimeframe: analysisTimeframe
          ? `OHLCV ${analysisTimeframe}`
          : "OHLCV 1d",
      };
    case "prediction_event":
      return {
        tradeCadence: pollCadence
          ? `on dislocation (checks every ${pollCadence})`
          : "on dislocation (checks every 15m)",
        ohlcvTimeframe: analysisTimeframe
          ? `context ${analysisTimeframe} (odds, not OHLCV)`
          : "market odds (no OHLCV)",
      };
    case "web_search":
      return {
        tradeCadence: "on search refresh",
        ohlcvTimeframe: analysisTimeframe
          ? `OHLCV ${analysisTimeframe}`
          : "OHLCV session default",
      };
    case "mock":
      return {
        tradeCadence: "on mock tick",
        ohlcvTimeframe: analysisTimeframe
          ? `OHLCV ${analysisTimeframe}`
          : "OHLCV session default",
      };
    case "manual":
      return {
        tradeCadence: "manual trigger",
        ohlcvTimeframe: analysisTimeframe
          ? `OHLCV ${analysisTimeframe}`
          : "OHLCV session default",
      };
    default:
      return {
        tradeCadence: pollCadence
          ? `checks every ${pollCadence}`
          : "event-driven",
        ohlcvTimeframe: analysisTimeframe
          ? `OHLCV ${analysisTimeframe}`
          : "OHLCV session default",
      };
  }
}

export function formatSignalTimingLabel(input: {
  sourceType: SignalSourceType;
  symbol: string | null;
  pollCadence?: string | null;
  analysisTimeframe?: TradingTimeframe | string | null;
}): string {
  const symbol = sourceTypeSymbol(input.sourceType, input.symbol);
  const timing = summarizeSignalTiming(input);
  return `${symbol} · ${timing.tradeCadence} · ${timing.ohlcvTimeframe}`;
}

export function signalDisplayName(signal: SignalDescriptor): string {
  return formatSignalTimingLabel({
    sourceType: signal.sourceType,
    symbol: signal.symbol,
    pollCadence: signal.pollCadence,
    analysisTimeframe: signal.defaultAnalysisTimeframe,
  });
}

export function formatSignalSourceTimingSubtitle(
  source: Pick<
    SignalSourceRecord,
    "type" | "pollCadence" | "analysisTimeframe"
  >,
): string {
  const timing = summarizeSignalTiming({
    sourceType: source.type,
    pollCadence: source.pollCadence,
    analysisTimeframe: source.analysisTimeframe,
  });
  return `Trade: ${timing.tradeCadence} · Analyze: ${timing.ohlcvTimeframe}`;
}
