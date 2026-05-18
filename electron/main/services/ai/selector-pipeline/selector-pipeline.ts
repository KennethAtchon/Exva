import { z } from "zod";
import type { InstrumentSelection } from "@/lib/schemas";
import { candidateSchema, type Candidate } from "@electron/shared/ai/selector-pipeline-candidate";
import type { PipelinePhase, WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import type { AgentResult } from "../ai-runtime/ai-runtime-types";
import type { ProviderRegistry } from "../provider-registry";
import type { PromptAssetLoader } from "../prompt-asset-loader";
import type { ToolBuildContext } from "../pipeline-runtime/context/tool-factory-registry";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { PhaseConfigResolver } from "../pipeline-runtime/phase-config-resolver";
import { executeWorker, type WorkerExecutorDeps } from "../pipeline-runtime/execution/worker-executor";
import { assembleAggregateTrace } from "../pipeline-runtime/execution/trace-assembler";
import { mergeCandidates, type WorkingCandidate } from "./candidate-merger";
import { DEFAULT_SCORING_WEIGHTS, scoreCandidate } from "./scoring-engine";
import { RiskFilter } from "./risk-filter";
import { buildInstrumentSelection } from "./submission-builder";
import { runWorkerGroup } from "./worker-group-runner";
import { AppError } from "@electron/shared/infra/errors";

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

const DISCOVERY_WORKERS: WorkerDefinition[] = [
  { id: "web-scout", promptAssetPath: "selector-workers/web-scout", tools: ["search_web", "fetch_url"], outputMode: "object", outputSchema: candidateOutputSchema },
  { id: "reddit-scout", promptAssetPath: "selector-workers/reddit-scout", tools: ["search_reddit"], outputMode: "object", outputSchema: candidateOutputSchema },
  { id: "trend-scout", promptAssetPath: "selector-workers/trend-scout", tools: ["get_trending_symbols", "search_web"], outputMode: "object", outputSchema: candidateOutputSchema },
];

function verificationWorkers(candidate: WorkingCandidate): WorkerDefinition[] {
  return [
    { id: `market-validator:${candidate.symbol}`, promptAssetPath: "selector-workers/market-validator", tools: ["get_quote", "get_ohlcv"], outputMode: "object", outputSchema: verificationOutputSchema },
    { id: `catalyst-extractor:${candidate.symbol}`, promptAssetPath: "selector-workers/catalyst-extractor", tools: ["get_news", "fetch_url"], outputMode: "object", outputSchema: verificationOutputSchema },
    { id: `liquidity-gate:${candidate.symbol}`, promptAssetPath: "selector-workers/liquidity-gate", tools: ["get_quote", "get_ohlcv"], outputMode: "object", outputSchema: verificationOutputSchema },
  ];
}

export interface SelectorPipelineDeps {
  providerRegistry: ProviderRegistry;
  phaseConfigResolver: PhaseConfigResolver;
  promptLoader: PromptAssetLoader;
}

export class SelectorPipeline {
  constructor(private readonly deps: SelectorPipelineDeps) {}

  async run(input: {
    sessionId: string;
    cycleId: string | null;
    tradeId: string | null;
    selectionInstructions: string;
    toolContext: ToolBuildContext;
    strategyContext: SessionStrategyContext;
  }): Promise<AgentResult<InstrumentSelection>> {
    const executorDeps: WorkerExecutorDeps = {
      providerRegistry: this.deps.providerRegistry,
      phaseConfigResolver: this.deps.phaseConfigResolver,
      promptLoader: this.deps.promptLoader,
      toolContext: input.toolContext,
      strategyContext: input.strategyContext,
    };

    const discoverySettled = await runWorkerGroup(
      DISCOVERY_WORKERS.map((worker) => () =>
        executeWorker<DiscoveryOutput>(executorDeps, {
          phase: "selector",
          worker,
          sessionId: input.sessionId,
          cycleId: input.cycleId,
          tradeId: input.tradeId,
          task: {
            selectionInstructions: input.selectionInstructions,
            instrumentClasses: input.toolContext.instrumentClasses,
            discoveryMode: input.strategyContext.researchPosture.discoveryMode,
          },
        }).then((result) => ({ worker, result })),
      ),
      3,
    );

    const discoveryResults = discoverySettled
      .filter((entry): entry is PromiseFulfilledResult<{ worker: WorkerDefinition; result: AgentResult<DiscoveryOutput> }> => entry.status === "fulfilled")
      .map((entry) => entry.value);

    if (discoveryResults.length === 0) {
      throw new AppError("Selector discovery workers produced no successful results.", "VALIDATION_FAILED");
    }

    const merged = mergeCandidates(
      discoveryResults.map(({ worker, result }) =>
        result.output.candidates.map((candidate): WorkingCandidate => ({
          ...candidate,
          finalScore: null,
          source: [...candidate.source, worker.id],
          selectorResearchBrief: candidate.rationale ?? candidate.catalystSummary,
          selectorTraces: parseWorkerToolTrace(result.message.tool_calls_json),
        })),
      ),
    );

    const prelim = scoreWorkingCandidates(merged);
    const candidatesForVerification = prelim.slice(0, 5);
    const verificationTasks = candidatesForVerification.flatMap((candidate) =>
      verificationWorkers(candidate).map((worker) => () =>
        executeWorker<VerificationOutput>(executorDeps, {
          phase: "selector",
          worker,
          sessionId: input.sessionId,
          cycleId: input.cycleId,
          tradeId: input.tradeId,
          task: {
            selectionInstructions: input.selectionInstructions,
            candidate: {
              symbol: candidate.symbol,
              instrumentClass: candidate.instrumentClass,
              instrumentDisplayName: candidate.instrumentDisplayName,
              rationale: candidate.rationale,
            },
          },
        }).then((result) => ({ worker, result })),
      ),
    );

    const verificationSettled = await runWorkerGroup(verificationTasks, 4);
    const verificationResults = verificationSettled
      .filter((entry): entry is PromiseFulfilledResult<{ worker: WorkerDefinition; result: AgentResult<VerificationOutput> }> => entry.status === "fulfilled")
      .map((entry) => entry.value);

    const verified = applyVerificationResults(candidatesForVerification, verificationResults);
    const rescored = scoreWorkingCandidates(verified);
    const filtered = new RiskFilter({
      sessionId: input.sessionId,
      instrumentClasses: input.toolContext.instrumentClasses,
      strategyContext: input.strategyContext,
      brokerRouting: input.toolContext.brokerRouting,
    }).filter(rescored);

    const output = buildInstrumentSelection(filtered, input.strategyContext.riskConfig.maxConcurrentTrades);
    const phaseConfig = this.deps.phaseConfigResolver.resolvePhaseConfig(input.sessionId, "selector");

    const aggregate = assembleAggregateTrace({
      phase: "selector",
      sessionId: input.sessionId,
      tradeId: input.tradeId,
      cycleId: input.cycleId,
      providerKey: phaseConfig.providerKey || discoveryResults[0]?.result.run.provider_key || "unknown",
      modelId: phaseConfig.modelId || discoveryResults[0]?.result.run.model || "unknown",
      strategyContext: input.strategyContext,
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
          dependsOn: DISCOVERY_WORKERS.map((worker) => worker.id),
          requiredForPhase: false,
          run: result.run,
          message: result.message,
        })),
      ],
    });

    return { run: aggregate.run, message: aggregate.message, output };
  }
}

function applyVerificationResults(
  candidates: WorkingCandidate[],
  results: Array<{ worker: WorkerDefinition; result: AgentResult<VerificationOutput> }>,
): WorkingCandidate[] {
  const merged = new Map(candidates.map((candidate) => [`${candidate.instrumentClass}:${candidate.symbol}`, { ...candidate }]));
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
    candidate.selectorResearchBrief = candidate.selectorResearchBrief ?? result.output.candidate.rationale ?? result.output.candidate.catalystSummary ?? null;
    candidate.selectorTraces.push(...parseWorkerToolTrace(result.message.tool_calls_json));
    if (!candidate.source.includes(worker.id.split(":")[0] ?? worker.id)) {
      candidate.source.push(worker.id.split(":")[0] ?? worker.id);
    }
  }
  return [...merged.values()];
}

function parseWorkerToolTrace(raw: string | null): WorkingCandidate["selectorTraces"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ step: number; toolCalls?: Array<{ step: number; tool: string; argsJson: string; resultJson: string }> }>;
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
    .map((candidate) => ({ ...candidate, finalScore: scoreCandidate(candidate as Candidate, DEFAULT_SCORING_WEIGHTS) }))
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
}
