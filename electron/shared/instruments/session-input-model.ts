import type { InstrumentClass } from "@/lib/types";
import {
  isSearchStyleSignalSourceType,
  sessionRequiresInstrumentScope,
  type SignalSourceType,
} from "@electron/shared/domain";
import {
  isSearchEverythingScope,
  parseSearchEverythingFocusInstrumentClass,
} from "./session-instrument-classes";

export type SessionInputModel =
  | "listener"
  | "search_scoped"
  | "manual_only"
  | "search_universe";

export type SessionReadinessState =
  | "armed"
  | "manual_only"
  | "waiting_for_source_enable"
  | "no_inputs";

export type SubscribedSourceSnapshot = {
  id: string;
  name: string;
  type: SignalSourceType;
  enabled: boolean;
};

export function experienceSignalSourceId(experienceId: string): string {
  return `${experienceId}-signal`;
}

export function signalSourceId(experienceId: string, signalId: string): string {
  return `${experienceId}/${signalId}`;
}

export function formatSignalSourceTypeLabel(type: SignalSourceType): string {
  switch (type) {
    case "edgar_8k":
      return "EDGAR 8-K";
    case "web_search":
      return "Web Search";
    case "manual":
      return "Manual";
    case "mock":
      return "Mock";
    case "timer":
      return "Timer";
    case "prediction_event":
      return "Prediction Event";
    default:
      return type;
  }
}

const APPROXIMATE_TRADE_HOLD_LABELS: Record<string, string> = {
  [signalSourceId("rules-mean-reversion", "spy-15m-meanrev")]: "~1 trading day",
  [signalSourceId("rules-mean-reversion", "qqq-15m-meanrev")]: "~1 trading day",
  [signalSourceId("rules-trend-following", "gc-4h-trend")]: "~1-2 weeks",
  [signalSourceId("rules-trend-following", "cl-4h-trend")]: "~4-7 days",
  [signalSourceId("rules-breakout", "btc-1h-breakout")]: "~2-5 days",
};

export function formatApproximateTradeHoldLabel(source: {
  id: string;
  type: SignalSourceType;
}): string | null {
  if (source.type !== "timer") return null;
  return APPROXIMATE_TRADE_HOLD_LABELS[source.id] ?? null;
}

