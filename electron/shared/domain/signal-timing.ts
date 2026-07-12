import { isTradingTimeframe, type TradingTimeframe } from "./enums";
import type {
  ScheduledScanDescriptor,
  SignalDescriptor,
} from "./signal-descriptor";
import type { SignalSourceRecord, SignalSourceType } from "./signals";

export type OhlcvTimeframe = TradingTimeframe;

export interface SignalInstrumentMetadata {
  pollCadence?: string | null;
  analysisTimeframe?: string | null;
  /** Legacy timer alias — prefer pollCadence. */
  cadence?: string | null;
}

export interface SignalTimingSummary {
  /** How often the source polls or re-evaluates for a setup. */
  pollLabel: string;
  /** Bar timeframe the strategy trades on (OHLCV bar size). */
  tradingTimeframeLabel: string;
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

function formatTradingTimeframeLabel(
  sourceType: SignalSourceType,
  analysisTimeframe: TradingTimeframe | string | null,
): string {
  if (sourceType === "prediction_event") {
    return analysisTimeframe
      ? `${analysisTimeframe} context (odds, not OHLCV)`
      : "event odds (no OHLCV bars)";
  }
  return analysisTimeframe
    ? `trades on ${analysisTimeframe} bars`
    : "trades on session default bars";
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
  const tradingTimeframeLabel = formatTradingTimeframeLabel(
    input.sourceType,
    analysisTimeframe,
  );

  switch (input.sourceType) {
    case "timer":
      return {
        pollLabel: pollCadence ? `polls every ${pollCadence}` : "timer-driven",
        tradingTimeframeLabel,
      };
    case "edgar_8k":
      return {
        pollLabel: "on 8-K filing (~5m market / ~30m off-hours poll)",
        tradingTimeframeLabel,
      };
    case "prediction_event":
      return {
        pollLabel: pollCadence
          ? `on dislocation, polls every ${pollCadence}`
          : "on dislocation, polls every 15m",
        tradingTimeframeLabel,
      };
    case "web_search":
      return {
        pollLabel: "on search refresh",
        tradingTimeframeLabel,
      };
    case "mock":
      return {
        pollLabel: "on mock tick",
        tradingTimeframeLabel,
      };
    case "manual":
      return {
        pollLabel: "manual trigger",
        tradingTimeframeLabel,
      };
    default:
      return {
        pollLabel: pollCadence ? `polls every ${pollCadence}` : "event-driven",
        tradingTimeframeLabel,
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
  return `${symbol} · ${timing.pollLabel} · ${timing.tradingTimeframeLabel}`;
}

export function signalDisplayName(signal: SignalDescriptor): string {
  return formatSignalTimingLabel({
    sourceType: signal.sourceType,
    symbol: signal.symbol,
    pollCadence: signal.pollCadence,
    analysisTimeframe: signal.defaultAnalysisTimeframe,
  });
}

export function scheduleDisplayName(schedule: ScheduledScanDescriptor): string {
  const symbol = schedule.symbol.trim() || "Schedule";
  return `${symbol} · polls every ${schedule.cadence} · trades on ${schedule.defaultAnalysisTimeframe} bars`;
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
  return `Poll: ${timing.pollLabel} · ${timing.tradingTimeframeLabel}`;
}
