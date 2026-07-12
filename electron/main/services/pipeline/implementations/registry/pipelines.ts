import type { PipelineDescriptor } from "./pipeline-descriptor-store";
import { PIPELINE_WORKER_SETS } from "../../worker-registry";
import { DEFAULT_TRADE_CYCLE } from "../trade/default-analysis";
import { EDGAR_8K_TRADE_CYCLE } from "../filing/edgar-8k-analysis";
import { RULES_MEAN_REVERSION_CYCLE } from "../rules/mean-reversion-analysis";
import { RULES_TREND_FOLLOWING_CYCLE } from "../rules/trend-following-analysis";
import { RULES_BREAKOUT_CYCLE } from "../rules/breakout-analysis";
import { OPTIONS_FLOW_CYCLE } from "../rules/options-flow-analysis";
import { PREDICTION_EDGE_CYCLE } from "../prediction/prediction-edge-analysis";

export const DEFAULT_PIPELINE: PipelineDescriptor = {
  id: "default-trade-cycle",
  displayName: "Default trade cycle",
  automation: "ai",
  phases: ["technical", "fundamental", "review", "decision"],
  signalSources: ["manual"],
  isDefault: true,
  plan: DEFAULT_TRADE_CYCLE,
  phaseWorkers: {
    ...PIPELINE_WORKER_SETS.defaultTrade,
    selector: PIPELINE_WORKER_SETS.selector.standard,
  },
};

export const EDGAR_8K_PIPELINE: PipelineDescriptor = {
  id: "edgar-8k-cycle",
  displayName: "EDGAR 8-K (self-describing)",
  automation: "ai",
  phases: ["fundamental", "review", "decision"],
  signalSources: ["edgar_8k", "mock"],
  plan: EDGAR_8K_TRADE_CYCLE,
  phaseWorkers: PIPELINE_WORKER_SETS.catalystTwoCall,
};

export const RULES_MEAN_REVERSION_PIPELINE: PipelineDescriptor = {
  id: "rules-mean-reversion-cycle",
  displayName: "Rules mean reversion",
  automation: "deterministic",
  phases: ["decision"],
  signalSources: [],
  plan: RULES_MEAN_REVERSION_CYCLE,
  phaseWorkers: { decision: [] },
};

export const RULES_TREND_FOLLOWING_PIPELINE: PipelineDescriptor = {
  id: "rules-trend-following-cycle",
  displayName: "Rules trend following",
  automation: "deterministic",
  phases: ["decision"],
  signalSources: [],
  plan: RULES_TREND_FOLLOWING_CYCLE,
  phaseWorkers: { decision: [] },
};

export const RULES_BREAKOUT_PIPELINE: PipelineDescriptor = {
  id: "rules-breakout-cycle",
  displayName: "Rules momentum breakout",
  automation: "deterministic",
  phases: ["decision"],
  signalSources: [],
  plan: RULES_BREAKOUT_CYCLE,
  phaseWorkers: { decision: [] },
};

export const OPTIONS_FLOW_PIPELINE: PipelineDescriptor = {
  id: "options-flow-cycle",
  displayName: "Options flow edge",
  automation: "deterministic",
  phases: ["decision"],
  signalSources: [],
  plan: OPTIONS_FLOW_CYCLE,
  phaseWorkers: { decision: [] },
};

export const PREDICTION_EVENT_PIPELINE: PipelineDescriptor = {
  id: "prediction-event-cycle",
  displayName: "Prediction event edge",
  automation: "ai",
  phases: ["fundamental", "review", "decision"],
  signalSources: ["prediction_event"],
  plan: PREDICTION_EDGE_CYCLE,
  phaseWorkers: {
    // Forecaster researches and estimates p_hat; red team challenges it; the
    // decision phase is a deterministic edge gate (no workers).
    fundamental: ["pm-forecaster"],
    review: ["pm-red-team"],
    decision: [],
    selector: PIPELINE_WORKER_SETS.selector.event,
  },
};

export const ALL_PIPELINES: readonly PipelineDescriptor[] = [
  DEFAULT_PIPELINE,
  EDGAR_8K_PIPELINE,
  RULES_MEAN_REVERSION_PIPELINE,
  RULES_TREND_FOLLOWING_PIPELINE,
  RULES_BREAKOUT_PIPELINE,
  OPTIONS_FLOW_PIPELINE,
  PREDICTION_EVENT_PIPELINE,
];
