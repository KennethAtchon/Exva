import type { InstrumentClass } from "@/lib/types";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type { SignalSourceType } from "@electron/shared/domain/signals";
import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";
import type { ScriptedWorkerOutputs } from "../../main/services/broker/mock/mock-scenario-worker-outputs";

export interface ExperiencePresetIds {
  posturePresetId: string;
  rulesPresetId: string;
  riskPresetId: string;
  timeframePresetId: string;
}

export interface SignalDescriptor {
  id: string;
  sourceType: SignalSourceType;
  instrumentClass: InstrumentClass;
  symbol: string | null;
  pollCadence: string | null;
  /** Seeds session_timeframe_config on session creation; session config governs at runtime. */
  defaultAnalysisTimeframe: TradingTimeframe;
  enabledByDefault: boolean;
  presetOverrides?: Partial<ExperiencePresetIds>;
  mockFixtures: {
    defaultScenario: MockScenarioKind;
    scriptedWorkerOutputs: ScriptedWorkerOutputs;
  };
}

function sourceTypeLabel(type: SignalSourceType): string {
  switch (type) {
    case "edgar_8k":
      return "EDGAR 8-K";
    case "prediction_event":
      return "Prediction Event";
    case "timer":
      return "Timer";
    case "mock":
      return "Mock";
    case "web_search":
      return "Web Search";
    case "manual":
      return "Manual";
    default:
      return type;
  }
}

/** Names are DERIVED so they cannot lie about behavior (Invariant I5). */
export function signalDisplayName(s: SignalDescriptor): string {
  const sym = s.symbol ?? sourceTypeLabel(s.sourceType);
  const cadence = s.pollCadence ? ` · every ${s.pollCadence}` : "";
  return `${sym} · ${s.defaultAnalysisTimeframe} TF${cadence}`;
}
