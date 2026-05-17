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

// Internal arrays — not exported. Use seed helpers below or query the DB.
const _globalStrategyPresets: readonly GlobalStrategyPreset[] = globalStrategyJson as readonly GlobalStrategyPreset[];
const _riskPresets: readonly RiskPreset[] = riskJson as readonly RiskPreset[];
const _timeframePresets: readonly TimeframePreset[] = timeframeJson as readonly TimeframePreset[];
const _researchPosturePresets: readonly ResearchPosturePreset[] = researchPostureJson as readonly ResearchPosturePreset[];
const _tradeRulePresets: readonly TradeRulesPreset[] = tradeRulesJson as readonly TradeRulesPreset[];

/** For use in seed.ts only — returns the full built-in array. */
export function builtInGlobalStrategyPresets(): readonly GlobalStrategyPreset[] {
  return _globalStrategyPresets;
}

export function builtInRiskPresets(): readonly RiskPreset[] {
  return _riskPresets;
}

export function builtInTimeframePresets(): readonly TimeframePreset[] {
  return _timeframePresets;
}

export function builtInResearchPosturePresets(): readonly ResearchPosturePreset[] {
  return _researchPosturePresets;
}

export function builtInTradeRulePresets(): readonly TradeRulesPreset[] {
  return _tradeRulePresets;
}

// Read-only reference arrays for UI display (dropdown options, label lookups).
// Import from here — not from shared/domain.
export const RISK_PRESETS: readonly RiskPreset[] = _riskPresets;
export const TIMEFRAME_PRESETS: readonly TimeframePreset[] = _timeframePresets;
export const RESEARCH_POSTURE_PRESETS: readonly ResearchPosturePreset[] = _researchPosturePresets;
export const TRADE_RULE_PRESETS: readonly TradeRulesPreset[] = _tradeRulePresets;
