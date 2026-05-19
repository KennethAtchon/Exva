import { z } from "zod";
import type { PipelineDefinition, WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import type { InstrumentSelection } from "@/lib/schemas";
import { candidateSchema, selectorEvidenceSchema, type SelectorEvidence } from "@electron/shared/ai/selector-pipeline-candidate";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import type { PipelineRunContext, PipelineWorkerRunner } from "../core/types";
import type { ToolBuildContext } from "../context/tool-factory-registry";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { assembleAggregateTrace } from "../execution/trace-assembler";
import { mergeCandidates, type WorkingCandidate } from "../../engines/selector-candidate-merger";
import { DEFAULT_SCORING_WEIGHTS } from "@electron/shared/ai/pipeline-config";
import { scoreCandidate } from "../../engines/selector-scoring-engine";
import { RiskFilter } from "../../engines/selector-risk-filter";
import { buildInstrumentSelection } from "../../engines/selector-submission-builder";
import { AppError } from "@electron/shared/infra/errors";

export type SelectorPhaseInput = {
  selectionInstructions: string;
};

const candidateOutputSchema = z.object({
  candidates: z.array(candidateSchema.pick({
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
  })).max(6),
});

const verificationOutputSchema = z.object({
  candidate: candidateSchema.partial().extend({
    symbol: z.string().min(1),
    instrumentClass: candidateSchema.shape.instrumentClass,
  }),
});

type DiscoveryOutput = z.infer<typeof candidateOutputSchema>;
type VerificationOutput = z.infer<typeof verificationOutputSchema>;

import { selectorDiscoveryWorkersForMode } from "../pipeline-discovery-config";

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

export const SELECTOR_PHASE: PipelineDefinition<SelectorPhaseInput, InstrumentSelection> = {
  phase: "selector",
  outputMode: "tool_terminal",
  workers: selectorDiscoveryWorkersForMode("trend_scan"),
  persistence: {
    outputSchemaName: "instrumentSelection",
    traceMode: "aggregate_workers",
  },

  run: async (rawCtx, rawRunner): Promise<AgentResult<InstrumentSelection>> => {
    const ctx = rawCtx as PipelineRunContext<SelectorPhaseInput>;
    const runner = rawRunner as PipelineWorkerRunner;
    const { sessionId, cycleId, tradeId, input } = ctx;
    const toolCtx = ctx.toolContext as ToolBuildContext;
    const stratCtx = ctx.strategyContext as SessionStrategyContext;

    // Stage 1: Discovery — run all scouts concurrently, tolerate partial failure
    const discoveryWorkers = selectorDiscoveryWorkersForMode(stratCtx.researchPosture.discoveryMode);
    const discoverySettled = await runner.executeGroup(
      discoveryWorkers.map((worker) => () =>
        runner.execute<DiscoveryOutput>(worker, {
          selectionInstructions: input.selectionInstructions,
          instrumentClasses: toolCtx.instrumentClasses,
          discoveryMode: stratCtx.researchPosture.discoveryMode,
        }).then((result) => ({ worker, result })),
      ),
      3,
    );

    const discoveryResults = discoverySettled
      .filter(
        (e): e is PromiseFulfilledResult<{ worker: WorkerDefinition; result: AgentResult<DiscoveryOutput> }> =>
          e.status === "fulfilled",
      )
      .map((e) => e.value);

    if (discoveryResults.length === 0) {
      throw new AppError("Selector discovery workers produced no successful results.", "VALIDATION_FAILED");
    }

    const merged = mergeCandidates(
      discoveryResults.map(({ worker, result }) =>
        result.output.candidates.map((candidate): WorkingCandidate => ({
          ...candidate,
          finalScore: null,
          source: [...candidate.source, worker.id],
          selectorEvidence: null,
          selectorTraces: parseWorkerToolTrace(result.message.tool_calls_json),
        })),
      ),
    );

    const prelim = scoreWorkingCandidates(merged);
    const candidatesForVerification = prelim.slice(0, 5);

    // Stage 2: Verification — enrich top candidates in parallel, tolerate partial failure
    const verificationTasks = candidatesForVerification.flatMap((candidate) =>
      verificationWorkers(candidate).map((worker) => () =>
        runner.execute<VerificationOutput>(worker, {
          selectionInstructions: input.selectionInstructions,
          candidate: {
            symbol: candidate.symbol,
            instrumentClass: candidate.instrumentClass,
            instrumentDisplayName: candidate.instrumentDisplayName,
            rationale: candidate.rationale,
          },
        }).then((result) => ({ worker, result })),
      ),
    );

    const verificationSettled = await runner.executeGroup(verificationTasks, 4);
    const verificationResults = verificationSettled
      .filter(
        (e): e is PromiseFulfilledResult<{ worker: WorkerDefinition; result: AgentResult<VerificationOutput> }> =>
          e.status === "fulfilled",
      )
      .map((e) => e.value);

    // Stage 3: Merge verification data, rescore, filter, build output
    const verified = applyVerificationResults(candidatesForVerification, verificationResults);
    const rescored = scoreWorkingCandidates(verified);
    const filtered = new RiskFilter({
      sessionId,
      instrumentClasses: toolCtx.instrumentClasses,
      strategyContext: stratCtx,
      brokerRouting: toolCtx.brokerRouting,
    }).filter(rescored);

    const output = buildInstrumentSelection(
      filtered.map((candidate) => ({
        ...candidate,
        selectorEvidence: buildSelectorEvidence(candidate),
      })),
      stratCtx.riskConfig.maxConcurrentTrades,
    );

    const aggregate = assembleAggregateTrace({
      phase: "selector",
      sessionId,
      tradeId,
      cycleId,
      providerKey: discoveryResults[0]?.result.run.provider_key ?? "unknown",
      modelId: discoveryResults[0]?.result.run.model ?? "unknown",
      strategyContext: stratCtx,
      schedulingMode: "dependency_graph",
      maxConcurrency: 4,
      output,
      outputSchemaName: "instrumentSelection",
      workers: [
        ...discoveryResults.map(({ worker, result }) => ({
          workerId: worker.id,
          frontier: 0,
          dependsOn: [],
          requiredForPhase: true,
          run: result.run,
          message: result.message,
        })),
        ...verificationResults.map(({ worker, result }) => ({
          workerId: worker.id,
          frontier: 1,
          dependsOn: discoveryWorkers.map((w) => w.id),
          requiredForPhase: false,
          run: result.run,
          message: result.message,
        })),
      ],
    });

    return { run: aggregate.run, message: aggregate.message, output };
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
