import type { WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import type { ResearchDiscoveryMode } from "@electron/shared/domain";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/catalog/search-providers";
import { ENGINE_BINDINGS } from "@electron/shared/ai/pipeline-config";
import { z } from "zod";
import { candidateSchema } from "@electron/shared/ai/selector-pipeline-candidate";
import {
  chartPatternOutputSchema,
  momentumOutputSchema,
  volumeOutputSchema,
} from "../engines/aggregators/technical-aggregator";
import {
  earningsOutputSchema,
  catalystOutputSchema,
  sentimentOutputSchema,
} from "../engines/aggregators/fundamental-aggregator";

const candidateOutputSchema = z.object({
  candidates: z.array(
    candidateSchema.pick({
      symbol: true,
      instrumentClass: true,
      instrumentDisplayName: true,
      source: true,
      hypeScore: true,
      volumeScore: true,
      catalystScore: true,
      liquidityScore: true,
      catalystSummary: true,
      riskFlags: true,
      rationale: true,
    }),
  ).max(6),
});

const SEARCH_WEB_TOOL_CONFIG = {
  search_web: { fallbackProviderId: BUILT_IN_DUCKDUCKGO_PROVIDER_ID },
} as const;

const STANDARD_SELECTOR_DISCOVERY: readonly WorkerDefinition[] = [
  {
    id: "web-scout",
    promptAssetPath: "selector-workers/web-scout",
    tools: ["search_web", "fetch_url"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: candidateOutputSchema,
  },
  {
    id: "reddit-scout",
    promptAssetPath: "selector-workers/reddit-scout",
    tools: ["search_reddit"],
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: candidateOutputSchema,
  },
  {
    id: "trend-scout",
    promptAssetPath: "selector-workers/trend-scout",
    tools: ["get_trending_symbols", "search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: candidateOutputSchema,
  },
];

const EVENT_SELECTOR_DISCOVERY: readonly WorkerDefinition[] = [
  {
    id: "event-web-scout",
    promptAssetPath: "selector-workers/event-web-scout",
    tools: ["search_web", "fetch_url"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: candidateOutputSchema,
  },
  {
    id: "event-prediction-scout",
    promptAssetPath: "selector-workers/event-prediction-scout",
    tools: ["search_web", "get_trending_symbols"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: candidateOutputSchema,
  },
];

const STANDARD_TECHNICAL: readonly WorkerDefinition[] = [
  {
    id: "chart-pattern",
    promptAssetPath: "technical-workers/chart-pattern",
    tools: ["get_ohlcv"],
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: chartPatternOutputSchema,
  },
  {
    id: "momentum-indicator",
    promptAssetPath: "technical-workers/momentum-indicator",
    tools: ["get_ohlcv", "get_quote"],
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: momentumOutputSchema,
  },
  {
    id: "volume-profile",
    promptAssetPath: "technical-workers/volume-profile",
    tools: ["get_ohlcv"],
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: volumeOutputSchema,
  },
];

const EVENT_TECHNICAL: readonly WorkerDefinition[] = [
  {
    id: "implied-probability",
    promptAssetPath: "technical-workers/event-implied-probability",
    tools: ["get_quote", "get_ohlcv"],
    outputMode: "object",
    outputSchema: chartPatternOutputSchema,
  },
  {
    id: "price-drift",
    promptAssetPath: "technical-workers/event-price-drift",
    tools: ["get_ohlcv", "get_quote"],
    outputMode: "object",
    outputSchema: momentumOutputSchema,
  },
  {
    id: "event-liquidity",
    promptAssetPath: "technical-workers/event-liquidity",
    tools: ["get_ohlcv", "get_quote"],
    outputMode: "object",
    outputSchema: volumeOutputSchema,
  },
];

const STANDARD_FUNDAMENTAL: readonly WorkerDefinition[] = [
  {
    id: "earnings-context",
    promptAssetPath: "fundamental-workers/earnings-context",
    tools: ["get_news"],
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: earningsOutputSchema,
  },
  {
    id: "catalyst-context",
    promptAssetPath: "fundamental-workers/catalyst-context",
    tools: ["get_news", "search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: catalystOutputSchema,
  },
  {
    id: "sentiment-context",
    promptAssetPath: "fundamental-workers/sentiment-context",
    tools: ["search_reddit", "search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: sentimentOutputSchema,
  },
];

const EVENT_FUNDAMENTAL: readonly WorkerDefinition[] = [
  {
    id: "resolution-context",
    promptAssetPath: "fundamental-workers/event-resolution",
    tools: ["get_news", "search_web"],
    outputMode: "object",
    outputSchema: earningsOutputSchema,
  },
  {
    id: "event-catalyst",
    promptAssetPath: "fundamental-workers/event-catalyst",
    tools: ["get_news", "search_web", "fetch_url"],
    outputMode: "object",
    outputSchema: catalystOutputSchema,
  },
  {
    id: "event-sentiment",
    promptAssetPath: "fundamental-workers/event-sentiment",
    tools: ["search_web", "search_reddit"],
    outputMode: "object",
    outputSchema: sentimentOutputSchema,
  },
];

function isEventContractScan(discoveryMode: ResearchDiscoveryMode): boolean {
  return discoveryMode === "event_contract_scan";
}

export function selectorDiscoveryWorkersForMode(discoveryMode: ResearchDiscoveryMode): readonly WorkerDefinition[] {
  return isEventContractScan(discoveryMode) ? EVENT_SELECTOR_DISCOVERY : STANDARD_SELECTOR_DISCOVERY;
}

export function technicalWorkersForMode(discoveryMode: ResearchDiscoveryMode): readonly WorkerDefinition[] {
  return isEventContractScan(discoveryMode) ? EVENT_TECHNICAL : STANDARD_TECHNICAL;
}

export function fundamentalWorkersForMode(discoveryMode: ResearchDiscoveryMode): readonly WorkerDefinition[] {
  return isEventContractScan(discoveryMode) ? EVENT_FUNDAMENTAL : STANDARD_FUNDAMENTAL;
}
