import type { InstrumentSelection } from "@/lib/schemas";
import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { DEFAULT_SCORING_WEIGHTS, ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import { AppError } from "@electron/shared/infra/errors";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/instruments/search-providers";
import { z } from "zod";
import type { LLMRunResult } from "../../llm/llm-types";
import {
  mergeDiscoveryCandidates,
  type SelectorCandidate,
} from "../../signal/scoring/selector-candidate-merger";
import { scoreCandidate } from "../../signal/scoring/selector-scoring-engine";
import type { AIPhase } from "../phases/types";
import {
  SELECTOR_WORKERS_CATALYST_EXTRACTOR_PROMPT,
  SELECTOR_WORKERS_EVENT_PREDICTION_SCOUT_PROMPT,
  SELECTOR_WORKERS_EVENT_WEB_SCOUT_PROMPT,
  SELECTOR_WORKERS_LIQUIDITY_GATE_PROMPT,
  SELECTOR_WORKERS_MARKET_VALIDATOR_PROMPT,
  SELECTOR_WORKERS_REDDIT_SCOUT_PROMPT,
  SELECTOR_WORKERS_TREND_SCOUT_PROMPT,
  SELECTOR_WORKERS_WEB_SCOUT_PROMPT,
} from "../worker-prompts";
import { candidateOutputSchema, verificationOutputSchema } from "./selector.schemas";

type DiscoveryOutput = z.infer<typeof candidateOutputSchema>;
type VerificationOutput = z.infer<typeof verificationOutputSchema>;

export type SelectorPhaseInput = {
  selectionInstructions?: string;
};

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

export function selectorDiscoveryWorkersForMode(
  discoveryMode: string,
): readonly WorkerDefinition[] {
  return discoveryMode === "event_contract_scan"
    ? EVENT_SELECTOR_DISCOVERY
    : STANDARD_SELECTOR_DISCOVERY;
}

function verificationWorkers(candidate: SelectorCandidate): WorkerDefinition[] {
  return [
    {
      id: `market-validator:${candidate.symbol}`,
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
      id: `catalyst-extractor:${candidate.symbol}`,
      prompt: SELECTOR_WORKERS_CATALYST_EXTRACTOR_PROMPT,
      tools: ["get_news", "search_web", "fetch_url"],
      toolConfig: SEARCH_WEB_TOOL_CONFIG,
      toolRequirements: {
        requiredAny: ["get_news", "search_web", "fetch_url"],
        minToolCalls: 1,
      },
      strategyContext: CATALYST_EXTRACTOR_STRATEGY_CONTEXT,
      outputMode: "tool_result",
      outputSchema: verificationOutputSchema,
    },
    {
      id: `liquidity-gate:${candidate.symbol}`,
      prompt: SELECTOR_WORKERS_LIQUIDITY_GATE_PROMPT,
      tools: ["get_quote", "get_ohlcv"],
      toolRequirements: { requiredAll: ["get_quote"], minToolCalls: 1 },
      strategyContext: LIQUIDITY_GATE_STRATEGY_CONTEXT,
      outputMode: "tool_result",
      outputSchema: verificationOutputSchema,
    },
  ];
}

export const SELECTOR_PHASE: AIPhase<SelectorPlanState, InstrumentSelection> = {
  phase: "selector",
  cacheEngineId: "selector-instrument-cache",
  inputEngineIds: [
    "selector-scope",
    "broker-coverage",
    "prediction-market-candidates",
  ],
  entryEngineIds: ["manual-shortlist"],
  finalizeEngineIds: ["selector-risk-filter", "selector-submission-builder"],
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
        return [
          ...selectorDiscoveryWorkersForMode(
            ctx.strategyContext.researchPosture.discoveryMode,
          ),
        ];
      },
      buildTask(ctx) {
        return {
          selectionInstructions: ctx.input.selectionInstructions,
          instrumentClasses: ctx.instrumentClasses,
          discoveryMode: ctx.strategyContext.researchPosture.discoveryMode,
        };
      },
      concurrency: 3,
      toleratePartialFailure: true,
      minSuccessfulWorkers: 1,
      applyResults(_ctx, state, results) {
        const merged = mergeDiscoveryCandidates(
          results.map(({ worker, result }) =>
            (result.output as DiscoveryOutput).candidates.map(
              (candidate): SelectorCandidate => ({
                ...candidate,
                finalScore: null,
                source: [...candidate.source, worker.id],
                selectorEvidence: null,
                selectorTraces: parseWorkerToolTrace(
                  result.message.tool_calls_json,
                ),
              }),
            ),
          ),
        );
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
        const symbol = worker.id.split(":")[1] ?? "";
        const candidate = state.candidatesForVerification.find(
          (row) => row.symbol === symbol,
        );
        return {
          selectionInstructions: state.selectionInstructions,
          candidate: {
            symbol: candidate?.symbol,
            instrumentClass: candidate?.instrumentClass,
            instrumentDisplayName: candidate?.instrumentDisplayName,
            rationale: candidate?.rationale,
          },
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

function applyVerificationResults(
  candidates: SelectorCandidate[],
  results: Array<{
    worker: WorkerDefinition;
    result: LLMRunResult<VerificationOutput>;
  }>,
): SelectorCandidate[] {
  const merged = new Map(
    candidates.map((c) => [`${c.instrumentClass}:${c.symbol}`, { ...c }]),
  );
  for (const { worker, result } of results) {
    const key = `${result.output.candidate.instrumentClass}:${result.output.candidate.symbol}`;
    const candidate = merged.get(key);
    if (!candidate) continue;
    candidate.instrumentDisplayName =
      candidate.instrumentDisplayName ??
      result.output.candidate.instrumentDisplayName ??
      null;
    candidate.volumeScore = maxNullable(
      candidate.volumeScore,
      result.output.candidate.volumeScore ?? null,
    );
    candidate.liquidityScore = maxNullable(
      candidate.liquidityScore,
      result.output.candidate.liquidityScore ?? null,
    );
    candidate.catalystScore = maxNullable(
      candidate.catalystScore,
      result.output.candidate.catalystScore ?? null,
    );
    candidate.catalystSummary =
      candidate.catalystSummary ??
      result.output.candidate.catalystSummary ??
      null;
    candidate.rationale =
      candidate.rationale ?? result.output.candidate.rationale ?? null;
    candidate.selectorTraces.push(
      ...parseWorkerToolTrace(result.message.tool_calls_json),
    );
    const baseWorkerId = worker.id.split(":")[0] ?? worker.id;
    if (!candidate.source.includes(baseWorkerId)) {
      candidate.source.push(baseWorkerId);
    }
  }
  return [...merged.values()];
}

function parseWorkerToolTrace(
  raw: string | null,
): SelectorCandidate["selectorTraces"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{
      step: number;
      toolCalls?: Array<{
        step: number;
        tool: string;
        argsJson: string;
        resultJson: string;
      }>;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((step) => ({
      step: step.step,
      toolCalls: step.toolCalls ?? [],
    }));
  } catch {
    return [];
  }
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function scoreSelectorCandidates(
  candidates: SelectorCandidate[],
): SelectorCandidate[] {
  return candidates
    .map((c) => ({
      ...c,
      finalScore: scoreCandidate(c, DEFAULT_SCORING_WEIGHTS),
    }))
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
}
