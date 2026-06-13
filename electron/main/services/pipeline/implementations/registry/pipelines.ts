import type { PipelineDescriptor } from "./pipeline-descriptor-store";
import { PIPELINE_WORKER_SETS } from "../../worker-registry";
import { DEFAULT_TRADE_CYCLE } from "../trade/default-analysis";
import { EDGAR_8K_TRADE_CYCLE } from "../filing/edgar-8k-analysis";
import { RULES_MEAN_REVERSION_CYCLE } from "../rules/mean-reversion-analysis";

/**
 * Default pipeline — serves web_search and manual signals, and is the fallback
 * for any source with no explicit mapping. Wraps the existing cycle plan
 * unchanged.
 */
export const DEFAULT_PIPELINE: PipelineDescriptor = {
  id: "default-trade-cycle",
  displayName: "Default trade cycle",
  phases: ["technical", "fundamental", "review", "decision"],
  signalSources: ["web_search", "manual"],
  isDefault: true,
  plan: DEFAULT_TRADE_CYCLE,
  phaseWorkers: PIPELINE_WORKER_SETS.defaultTrade,
  selectorWorkerIds: PIPELINE_WORKER_SETS.selector.standard,
};

/**
 * EDGAR 8-K pipeline — self-describing filings route here. Same AI phases as the
 * default; differs by skipping candidate validation (the filing establishes the
 * instrument). See edgar-8k-analysis.ts.
 */
export const EDGAR_8K_PIPELINE: PipelineDescriptor = {
  id: "edgar-8k-cycle",
  displayName: "EDGAR 8-K (self-describing)",
  phases: ["fundamental", "review", "decision"],
  signalSources: ["edgar_8k", "mock"],
  plan: EDGAR_8K_TRADE_CYCLE,
  phaseWorkers: PIPELINE_WORKER_SETS.catalystTwoCall,
  selectorWorkerIds: [],
};

/**
 * Deterministic rules pipeline — timer-driven mean reversion, zero LLM calls.
 */
export const RULES_MEAN_REVERSION_PIPELINE: PipelineDescriptor = {
  id: "rules-mean-reversion-cycle",
  displayName: "Rules mean reversion",
  phases: ["decision"],
  signalSources: ["timer"],
  plan: RULES_MEAN_REVERSION_CYCLE,
  phaseWorkers: { decision: [] },
  selectorWorkerIds: [],
};

/**
 * Prediction-market event pipeline — social/odds dislocation signals route here.
 */
export const PREDICTION_EVENT_PIPELINE: PipelineDescriptor = {
  id: "prediction-event-cycle",
  displayName: "Prediction event edge",
  phases: ["technical", "fundamental", "review", "decision"],
  signalSources: ["prediction_event"],
  plan: DEFAULT_TRADE_CYCLE,
  phaseWorkers: PIPELINE_WORKER_SETS.defaultTrade,
  selectorWorkerIds: PIPELINE_WORKER_SETS.selector.event,
};

export const ALL_PIPELINES: readonly PipelineDescriptor[] = [
  DEFAULT_PIPELINE,
  EDGAR_8K_PIPELINE,
  RULES_MEAN_REVERSION_PIPELINE,
  PREDICTION_EVENT_PIPELINE,
];
