import type { InstrumentClass } from "@/lib/types";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type { SignalSourceType } from "@electron/shared/domain/signals";
import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";
import type { ScriptedWorkerOutputs } from "../../main/services/broker/mock/mock-scenario-worker-outputs";

export { signalDisplayName, scheduleDisplayName } from "./signal-timing";

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
  /** Bar timeframe the strategy trades on; seeds session config and drives OHLCV fetches. */
  defaultAnalysisTimeframe: TradingTimeframe;
  enabledByDefault: boolean;
  presetOverrides?: Partial<ExperiencePresetIds>;
  mockFixtures: {
    defaultScenario: MockScenarioKind;
    scriptedWorkerOutputs: ScriptedWorkerOutputs;
  };
}

/**
 * Clock-driven scan owned by SessionScheduler — not a SignalSourceType.
 * Legacy DB identity rows may still use type `timer` for subscription fan-out.
 */
export interface ScheduledScanDescriptor {
  id: string;
  instrumentClass: InstrumentClass;
  symbol: string;
  cadence: string;
  defaultAnalysisTimeframe: TradingTimeframe;
  enabledByDefault: boolean;
  marketHours?: "regular" | "extended" | "24_7";
  presetOverrides?: Partial<ExperiencePresetIds>;
  mockFixtures: SignalDescriptor["mockFixtures"];
}
