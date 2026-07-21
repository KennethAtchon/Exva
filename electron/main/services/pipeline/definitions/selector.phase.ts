import type { InstrumentSelection } from "@/lib/schemas";
import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import { AppError } from "@electron/shared/infra/errors";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/instruments/search-providers";
import { resolveWorkersByIds } from "../worker-registry";
import { requirePipelineDescriptor } from "../implementations/registry/pipeline-descriptor-store";
import type { LLMRunResult } from "../../llm/llm-types";
import type { AIPhase } from "../phases/types";
import type { FailureHistoryEntry } from "../../orchestration/cycle/runtime-outcome";
import {
  SELECTOR_WORKERS_CATALYST_FEED_SCOUT_PROMPT,
  SELECTOR_WORKERS_CATALYST_EXTRACTOR_PROMPT,
  SELECTOR_WORKERS_EVENT_PREDICTION_SCOUT_PROMPT,
  SELECTOR_WORKERS_EVENT_WEB_SCOUT_PROMPT,
  SELECTOR_WORKERS_LIQUIDITY_GATE_PROMPT,
  SELECTOR_WORKERS_MARKET_VALIDATOR_PROMPT,
  SELECTOR_WORKERS_WEB_SCOUT_PROMPT,
} from "../worker-prompts";
import {
  applyDiscoveryResults,
  applyVerificationResults,
  scoreSelectorCandidates,
  summarizeSelectorOutput,
  type SelectorCandidate,
} from "./selector.helpers";
import { candidateIdentityKey } from "../../signals/scoring/selector-candidate-merger";
import {
  candidateOutputSchema,
  verificationOutputSchema,
} from "./selector.schemas";

type VerificationOutput = import("zod").infer<typeof verificationOutputSchema>;

export type SelectorPlanState = {
  selectionInstructions: string;
  discoveryWorkerIds: string[];
  candidatesForVerification: SelectorCandidate[];
  verifiedCandidates: SelectorCandidate[];
};

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

const MARKET_VALIDATOR_STRATEGY_CONTEXT = {
  fields: [
    "identity",
    "researchPosture",
    "tradeRules",
    "riskLimits",
    "timeframe",
    "presetBehavior",
  ],
  guidance: ["objective", "whatToLookFor", "howToEvaluate", "avoid"],
  maxGuidanceItems: 2,
} as const;

const CATALYST_EXTRACTOR_STRATEGY_CONTEXT = {
  fields: ["identity", "researchPosture", "timeframe", "presetBehavior"],
  guidance: ["objective", "whatToLookFor", "howToEvaluate", "avoid"],
  maxGuidanceItems: 2,
} as const;

const LIQUIDITY_GATE_STRATEGY_CONTEXT = {
  fields: ["identity", "riskLimits", "timeframe", "presetBehavior"],
  guidance: ["howToEvaluate", "avoid"],
  maxGuidanceItems: 2,
} as const;

