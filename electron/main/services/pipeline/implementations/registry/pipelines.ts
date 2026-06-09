import type { PipelineDescriptor } from "./pipeline-router";
import { DEFAULT_TRADE_CYCLE } from "../trade/default-analysis";
import { EDGAR_8K_TRADE_CYCLE } from "../filing/edgar-8k-analysis";

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
};

/**
 * EDGAR 8-K pipeline — self-describing filings route here. Same AI phases as the
 * default; differs by skipping candidate validation (the filing establishes the
 * instrument). See edgar-8k-analysis.ts.
 */
export const EDGAR_8K_PIPELINE: PipelineDescriptor = {
  id: "edgar-8k-cycle",
  displayName: "EDGAR 8-K (self-describing)",
  phases: ["technical", "fundamental", "review", "decision"],
  signalSources: ["edgar_8k"],
  plan: EDGAR_8K_TRADE_CYCLE,
};

export const ALL_PIPELINES: readonly PipelineDescriptor[] = [
  DEFAULT_PIPELINE,
  EDGAR_8K_PIPELINE,
];
