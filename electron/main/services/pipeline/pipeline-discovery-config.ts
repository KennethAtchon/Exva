import {
  FUNDAMENTAL_WORKERS_CATALYST_CONTEXT_PROMPT,
  FUNDAMENTAL_WORKERS_EARNINGS_CONTEXT_PROMPT,
  FUNDAMENTAL_WORKERS_EVENT_CATALYST_PROMPT,
  FUNDAMENTAL_WORKERS_EVENT_RESOLUTION_PROMPT,
  FUNDAMENTAL_WORKERS_EVENT_SENTIMENT_PROMPT,
  FUNDAMENTAL_WORKERS_SENTIMENT_CONTEXT_PROMPT,
  SELECTOR_WORKERS_EVENT_PREDICTION_SCOUT_PROMPT,
  SELECTOR_WORKERS_EVENT_WEB_SCOUT_PROMPT,
  SELECTOR_WORKERS_REDDIT_SCOUT_PROMPT,
  SELECTOR_WORKERS_TREND_SCOUT_PROMPT,
  SELECTOR_WORKERS_WEB_SCOUT_PROMPT,
  TECHNICAL_WORKERS_CHART_PATTERN_PROMPT,
  TECHNICAL_WORKERS_EVENT_IMPLIED_PROBABILITY_PROMPT,
  TECHNICAL_WORKERS_EVENT_LIQUIDITY_PROMPT,
  TECHNICAL_WORKERS_EVENT_PRICE_DRIFT_PROMPT,
  TECHNICAL_WORKERS_MOMENTUM_INDICATOR_PROMPT,
  TECHNICAL_WORKERS_VOLUME_PROFILE_PROMPT,
} from "./worker-prompts";
import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import type { ResearchDiscoveryMode } from "@electron/shared/domain";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/instruments/search-providers";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import { candidateOutputSchema } from "./implementations/selector/selector-schemas";
import {
  chartPatternOutputSchema,
  momentumOutputSchema,
  volumeOutputSchema,
} from "../signal/aggregators/technical-aggregator";
import {
  earningsOutputSchema,
  catalystOutputSchema,
  sentimentOutputSchema,
} from "../signal/aggregators/fundamental-aggregator";

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
    prompt: SELECTOR_WORKERS_WEB_SCOUT_PROMPT,
    tools: ["search_web", "fetch_url"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    toolRequirements: { requiredAll: ["search_web"], minToolCalls: 1 },
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: candidateOutputSchema,
  },
  {
    id: "reddit-scout",
    prompt: SELECTOR_WORKERS_REDDIT_SCOUT_PROMPT,
    tools: ["search_reddit"],
    toolRequirements: { requiredAll: ["search_reddit"], minToolCalls: 1 },
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: candidateOutputSchema,
  },
  {
    id: "trend-scout",
    prompt: SELECTOR_WORKERS_TREND_SCOUT_PROMPT,
    tools: ["get_trending_symbols", "search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    toolRequirements: {
      requiredAll: ["get_trending_symbols"],
      minToolCalls: 1,
    },
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: candidateOutputSchema,
  },
];

const EVENT_SELECTOR_DISCOVERY: readonly WorkerDefinition[] = [
  {
    id: "event-web-scout",
    prompt: SELECTOR_WORKERS_EVENT_WEB_SCOUT_PROMPT,
    tools: ["search_web", "fetch_url"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: candidateOutputSchema,
  },
  {
    id: "event-prediction-scout",
    prompt: SELECTOR_WORKERS_EVENT_PREDICTION_SCOUT_PROMPT,
    tools: ["search_web", "get_trending_symbols"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: candidateOutputSchema,
  },
];

const STANDARD_TECHNICAL: readonly WorkerDefinition[] = [
  {
    id: "chart-pattern",
    prompt: TECHNICAL_WORKERS_CHART_PATTERN_PROMPT,
    tools: ["get_ohlcv"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: chartPatternOutputSchema,
  },
  {
    id: "momentum-indicator",
    prompt: TECHNICAL_WORKERS_MOMENTUM_INDICATOR_PROMPT,
    tools: ["get_ohlcv", "get_quote"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: momentumOutputSchema,
  },
  {
    id: "volume-profile",
    prompt: TECHNICAL_WORKERS_VOLUME_PROFILE_PROMPT,
    tools: ["get_ohlcv"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: volumeOutputSchema,
  },
];

const EVENT_TECHNICAL: readonly WorkerDefinition[] = [
  {
    id: "implied-probability",
    prompt: TECHNICAL_WORKERS_EVENT_IMPLIED_PROBABILITY_PROMPT,
    tools: ["get_quote", "get_ohlcv"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: chartPatternOutputSchema,
  },
  {
    id: "price-drift",
    prompt: TECHNICAL_WORKERS_EVENT_PRICE_DRIFT_PROMPT,
    tools: ["get_ohlcv", "get_quote"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: momentumOutputSchema,
  },
  {
    id: "event-liquidity",
    prompt: TECHNICAL_WORKERS_EVENT_LIQUIDITY_PROMPT,
    tools: ["get_ohlcv", "get_quote"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: volumeOutputSchema,
  },
];

const STANDARD_FUNDAMENTAL: readonly WorkerDefinition[] = [
  {
    id: "earnings-context",
    prompt: FUNDAMENTAL_WORKERS_EARNINGS_CONTEXT_PROMPT,
    tools: ["get_news"],
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: earningsOutputSchema,
  },
  {
    id: "catalyst-context",
    prompt: FUNDAMENTAL_WORKERS_CATALYST_CONTEXT_PROMPT,
    tools: ["get_news", "search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: catalystOutputSchema,
  },
  {
    id: "sentiment-context",
    prompt: FUNDAMENTAL_WORKERS_SENTIMENT_CONTEXT_PROMPT,
    tools: ["search_reddit", "search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: sentimentOutputSchema,
  },
];

const EVENT_FUNDAMENTAL: readonly WorkerDefinition[] = [
  {
    id: "resolution-context",
    prompt: FUNDAMENTAL_WORKERS_EVENT_RESOLUTION_PROMPT,
    tools: ["get_news", "search_web"],
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: earningsOutputSchema,
  },
  {
    id: "event-catalyst",
    prompt: FUNDAMENTAL_WORKERS_EVENT_CATALYST_PROMPT,
    tools: ["get_news", "search_web", "fetch_url"],
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: catalystOutputSchema,
  },
  {
    id: "event-sentiment",
    prompt: FUNDAMENTAL_WORKERS_EVENT_SENTIMENT_PROMPT,
    tools: ["search_web", "search_reddit"],
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
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