export const CATALYST_SELECTOR_DISCOVERY: readonly WorkerDefinition[] = [
  {
    id: "catalyst-feed-scout",
    prompt: SELECTOR_WORKERS_CATALYST_FEED_SCOUT_PROMPT,
    tools: ["search_web", "fetch_url", "get_quote"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: candidateOutputSchema,
  },
];

export const STANDARD_SELECTOR_DISCOVERY: readonly WorkerDefinition[] = [
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
];

export const EVENT_SELECTOR_DISCOVERY: readonly WorkerDefinition[] = [
  {
    id: "event-web-scout",
    prompt: SELECTOR_WORKERS_EVENT_WEB_SCOUT_PROMPT,
    tools: ["list_markets", "search_web", "fetch_url"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: candidateOutputSchema,
  },
  {
    id: "event-prediction-scout",
    prompt: SELECTOR_WORKERS_EVENT_PREDICTION_SCOUT_PROMPT,
    tools: ["list_markets", "search_web", "get_trending_symbols"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    toolRequirements: { requiredAll: ["list_markets"], minToolCalls: 1 },
    strategyContext: SELECTOR_DISCOVERY_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: candidateOutputSchema,
  },
];

function verificationWorkers(candidate: SelectorCandidate): WorkerDefinition[] {
  const identity = candidateIdentityKey(candidate);
  return [
    {
      id: `market-validator:${identity}`,
      prompt: SELECTOR_WORKERS_MARKET_VALIDATOR_PROMPT,
      tools: ["get_quote", "get_ohlcv"],
      toolRequirements: {
        requiredAll: ["get_quote", "get_ohlcv"],
        minToolCalls: 2,
      },
      strategyContext: MARKET_VALIDATOR_STRATEGY_CONTEXT,
      outputMode: "tool_result",
      outputSchema: verificationOutputSchema,
    },
    {
      id: `catalyst-extractor:${identity}`,
      prompt: SELECTOR_WORKERS_CATALYST_EXTRACTOR_PROMPT,
      tools: ["search_web", "fetch_url"],
      toolConfig: SEARCH_WEB_TOOL_CONFIG,
      toolRequirements: {
        requiredAny: ["search_web", "fetch_url"],
        minToolCalls: 1,
      },
      strategyContext: CATALYST_EXTRACTOR_STRATEGY_CONTEXT,
      outputMode: "tool_result",
      outputSchema: verificationOutputSchema,
    },
    {
      id: `liquidity-gate:${identity}`,
      prompt: SELECTOR_WORKERS_LIQUIDITY_GATE_PROMPT,
      tools: ["get_quote", "get_ohlcv"],
      toolRequirements: { requiredAll: ["get_quote"], minToolCalls: 1 },
      strategyContext: LIQUIDITY_GATE_STRATEGY_CONTEXT,
      outputMode: "tool_result",
      outputSchema: verificationOutputSchema,
    },
  ];
}

function parseVerificationWorkerIdentity(workerId: string): string {
  return workerId.replace(
    /^(market-validator|catalyst-extractor|liquidity-gate):/,
    "",
  );
}

export const SELECTOR_PHASE: AIPhase<SelectorPlanState, InstrumentSelection> = {
  phase: "selector",
  outputSchemaName: "instrumentSelection",
  inputKey: "selectionInstructions",
  cacheEngineId: "selector-instrument-cache",
  inputEngineIds: [
    "selector-scope",
    "broker-coverage",
    "prediction-market-candidates",
  ],
  entryEngineIds: ["signal-seeded", "manual-shortlist"],
  catalog: { outputMode: "tool_terminal" },
  finalizeEngineIds: ["selector-risk-filter", "selector-submission-builder"],
  summarize: summarizeSelectorOutput,
  initialState(ctx) {
    const selectionInstructions = ctx.input.selectionInstructions;
    if (
      typeof selectionInstructions !== "string" ||
      selectionInstructions.length === 0
    ) {
      throw new AppError(
        "Selector phase input requires selectionInstructions.",
        "VALIDATION_FAILED",
      );
    }
    return {
      selectionInstructions,
      discoveryWorkerIds: [],
      candidatesForVerification: [],
      verifiedCandidates: [],
    };
  },
  stages: [
    {
      id: "discovery",
      frontier: 0,
      resolveWorkers(ctx) {
        const ids =
          requirePipelineDescriptor(ctx.pipelineId).phaseWorkers.selector ?? [];
        return [...resolveWorkersByIds(ids)];
      },
      buildTask(ctx) {
        return {
          selectionInstructions: ctx.input.selectionInstructions,
          instrumentClasses: ctx.instrumentClasses,
          processingMode: ctx.strategyContext.researchPosture.processingMode,
          failureHistory: ctx.input.failureHistory ?? [],
          nextEligibleRetryAt: ctx.input.nextEligibleRetryAt ?? null,
        };
      },
      concurrency: 3,
      toleratePartialFailure: true,
      minSuccessfulWorkers: 1,
      applyResults(_ctx, state, results) {
        // applyResults is stage-local — direct utility calls are fine here.
        const merged = applyDiscoveryResults(results);
        const prelim = scoreSelectorCandidates(merged);
        return {
          ...state,
          discoveryWorkerIds: results.map(({ worker }) => worker.id),
          candidatesForVerification: prelim.slice(0, 5),
        };
      },
    },
    {
      id: "verification",
      frontier: 1,
      resolveWorkers(_ctx, state) {
        return state.candidatesForVerification.flatMap((candidate) =>
          verificationWorkers(candidate),
        );
      },
      buildTask(_ctx, state, worker) {
        const identity = parseVerificationWorkerIdentity(worker.id);
        const candidate = state.candidatesForVerification.find(
          (row) => candidateIdentityKey(row) === identity,
        );
        return {
          selectionInstructions: state.selectionInstructions,
          candidate: {
            symbol: candidate?.symbol,
            instrumentClass: candidate?.instrumentClass,
            instrumentDisplayName: candidate?.instrumentDisplayName,
            predictionOutcome: candidate?.predictionOutcome,
            rationale: candidate?.rationale,
          },
          failureHistory: (
            (_ctx.input.failureHistory as FailureHistoryEntry[] | undefined) ??
            []
          ).filter((entry) => entry.instrumentSymbol === candidate?.symbol),
          nextEligibleRetryAt: _ctx.input.nextEligibleRetryAt ?? null,
        };
      },
      concurrency: 4,
      toleratePartialFailure: true,
      minSuccessfulWorkers: 1,
      applyResults(_ctx, state, results) {
        const verified = applyVerificationResults(
          state.candidatesForVerification,
          results as Array<{
            worker: WorkerDefinition;
            result: LLMRunResult<VerificationOutput>;
          }>,
        );
        return {
          ...state,
          verifiedCandidates: scoreSelectorCandidates(verified),
        };
      },
    },
  ],
  filterOutput(output, ctx) {
    return {
      ...output,
      instruments: output.instruments
        .filter((row) => ctx.instrumentClasses.includes(row.instrumentClass))
        .slice(0, ctx.strategyContext.riskConfig.maxConcurrentTrades),
    };
  },
};
