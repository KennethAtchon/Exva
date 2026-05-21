import type { WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import type { ResearchDiscoveryMode } from "@electron/shared/domain";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/catalog/search-providers";
import { ENGINE_BINDINGS } from "@electron/shared/ai/pipeline-config";
import { candidateOutputSchema } from "./plan/plans/selector/schemas";
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

const SEARCH_WEB_TOOL_CONFIG = {
  search_web: { fallbackProviderId: BUILT_IN_DUCKDUCKGO_PROVIDER_ID },
} as const;

const SELECTOR_DISCOVERY_STRATEGY_CONTEXT = {
  fields: [
    "identity",
    "researchPosture",
    "tradeRules",
    "riskLimits",
    "timeframe",
    "presetBehavior",
  ],
  guidance: ["objective", "whatToLookFor", "howToEvaluate", "avoid"],
  maxGuidanceItems: 3,
} as const;

const TECHNICAL_STRATEGY_CONTEXT = {
  fields: [
    "identity",
    "tradeRules",
    "riskLimits",
    "timeframe",
    "presetBehavior",
  ],
  guidance: ["objective", "whatToLookFor", "howToEvaluate", "avoid"],
  maxGuidanceItems: 2,
} as const;

const FUNDAMENTAL_STRATEGY_CONTEXT = {
  fields: ["identity", "researchPosture", "timeframe", "presetBehavior"],
  guidance: ["objective", "whatToLookFor", "howToEvaluate", "avoid"],
  maxGuidanceItems: 2,
} as const;

const STANDARD_SELECTOR_DISCOVERY: readonly WorkerDefinition[] = [
  {
    id: "web-scout",
    promptAssetPath: "selector-workers/web-scout",
    tools: ["search_web", "fetch_url"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    toolRequirements: { requiredAll: ["search_web"], minToolCalls: 1 },
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: candidateOutputSchema,
  },
  {
    id: "reddit-scout",
    promptAssetPath: "selector-workers/reddit-scout",
    tools: ["search_reddit"],
    toolRequirements: { requiredAll: ["search_reddit"], minToolCalls: 1 },
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: candidateOutputSchema,
  },
  {
    id: "trend-scout",
    promptAssetPath: "selector-workers/trend-scout",
    tools: ["get_trending_symbols", "search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    toolRequirements: {
      requiredAll: ["get_trending_symbols"],
      minToolCalls: 1,
    },
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
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
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: candidateOutputSchema,
  },
  {
    id: "event-prediction-scout",
    promptAssetPath: "selector-workers/event-prediction-scout",
    tools: ["search_web", "get_trending_symbols"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
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
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: chartPatternOutputSchema,
  },
  {
    id: "momentum-indicator",
    promptAssetPath: "technical-workers/momentum-indicator",
    tools: ["get_ohlcv", "get_quote"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: momentumOutputSchema,
  },
  {
    id: "volume-profile",
    promptAssetPath: "technical-workers/volume-profile",
    tools: ["get_ohlcv"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
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
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    outputMode: "object",
    outputSchema: chartPatternOutputSchema,
  },
  {
    id: "price-drift",
    promptAssetPath: "technical-workers/event-price-drift",
    tools: ["get_ohlcv", "get_quote"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    outputMode: "object",
    outputSchema: momentumOutputSchema,
  },
  {
    id: "event-liquidity",
    promptAssetPath: "technical-workers/event-liquidity",
    tools: ["get_ohlcv", "get_quote"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    outputMode: "object",
    outputSchema: volumeOutputSchema,
  },
];

const STANDARD_FUNDAMENTAL: readonly WorkerDefinition[] = [
  {
    id: "earnings-context",
    promptAssetPath: "fundamental-workers/earnings-context",
    tools: ["get_news"],
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: earningsOutputSchema,
  },
  {
    id: "catalyst-context",
    promptAssetPath: "fundamental-workers/catalyst-context",
    tools: ["get_news", "search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "object",
    outputSchema: catalystOutputSchema,
  },
  {
    id: "sentiment-context",
    promptAssetPath: "fundamental-workers/sentiment-context",
    tools: ["search_reddit", "search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
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
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    outputMode: "object",
    outputSchema: earningsOutputSchema,
  },
  {
    id: "event-catalyst",
    promptAssetPath: "fundamental-workers/event-catalyst",
    tools: ["get_news", "search_web", "fetch_url"],
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    outputMode: "object",
    outputSchema: catalystOutputSchema,
  },
  {
    id: "event-sentiment",
    promptAssetPath: "fundamental-workers/event-sentiment",
    tools: ["search_web", "search_reddit"],
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    outputMode: "object",
    outputSchema: sentimentOutputSchema,
  },
];

function isEventContractScan(discoveryMode: ResearchDiscoveryMode): boolean {
  return discoveryMode === "event_contract_scan";
}

export function selectorDiscoveryWorkersForMode(
  discoveryMode: ResearchDiscoveryMode,
): readonly WorkerDefinition[] {
  return isEventContractScan(discoveryMode)
    ? EVENT_SELECTOR_DISCOVERY
    : STANDARD_SELECTOR_DISCOVERY;
}

export function technicalWorkersForMode(
  discoveryMode: ResearchDiscoveryMode,
): readonly WorkerDefinition[] {
  return isEventContractScan(discoveryMode)
    ? EVENT_TECHNICAL
    : STANDARD_TECHNICAL;
}

export function fundamentalWorkersForMode(
  discoveryMode: ResearchDiscoveryMode,
): readonly WorkerDefinition[] {
  return isEventContractScan(discoveryMode)
    ? EVENT_FUNDAMENTAL
    : STANDARD_FUNDAMENTAL;
}