export function countManualTickers(instrumentScope: string): number {
  return instrumentScope
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

export function deriveSessionInputModel(input: {
  subscribedSources: ReadonlyArray<Pick<SubscribedSourceSnapshot, "type">>;
  instrumentScope: string;
  selectorSettings?: { aiPickerEnabled: boolean };
}): SessionInputModel {
  const subscribedTypes = input.subscribedSources.map((source) => source.type);
  const requiresScope = sessionRequiresInstrumentScope(
    subscribedTypes.map((type) => ({ type })),
  );

  if (!requiresScope) {
    return "listener";
  }

  if (isSearchEverythingScope(input.instrumentScope)) {
    return "search_universe";
  }

  const anySearch = subscribedTypes.some(isSearchStyleSignalSourceType);
  if (anySearch) {
    return "search_scoped";
  }

  return "manual_only";
}

export function showInstrumentScopeControls(input: {
  inputModel: SessionInputModel;
  sourcesLoaded: boolean;
}): boolean {
  if (!input.sourcesLoaded) return false;
  return input.inputModel !== "listener";
}

export function deriveSessionReadiness(input: {
  subscribedSources: ReadonlyArray<Pick<SubscribedSourceSnapshot, "enabled">>;
  instrumentScope: string;
}): SessionReadinessState {
  const manualTickerCount = countManualTickers(input.instrumentScope);
  const enabledSources = input.subscribedSources.filter(
    (source) => source.enabled,
  ).length;
  const anySources = input.subscribedSources.length > 0;

  if (enabledSources > 0 || manualTickerCount > 0) {
    return enabledSources === 0 ? "manual_only" : "armed";
  }
  if (anySources) return "waiting_for_source_enable";
  return "no_inputs";
}

export function sessionIsWaitingForLiveInputs(input: {
  status: string;
  readiness: SessionReadinessState;
}): boolean {
  return (
    input.status === "active" &&
    (input.readiness === "no_inputs" ||
      input.readiness === "waiting_for_source_enable")
  );
}

export function resolveSelectionModeForInput(input: {
  subscribedSources: ReadonlyArray<Pick<SubscribedSourceSnapshot, "type">>;
  instrumentScope: string;
  selectorSettings: { aiPickerEnabled: boolean };
}): "manual_shortlist" | "ai_selected_universe" | "signal_driven" {
  const inputModel = deriveSessionInputModel(input);
  if (inputModel === "listener") return "signal_driven";
  if (
    inputModel === "search_universe" &&
    input.selectorSettings.aiPickerEnabled
  ) {
    return "ai_selected_universe";
  }
  return "manual_shortlist";
}

export function resolveSelectorSettingsForInput(input: {
  inputModel: SessionInputModel;
  selectorSettings: { aiPickerEnabled: boolean };
}): { aiPickerEnabled: boolean } {
  if (input.inputModel === "listener") {
    return { aiPickerEnabled: false };
  }
  return input.selectorSettings;
}

export function formatReadinessSummary(input: {
  readiness: SessionReadinessState;
  inputModel: SessionInputModel;
  subscribedSources: ReadonlyArray<SubscribedSourceSnapshot>;
  manualTickerCount: number;
}): string {
  const enabledSources = input.subscribedSources.filter(
    (source) => source.enabled,
  );

  switch (input.readiness) {
    case "armed":
      if (input.inputModel === "listener" && enabledSources[0]) {
        return `Live input: ${enabledSources[0].name} (${formatSignalSourceTypeLabel(enabledSources[0].type)})`;
      }
      if (input.inputModel === "search_scoped" && enabledSources[0]) {
        return `Live inputs: ${enabledSources[0].name} + ${input.manualTickerCount} scoped symbol(s)`;
      }
      if (input.inputModel === "search_universe" && enabledSources[0]) {
        return `Live input: ${enabledSources[0].name} (full-universe discovery)`;
      }
      if (input.inputModel === "manual_only") {
        return "This session will run from manual tickers only.";
      }
      return `Live inputs: ${input.manualTickerCount} manual ticker(s), ${enabledSources.length} enabled source(s)`;
    case "manual_only":
      return "This session will run from manual tickers only.";
    case "waiting_for_source_enable":
      return `This session is subscribed to ${input.subscribedSources.length} source(s), but all are disabled. Starting now will put the session in waiting mode.`;
    case "no_inputs":
      return "This session has no live inputs yet. Add manual tickers or enable at least one subscribed source.";
  }
}

export function formatSignalScopeSectionCaption(
  inputModel: SessionInputModel,
): string {
  switch (inputModel) {
    case "search_scoped":
      return "Tell the web search what to look at.";
    case "search_universe":
      return "Configure full-universe discovery for web search.";
    case "manual_only":
      return "Enter the tickers this session should evaluate.";
    case "listener":
      return "Automatic listener — nothing to configure.";
  }
}

export function formatInstrumentOriginLabel(input: {
  inputModel: SessionInputModel;
  experienceDisplayName?: string | null;
  experienceSignalSourceType?: SignalSourceType | null;
  timerSymbol?: string | null;
  timerCadence?: string | null;
  instrumentScope: string;
}): string {
  switch (input.inputModel) {
    case "listener":
      if (input.experienceSignalSourceType === "timer" && input.timerSymbol) {
        return input.timerCadence
          ? `${input.timerSymbol} @ ${input.timerCadence} (timer)`
          : `${input.timerSymbol} (timer)`;
      }
      if (input.experienceSignalSourceType) {
        return `From ${formatSignalSourceTypeLabel(input.experienceSignalSourceType)}`;
      }
      return "From signal source";
    case "search_universe": {
      const focus = parseSearchEverythingFocusInstrumentClass(
        input.instrumentScope,
      );
      return focus
        ? `Full universe (focus ${formatInstrumentClass(focus)})`
        : "Full universe";
    }
    case "search_scoped":
    case "manual_only":
      return input.instrumentScope.trim() || "—";
  }
}

export function formatSelectionModeChip(input: {
  selectionMode: "manual_shortlist" | "ai_selected_universe" | "signal_driven";
  inputModel?: SessionInputModel;
  experienceSignalSourceType?: SignalSourceType | null;
}): { label: string; tooltip: string } {
  if (
    input.selectionMode === "signal_driven" ||
    input.inputModel === "listener"
  ) {
    const sourceLabel = input.experienceSignalSourceType
      ? formatSignalSourceTypeLabel(input.experienceSignalSourceType)
      : "signal source";
    return {
      label: "Signals",
      tooltip: `Instruments come from the subscribed ${sourceLabel.toLowerCase()} feed.`,
    };
  }
  if (input.selectionMode === "ai_selected_universe") {
    return {
      label: "AI",
      tooltip: "AI mode discovers instruments from the allowed universe.",
    };
  }
  return {
    label: "Manual",
    tooltip: "Manual mode works from the tickers you provide.",
  };
}

export function parseTimerSourceConfig(configJson: string): {
  symbol: string | null;
  cadence: string | null;
  instrumentClass: InstrumentClass | null;
} {
  try {
    const parsed = JSON.parse(configJson) as {
      symbol?: string;
      cadence?: string;
      instrumentClass?: InstrumentClass;
    };
    return {
      symbol: parsed.symbol ?? null,
      cadence: parsed.cadence ?? null,
      instrumentClass: parsed.instrumentClass ?? null,
    };
  } catch {
    return { symbol: null, cadence: null, instrumentClass: null };
  }
}

function formatInstrumentClass(value: InstrumentClass): string {
  return value === "stock"
    ? "stocks"
    : value === "crypto"
      ? "crypto"
      : value === "futures"
        ? "futures"
        : "prediction markets";
}

export function sourceIsCompatibleWithExperience(
  sourceType: SignalSourceType,
  allowedTypes: readonly SignalSourceType[],
): boolean {
  return allowedTypes.includes(sourceType);
}

export function missingExperienceSourceMessage(input: {
  experienceDisplayName: string;
  requiredType: SignalSourceType;
}): string {
  return `${input.experienceDisplayName} requires a ${formatSignalSourceTypeLabel(input.requiredType)} signal source, but none is provisioned yet.`;
}
