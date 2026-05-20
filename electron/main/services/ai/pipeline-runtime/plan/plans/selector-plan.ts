import { z } from "zod";
import type { WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import type { InstrumentSelection } from "@/lib/schemas";
import { selectorEvidenceSchema, type SelectorEvidence } from "@electron/shared/ai/selector-pipeline-candidate";
import { candidateOutputSchema, verificationOutputSchema } from "./selector-schemas";
import { DEFAULT_SCORING_WEIGHTS } from "@electron/shared/ai/pipeline-config";
import { AppError } from "@electron/shared/infra/errors";
import type { AgentResult } from "../../../ai-runtime/ai-runtime-types";
import { mergeCandidates, type WorkingCandidate } from "../../../engines/selector/selector-candidate-merger";
import { scoreCandidate } from "../../../engines/selector/selector-scoring-engine";
import { RiskFilter } from "../../../engines/selector/selector-risk-filter";
import { buildInstrumentSelection } from "../../../engines/selector/selector-submission-builder";
import { selectorDiscoveryWorkersForMode } from "../../pipeline-discovery-config";
import { assembleAggregateTrace } from "../../execution/trace-assembler";
import type { PhasePlan, PhasePlanRunContext, PhasePlanWorkerTrace } from "../types";
import { buildManualShortlistSelection, isManualSelectorMode } from "../input-builders/manual-shortlist";

type DiscoveryOutput = z.infer<typeof candidateOutputSchema>;
type VerificationOutput = z.infer<typeof verificationOutputSchema>;

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
      promptAssetPath: "selector-workers/market-validator",
      tools: ["get_quote", "get_ohlcv"],
      outputMode: "object",
      outputSchema: verificationOutputSchema,
    },
    {
      id: `catalyst-extractor:${candidate.symbol}`,
      promptAssetPath: "selector-workers/catalyst-extractor",
      tools: ["get_news", "fetch_url"],
      outputMode: "object",
      outputSchema: verificationOutputSchema,
    },
    {
      id: `liquidity-gate:${candidate.symbol}`,
      promptAssetPath: "selector-workers/liquidity-gate",
      tools: ["get_quote", "get_ohlcv"],
      outputMode: "object",
      outputSchema: verificationOutputSchema,
    },
  ];
}

