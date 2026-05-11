import type { ResearchPosturePresetId, RiskPresetId, TimeframePresetId, TradeRulesPresetId } from "./domain";

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

export const GLOBAL_STRATEGY_PRESETS: readonly GlobalStrategyPreset[] = [
  {
    id: "trend_momentum",
    label: "Trend Momentum",
    description: "Ride persistent trends with breakout entries and trailing stops.",
    summaryBullets: [
      "Style: Trend Hunt — price-action first, catalysts preferred.",
      "Rules: Breakout Long — trailing ATR exits.",
      "Risk: Moderate — $500 positions, balanced limits.",
      "Timeframe: Swing — 4h bars, 3–14 day holds.",
    ],
    posturePresetId: "trend_hunt",
    rulesPresetId: "breakout_long",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  {
    id: "catalyst_play",
    label: "Catalyst Play",
    description: "Chase event-driven momentum with tight time-sensitive entries.",
    summaryBullets: [
      "Style: Catalyst Momentum — catalysts required.",
      "Rules: Event Entry — time-based exits.",
      "Risk: Aggressive — $1000 positions, wider exposure.",
      "Timeframe: Intraday — flat by end of session.",
    ],
    posturePresetId: "catalyst_momentum",
    rulesPresetId: "event_entry",
    riskPresetId: "aggressive",
    timeframePresetId: "intraday",
  },
  {
    id: "quality_value",
    label: "Quality Value",
    description: "Patient entry into high-quality names with deep fundamental confirmation.",
    summaryBullets: [
      "Style: Institutional Quality — confirmation-first, deep fundamentals.",
      "Rules: Pullback Trend — scale-in entries.",
      "Risk: Conservative — $200 positions, human approval.",
      "Timeframe: Position — daily bars, weeks-long holds.",
    ],
    posturePresetId: "institutional_quality",
    rulesPresetId: "pullback_trend",
    riskPresetId: "conservative",
    timeframePresetId: "position",
  },
  {
    id: "mean_reversion",
    label: "Mean Reversion",
    description: "Fade exhausted moves where odds favor a snap-back to fair value.",
    summaryBullets: [
      "Style: Mean Reversion Dislocation — reversal confirmation required.",
      "Rules: Reversal Fade — fixed-pct exits.",
      "Risk: Moderate — $500 positions, balanced limits.",
      "Timeframe: Swing — 4h bars, multi-day holds.",
    ],
    posturePresetId: "mean_reversion_dislocation",
    rulesPresetId: "reversal_fade",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  {
    id: "prediction_edge",
    label: "Prediction Edge",
    description: "Trade event contracts where evidence can shift implied probabilities before resolution.",
    summaryBullets: [
      "Style: Prediction Event Edge — probability-edge first.",
      "Rules: Probability Edge — market resolution exits.",
      "Risk: Prediction Market — Kelly-sized, $200 max per position.",
      "Timeframe: Prediction — hold to resolution.",
    ],
    posturePresetId: "prediction_event_edge",
    rulesPresetId: "probability_edge",
    riskPresetId: "prediction_market",
    timeframePresetId: "prediction",
  },
];
