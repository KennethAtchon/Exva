import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import {
  predictionForecastSchema,
  predictionRedTeamSchema,
} from "@electron/shared/ai/prediction-research";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/instruments/search-providers";
import {
  PREDICTION_FORECASTER_PROMPT,
  PREDICTION_RED_TEAM_PROMPT,
} from "../worker-prompts";

const SEARCH_WEB_TOOL_CONFIG = {
  search_web: { fallbackProviderId: BUILT_IN_DUCKDUCKGO_PROVIDER_ID },
} as const;

const PREDICTION_STRATEGY_CONTEXT = {
  fields: ["identity", "researchPosture", "timeframe", "presetBehavior"],
  guidance: ["objective", "whatToLookFor", "howToEvaluate", "avoid"],
  maxGuidanceItems: 2,
} as const;

/** Fundamental phase: research the market and produce a calibrated probability. */
export const PREDICTION_FORECASTER_WORKER: WorkerDefinition = {
  id: "pm-forecaster",
  prompt: PREDICTION_FORECASTER_PROMPT,
  tools: ["search_web", "fetch_url"],
  toolConfig: SEARCH_WEB_TOOL_CONFIG,
  strategyContext: PREDICTION_STRATEGY_CONTEXT,
  engines: [],
  outputMode: "tool_result",
  outputSchema: predictionForecastSchema,
};

/** Review phase: adversarially re-estimate the probability. */
export const PREDICTION_RED_TEAM_WORKER: WorkerDefinition = {
  id: "pm-red-team",
  prompt: PREDICTION_RED_TEAM_PROMPT,
  tools: ["search_web", "fetch_url"],
  toolConfig: SEARCH_WEB_TOOL_CONFIG,
  strategyContext: PREDICTION_STRATEGY_CONTEXT,
  engines: [],
  outputMode: "tool_result",
  outputSchema: predictionRedTeamSchema,
};

export const PREDICTION_WORKERS: readonly WorkerDefinition[] = [
  PREDICTION_FORECASTER_WORKER,
  PREDICTION_RED_TEAM_WORKER,
];
