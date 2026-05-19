import type { PrepareStepFunction, ToolSet } from "ai";
import { AppError } from "@electron/shared/infra/errors";
import type { PipelinePhase, WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import type { ProviderRegistry } from "../../provider-registry";
import { withProviderRetry } from "../../ai-runtime/runtime-retry";
import { assembleTrace } from "./trace-assembler";
import type { WorkerOutputContract } from "../core/types";
import { resolveStructuredWorkerOutput } from "./worker-structured-output";
import { buildToolSet, type ToolBuildContext } from "../context/tool-factory-registry";
import type { PhaseConfigResolver } from "../phase-config-resolver";
import type { PromptAssetLoader } from "../../prompt-asset-loader";
import { envelopeToMessages, buildPromptEnvelope } from "../prompting/prompt-envelope-builder";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { createLogger } from "../../../infra/log";
import type { PipelineSpendTracker } from "./pipeline-spend-tracker";
import { runReadEngineContext } from "./engine-context-runner";

const logger = createLogger("pipeline-runtime");

function resolveTemperature(modelId: string, configured: number | undefined): number | undefined {
  if (configured == null) return undefined;
  const id = modelId.toLowerCase();
  if (id.includes("/")) return undefined;
  if (id.includes("o1") || id.includes("o3") || id.includes("o4") || id.includes("reasoning")) return undefined;
  return configured;
}

export interface WorkerExecutorDeps {
  providerRegistry: ProviderRegistry;
  phaseConfigResolver: PhaseConfigResolver;
  promptLoader: PromptAssetLoader;
  toolContext: ToolBuildContext;
  strategyContext: SessionStrategyContext;
}

export interface WorkerRunOptions {
  phase: PipelinePhase;
  worker: WorkerDefinition;
  sessionId: string;
  cycleId?: string | null;
  tradeId?: string | null;
  task: Record<string, unknown>;
  terminalToolNames?: readonly string[];
  prepareStep?: PrepareStepFunction<ToolSet>;
  spendTracker?: PipelineSpendTracker;
}

export async function executeWorker<TOutput>(
  deps: WorkerExecutorDeps,
  opts: WorkerRunOptions,
): Promise<AgentResult<TOutput>> {
  const { phase, worker, sessionId, cycleId, tradeId, task, spendTracker } = opts;

  if (spendTracker && !spendTracker.canContinue()) {
    const abortMessage = spendTracker.abortLogMessage();
    if (abortMessage) logger.warn({ sessionId, phase, workerId: worker.id, cycleId: cycleId ?? null }, abortMessage);
    throw new AppError(
      abortMessage ?? "Pipeline spend cap exceeded; worker aborted.",
      "SPEND_CAP_EXCEEDED",
    );
  }

  const workerExecConfig = deps.phaseConfigResolver.resolveWorkerExecConfig(sessionId, phase, worker.id);
  const resolvedConfig = deps.phaseConfigResolver.resolveWorkerRuntimeConfig(phase, worker, workerExecConfig.workerOverride);

  if (!workerExecConfig.providerKey || !workerExecConfig.modelId) {
    throw new AppError(
      `Phase ${phase} has no provider/model configured for session ${sessionId}`,
      "PROVIDER_NOT_CONFIGURED",
    );
  }

  const adapter = await deps.providerRegistry.get(workerExecConfig.providerKey);

  // Resolve prompt
  let promptMarkdown: string;
  if (workerExecConfig.promptSource === "session_override" && workerExecConfig.promptMarkdown.trim()) {
    promptMarkdown = workerExecConfig.promptMarkdown.trim();
  } else {
    promptMarkdown = deps.promptLoader.load(worker.promptAssetPath);
  }

  const engineResults = runReadEngineContext({
    phase,
    sessionId,
    cycleId: cycleId ?? null,
    strategyContext: deps.strategyContext,
    bindings: resolvedConfig.engines,
    task,
  });

  const envelope = buildPromptEnvelope({
    phase,
    workerId: worker.id,
    basePromptMarkdown: promptMarkdown,
    task,
    strategyContext: deps.strategyContext,
    engineResults,
  });

  const messages = envelopeToMessages(envelope, deps.strategyContext);

  const tools = await buildToolSet(
    resolvedConfig.tools,
    deps.toolContext,
    opts.terminalToolNames as string[] | undefined,
    worker.toolConfig,
  );

  logger.info(
    {
      sessionId,
      phase,
      workerId: worker.id,
      cycleId: cycleId ?? null,
      model: workerExecConfig.modelId,
      maxSteps: resolvedConfig.caps.maxSteps,
      toolCount: tools ? Object.keys(tools).length : 0,
    },
    "worker start",
  );

  const runAgent = (abortSignal?: AbortSignal) =>
    withProviderRetry(
      (signal) =>
        adapter.runAgent({
          model: workerExecConfig.modelId,
          messages,
          tools,
          maxSteps: resolvedConfig.caps.maxSteps,
          spendLimitUsd: resolvedConfig.caps.spendLimitUsd,
          temperature: resolveTemperature(workerExecConfig.modelId, workerExecConfig.temperature),
          maxTokens: resolvedConfig.caps.maxTokens ?? workerExecConfig.maxTokens,
          abortSignal: signal,
          schema: worker.outputMode === "object" && worker.outputSchema ? worker.outputSchema : undefined,
          terminalToolNames: opts.terminalToolNames as string[] | undefined,
          prepareStep: opts.prepareStep,
        }),
      {
        providerType: adapter.providerType,
        modelId: workerExecConfig.modelId,
        role: phase,
        sessionId,
        cycleId: cycleId ?? null,
      },
    );

  let trace = await runAgent();
  let output: TOutput;
  let parseFallback = trace.parseFallback;

  if (worker.outputMode === "object" && worker.outputSchema && resolvedConfig.output) {
    const outputContract = resolvedConfig.output as WorkerOutputContract<TOutput>;
    let resolution = resolveStructuredWorkerOutput<TOutput>(outputContract, trace.structuredOutput, false);
    if ("needsRetry" in resolution) {
      logger.warn(
        { sessionId, phase, workerId: worker.id, cycleId: cycleId ?? null },
        "worker structured output validation failed; retrying once",
      );
      trace = await runAgent();
      resolution = resolveStructuredWorkerOutput<TOutput>(outputContract, trace.structuredOutput, true);
    }
    if ("needsRetry" in resolution) {
      throw new AppError(
        `Worker ${worker.id} (phase ${phase}) returned invalid structured output after retry.`,
        "VALIDATION_FAILED",
      );
    }
    output = resolution.output;
    parseFallback = resolution.parseFallback;
    if (resolution.parseFallback) {
      logger.warn(
        { sessionId, phase, workerId: worker.id, cycleId: cycleId ?? null, retried: resolution.retried },
        "worker structured output substituted empty dimension after validation failure",
      );
    }
  } else if (worker.outputMode === "tool_terminal") {
    const terminalResult = resolveTerminalResult(trace);
    if (!terminalResult) {
      throw new AppError(
        `Worker ${worker.id} (phase ${phase}) reached no terminal tool result.`,
        "VALIDATION_FAILED",
      );
    }
    output = terminalResult as TOutput;
  } else {
    output = { text: trace.assistantText } as TOutput;
  }

  const { run, message } = assembleTrace({
    phase,
    workerId: worker.id,
    sessionId,
    tradeId: tradeId ?? null,
    cycleId: cycleId ?? null,
    providerKey: workerExecConfig.providerKey,
    modelId: workerExecConfig.modelId,
    trace,
    outputJson: JSON.stringify(output),
    outputSchemaName: worker.outputMode === "object" ? worker.id : null,
    strategyContext: deps.strategyContext,
    parseFallback,
  });

  logger.info(
    {
      sessionId,
      phase,
      workerId: worker.id,
      cycleId: cycleId ?? null,
      inputTokens: run.input_tokens,
      outputTokens: run.output_tokens,
      durationMs: run.duration_ms,
      costUsd: run.cost_usd,
    },
    "worker complete",
  );

  spendTracker?.record(run.cost_usd);
  if (spendTracker && !spendTracker.canContinue()) {
    const abortMessage = spendTracker.abortLogMessage();
    if (abortMessage) logger.warn({ sessionId, phase, workerId: worker.id, cycleId: cycleId ?? null }, abortMessage);
  }

  return { run, message, output };
}

function resolveTerminalResult(
  trace: {
    assistantText: string;
    steps: Array<{
      toolCalls: Array<{ tool?: string; argsJson?: string; resultJson?: string }>;
    }>;
  },
): unknown {
  for (const step of trace.steps) {
    for (const call of step.toolCalls) {
      if (call.resultJson) {
        try {
          return JSON.parse(call.resultJson);
        } catch {
          return call.resultJson;
        }
      }
    }
  }
  return null;
}