export const SELECTOR_PLAN: PhasePlan<SelectorPlanState, InstrumentSelection> = {
  phase: "selector",
  cachePolicyId: "selector-instrument-cache",
  inputBuilderIds: ["selector-scope", "broker-coverage", "prediction-market-candidates"],
  entryModes: [
    {
      id: "manual_shortlist",
      matches: isManualSelectorMode,
      resolveOutput(ctx) {
        return buildManualShortlistSelection(ctx.session, ctx.strategyContext.riskConfig.maxConcurrentTrades);
      },
    },
  ],
  initialState(ctx) {
    const selectionInstructions = ctx.input.selectionInstructions;
    if (typeof selectionInstructions !== "string" || selectionInstructions.length === 0) {
      throw new AppError("Selector phase input requires selectionInstructions.", "VALIDATION_FAILED");
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
        return [...selectorDiscoveryWorkersForMode(ctx.strategyContext.researchPosture.discoveryMode)];
      },
      buildTask(ctx, _state, _worker) {
        return {
          selectionInstructions: ctx.input.selectionInstructions,
          instrumentClasses: ctx.toolContext.instrumentClasses,
          discoveryMode: ctx.strategyContext.researchPosture.discoveryMode,
        };
      },
      concurrency: 3,
      toleratePartialFailure: true,
      minSuccessfulWorkers: 1,
      applyResults(ctx, state, results) {
        const merged = mergeCandidates(
          results.map(({ worker, result }) =>
            (result.output as DiscoveryOutput).candidates.map((candidate): WorkingCandidate => ({
              ...candidate,
              finalScore: null,
              source: [...candidate.source, worker.id],
              selectorEvidence: null,
              selectorTraces: parseWorkerToolTrace(result.message.tool_calls_json),
            })),
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
        return state.candidatesForVerification.flatMap((candidate) => verificationWorkers(candidate));
      },
      buildTask(ctx, state, worker) {
        const symbol = worker.id.split(":")[1] ?? "";
        const candidate = state.candidatesForVerification.find((row) => row.symbol === symbol);
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
      applyResults(_ctx, state, results) {
        const verified = applyVerificationResults(state.candidatesForVerification, results as Array<{
          worker: WorkerDefinition;
          result: AgentResult<VerificationOutput>;
        }>);
        return {
          ...state,
          verifiedCandidates: scoreWorkingCandidates(verified),
        };
      },
    },
  ],
  async finalize(ctx, state, workerTraces) {
    const filtered = new RiskFilter({
      sessionId: ctx.sessionId,
      instrumentClasses: ctx.toolContext.instrumentClasses,
      strategyContext: ctx.strategyContext,
      brokerRouting: ctx.toolContext.brokerRouting,
    }).filter(state.verifiedCandidates);

    const output = buildInstrumentSelection(
      filtered.map((candidate) => ({
        ...candidate,
        selectorEvidence: buildSelectorEvidence(candidate),
      })),
      ctx.strategyContext.riskConfig.maxConcurrentTrades,
    );

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
      workers: workerTraces,
    });

    return { output, aggregate: { run: aggregate.run, message: aggregate.message } };
  },
  filterOutput(output, ctx) {
    return {
      instruments: output.instruments
        .filter((row) => ctx.instrumentClasses.includes(row.instrumentClass))
        .slice(0, ctx.strategyContext.riskConfig.maxConcurrentTrades),
    };
  },
  inspect: {
    inputBuilderIds: ["selector-scope", "broker-coverage", "prediction-market-candidates"],
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
  results: Array<{ worker: WorkerDefinition; result: AgentResult<VerificationOutput> }>,
): WorkingCandidate[] {
  const merged = new Map(candidates.map((c) => [`${c.instrumentClass}:${c.symbol}`, { ...c }]));
  for (const { worker, result } of results) {
    const key = `${result.output.candidate.instrumentClass}:${result.output.candidate.symbol}`;
    const candidate = merged.get(key);
    if (!candidate) continue;
    candidate.instrumentDisplayName = candidate.instrumentDisplayName ?? result.output.candidate.instrumentDisplayName ?? null;
    candidate.volumeScore = maxNullable(candidate.volumeScore, result.output.candidate.volumeScore ?? null);
    candidate.liquidityScore = maxNullable(candidate.liquidityScore, result.output.candidate.liquidityScore ?? null);
    candidate.catalystScore = maxNullable(candidate.catalystScore, result.output.candidate.catalystScore ?? null);
    candidate.catalystSummary = candidate.catalystSummary ?? result.output.candidate.catalystSummary ?? null;
    candidate.rationale = candidate.rationale ?? result.output.candidate.rationale ?? null;
    candidate.selectorTraces.push(...parseWorkerToolTrace(result.message.tool_calls_json));
    const baseWorkerId = worker.id.split(":")[0] ?? worker.id;
    if (!candidate.source.includes(baseWorkerId)) {
      candidate.source.push(baseWorkerId);
    }
  }
  return [...merged.values()];
}

function parseWorkerToolTrace(raw: string | null): WorkingCandidate["selectorTraces"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{
      step: number;
      toolCalls?: Array<{ step: number; tool: string; argsJson: string; resultJson: string }>;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((step) => ({ step: step.step, toolCalls: step.toolCalls ?? [] }));
  } catch {
    return [];
  }
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function scoreWorkingCandidates(candidates: WorkingCandidate[]): WorkingCandidate[] {
  return candidates
    .map((c) => ({ ...c, finalScore: scoreCandidate(c, DEFAULT_SCORING_WEIGHTS) }))
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
}

function buildSelectorEvidence(candidate: WorkingCandidate): SelectorEvidence {
  const summary = candidate.rationale ?? candidate.catalystSummary ?? null;
  const toolNames = new Set(
    candidate.selectorTraces.flatMap((step) => step.toolCalls.map((call) => call.tool)),
  );
  return selectorEvidenceSchema.parse({
    summary,
    thesisDirection: inferThesisDirection(summary),
    sourceWorkers: candidate.source,
    riskFlags: candidate.riskFlags,
    hasQuoteEvidence: toolNames.has("get_quote"),
    hasNewsEvidence: toolNames.has("get_news"),
    hasSearchEvidence: toolNames.has("search_web") || toolNames.has("search_reddit"),
    hasOhlcvEvidence: toolNames.has("get_ohlcv"),
    hasFetchEvidence: toolNames.has("fetch_url"),
  });
}

function inferThesisDirection(summary: string | null): SelectorEvidence["thesisDirection"] {
  if (!summary) return "neutral";
  const text = summary.toLowerCase();
  if (/bearish|downtrend|selloff|breakdown|short setup/.test(text)) return "short";
  if (/bullish|uptrend|breakout|long setup|momentum/.test(text)) return "long";
  return "neutral";
}
