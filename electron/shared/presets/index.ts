import type {
  ResearchPosturePreset,
  RiskPreset,
  TimeframePreset,
  TradeRulesPreset,
} from "../domain";
import type {
  ResearchPosturePresetId,
  RiskPresetId,
  TimeframePresetId,
  TradeRulesPresetId,
} from "../domain";

import globalStrategyJson from "./global-strategy.json";
import riskJson from "./risk.json";
import timeframeJson from "./timeframe.json";
import researchPostureJson from "./research-posture.json";
import tradeRulesJson from "./trade-rules.json";

export interface GlobalStrategyPreset {
  id: string;
  label: string;
  description: string;
  summaryBullets: string[];
  posturePresetId: ResearchPosturePresetId;
  rulesPresetId: TradeRulesPresetId;
  riskPresetId: RiskPresetId;
  timeframePresetId: TimeframePresetId;
}

export const GLOBAL_STRATEGY_PRESETS: readonly GlobalStrategyPreset[] =
  globalStrategyJson as readonly GlobalStrategyPreset[];

export const RISK_PRESETS: readonly RiskPreset[] = riskJson as readonly RiskPreset[];

export const TIMEFRAME_PRESETS: readonly TimeframePreset[] = timeframeJson as readonly TimeframePreset[];

export const RESEARCH_POSTURE_PRESETS: readonly ResearchPosturePreset[] =
  researchPostureJson as readonly ResearchPosturePreset[];

export const TRADE_RULE_PRESETS: readonly TradeRulesPreset[] = tradeRulesJson as readonly TradeRulesPreset[];
