import {
  SELECTOR_WORKERS_CATALYST_EXTRACTOR_PROMPT,
  SELECTOR_WORKERS_LIQUIDITY_GATE_PROMPT,
  SELECTOR_WORKERS_MARKET_VALIDATOR_PROMPT,
} from "../../worker-prompts";
import { z } from "zod";
import type { WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import type { InstrumentSelection } from "@/lib/schemas";
import {
  selectorEvidenceSchema,
  type SelectorEvidence,
} from "@electron/shared/ai/selector-pipeline-candidate";
import { candidateOutputSchema, verificationOutputSchema } from "./schemas";
import { DEFAULT_SCORING_WEIGHTS } from "@electron/shared/ai/pipeline-config";
import { AppError } from "@electron/shared/infra/errors";
import type { AgentResult } from "../../../llm/ai-runtime-types";
import {
  mergeCandidates,
  type WorkingCandidate,
} from "../../../signal/scoring/selector-candidate-merger";
import { scoreCandidate } from "../../../signal/scoring/selector-scoring-engine";
import { RiskFilter } from "../../../signal/scoring/selector-risk-filter";
import { buildInstrumentSelection } from "../../../signal/scoring/selector-submission-builder";
import { selectorDiscoveryWorkersForMode } from "../../pipeline-discovery-config";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/instruments/search-providers";
import { assembleAggregateTrace } from "../../execution/trace-assembler";
import { summarizeWorkerToolCoverage } from "../../execution/worker-tool-requirements";
import type { PhasePlan, PhasePlanWorkerTrace } from "../../phases/types";
import {
  buildManualShortlistSelection,
  isManualSelectorMode,
} from "../inputs/manual-shortlist";

type DiscoveryOutput = z.infer<typeof candidateOutputSchema>;
type VerificationOutput = z.infer<typeof verificationOutputSchema>;

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

export type SelectorPlanState = {
  selectionInstructions: string;
  discoveryWorkerIds: string[];
  candidatesForVerification: WorkingCandidate[];
  verifiedCandidates: WorkingCandidate[];
};

function verificationWorkers(candidate: WorkingCandidate): WorkerDefinition[] {
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
      toolConfig: {
        search_web: { fallbackProviderId: BUILT_IN_DUCKDUCKGO_PROVIDER_ID },
      },
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

export const SELECTOR_PLAN: PhasePlan<SelectorPlanState, InstrumentSelection> =
  {
    phase: "selector",
    cachePolicyId: "selector-instrument-cache",
    inputBuilderIds: [
      "selector-scope",
      "broker-coverage",
      "prediction-market-candidates",
    ],
    entryModes: [
      {
        id: "manual_shortlist",
        matches: isManualSelectorMode,
        resolveOutput(ctx) {
          return buildManualShortlistSelection(
            ctx.session,
            ctx.strategyContext.riskConfig.maxConcurrentTrades,
          );
        },
      },
    ],
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
        applyResults(ctx, state, results) {
          const merged = mergeCandidates(
            results.map(({ worker, result }) =>
              (result.output as DiscoveryOutput).candidates.map(
                (candidate): WorkingCandidate => ({
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
          const prelim = scoreWorkingCandidates(merged);
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
        buildTask(ctx, state, worker) {
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
              result: AgentResult<VerificationOutput>;
            }>,
          );
          return {
            ...state,
            verifiedCandidates: scoreWorkingCandidates(verified),
          };
        },
      },
    ],
    async finalize(ctx, state, workerTraces) {
      const withEvidence = state.verifiedCandidates.map((candidate) => ({
        ...candidate,
        selectorEvidence: buildSelectorEvidence(candidate),
      }));
      const evaluation = new RiskFilter({
        sessionId: ctx.sessionId,
        instrumentClasses: ctx.instrumentClasses,
        strategyContext: ctx.strategyContext,
        brokerRouting: ctx.toolContext.brokerRouting,
      }).evaluate(withEvidence);

      const output = {
        ...buildInstrumentSelection(
          evaluation.accepted,
          ctx.strategyContext.riskConfig.maxConcurrentTrades,
        ),
        diagnostics: {
          discoveredCount: state.candidatesForVerification.length,
          verifiedCount: state.verifiedCandidates.length,
          acceptedCount: evaluation.accepted.length,
          rejected: evaluation.rejected,
          workerToolCoverage: buildWorkerToolCoverage(workerTraces),
        },
      };

      const discoveryTrace = workerTraces.find((trace) => trace.frontier === 0);
      const aggregate = assembleAggregateTrace({
        phase: "selector",
        sessionId: ctx.sessionId,
        tradeId: ctx.tradeId,
        cycleId: ctx.cycleId,
        providerKey: discoveryTrace?.run.provider_key ?? "unknown",
        modelId: discoveryTrace?.run.model ?? "unknown",
        strategyContext: ctx.strategyContext,
        schedulingMode: "dependency_graph",
        maxConcurrency: 4,
        output,
        outputSchemaName: "instrumentSelection",
        marketSnapshotJson: JSON.stringify(output.diagnostics),
        workers: workerTraces,
      });

      return {
        output,
        aggregate: { run: aggregate.run, message: aggregate.message },
      };
    },
    filterOutput(output, ctx) {
      return {
        ...output,
        instruments: output.instruments
          .filter((row) => ctx.instrumentClasses.includes(row.instrumentClass))
          .slice(0, ctx.strategyContext.riskConfig.maxConcurrentTrades),
      };
    },
    inspect: {
      inputBuilderIds: [
        "selector-scope",
        "broker-coverage",
        "prediction-market-candidates",
      ],
      cachePolicyId: "selector-instrument-cache",
      stageIds: ["discovery", "verification"],
      finalizerEngineIds: [
        "selector-candidate-merger",
        "selector-scoring-engine",
        "selector-risk-filter",
        "selector-submission-builder",
      ],
    },
  };

function applyVerificationResults(
  candidates: WorkingCandidate[],
  results: Array<{
    worker: WorkerDefinition;
    result: AgentResult<VerificationOutput>;
  }>,
): WorkingCandidate[] {
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
): WorkingCandidate["selectorTraces"] {
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

function scoreWorkingCandidates(
  candidates: WorkingCandidate[],
): WorkingCandidate[] {
  return candidates
    .map((c) => ({
      ...c,
      finalScore: scoreCandidate(c, DEFAULT_SCORING_WEIGHTS),
    }))
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
}

function buildSelectorEvidence(candidate: WorkingCandidate): SelectorEvidence {
  const summary = candidate.rationale ?? candidate.catalystSummary ?? null;
  const toolNames = new Set(
    candidate.selectorTraces.flatMap((step) =>
      step.toolCalls.map((call) => call.tool),
    ),
  );
  return selectorEvidenceSchema.parse({
    summary,
    thesisDirection: inferThesisDirection(summary),
    sourceWorkers: candidate.source,
    riskFlags: candidate.riskFlags,
    hasQuoteEvidence: toolNames.has("get_quote"),
    hasNewsEvidence: toolNames.has("get_news"),
    hasSearchEvidence:
      toolNames.has("search_web") || toolNames.has("search_reddit"),
    hasOhlcvEvidence: toolNames.has("get_ohlcv"),
    hasFetchEvidence: toolNames.has("fetch_url"),
  });
}

function inferThesisDirection(
  summary: string | null,
): SelectorEvidence["thesisDirection"] {
  if (!summary) return "neutral";
  const text = summary.toLowerCase();
  if (/bearish|downtrend|selloff|breakdown|short setup/.test(text))
    return "short";
  if (/bullish|uptrend|breakout|long setup|momentum/.test(text)) return "long";
  return "neutral";
}

function buildWorkerToolCoverage(workerTraces: PhasePlanWorkerTrace[]) {
  return workerTraces.map((trace) => {
    const usedTools = parseWorkerToolNames(trace.message.tool_calls_json);
    const workerPrefix = trace.workerId.split(":")[0] ?? trace.workerId;
    const requirement = resolveToolRequirementForWorker(workerPrefix);
    return summarizeWorkerToolCoverage(trace.workerId, requirement, usedTools);
  });
}

function parseWorkerToolNames(raw: string | null): string[] {
  const steps = parseWorkerToolTrace(raw);
  return [
    ...new Set(
      steps.flatMap((step) => step.toolCalls.map((call) => call.tool)),
    ),
  ];
}

function resolveToolRequirementForWorker(workerPrefix: string) {
  if (workerPrefix === "market-validator") {
    return {
      requiredAll: ["get_quote", "get_ohlcv"],
      minToolCalls: 2,
    } as const;
  }
  if (workerPrefix === "liquidity-gate") {
    return { requiredAll: ["get_quote"], minToolCalls: 1 } as const;
  }
  if (workerPrefix === "catalyst-extractor") {
    return {
      requiredAny: ["get_news", "search_web", "fetch_url"],
      minToolCalls: 1,
    } as const;
  }
  if (workerPrefix === "web-scout") {
    return { requiredAll: ["search_web"], minToolCalls: 1 } as const;
  }
  if (workerPrefix === "reddit-scout") {
    return { requiredAll: ["search_reddit"], minToolCalls: 1 } as const;
  }
  if (workerPrefix === "trend-scout") {
    return { requiredAll: ["get_trending_symbols"], minToolCalls: 1 } as const;
  }
  return undefined;
}
