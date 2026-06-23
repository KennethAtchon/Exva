import type { InstrumentClass } from "@/lib/types";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type { SignalSourceType } from "@electron/shared/domain/signals";
import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";
import type { ScriptedWorkerOutputs } from "../../main/services/broker/mock/mock-scenario-worker-outputs";

export { signalDisplayName } from "./signal-timing";

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

