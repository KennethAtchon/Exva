import type { PrepareStepFunction, ToolSet } from "ai";
import { AppError } from "@electron/shared/infra/errors";
import {
  DEFAULT_OUTPUT_TOOL_NAME,
  type PipelinePhase,
  type WorkerDefinition,
} from "@electron/shared/ai/ai-phase";
import type { LLMRunResult } from "../../llm/llm-types";
import type { ProviderRegistry } from "../../llm/provider-registry";
import { withLLMRetry } from "../../llm/runtime-retry";
import { assembleTrace } from "./trace-assembler";
import type { AIWorkerOutputSchema } from "../core/types";
import { parseWorkerOutput } from "./worker-structured-output";
import {
  buildWorkerTools,
  DEFAULT_SUBMIT_TOOL_DESCRIPTION,
  type SubmitOutputToolSpec,
  type WorkerToolContext,
} from "../worker-tools/worker-tool-factory";
import type { AIPhaseConfigResolver } from "../ai-phase-config-resolver";
import { buildWorkerPrompt } from "../prompting/worker-prompt-builder";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { createLogger } from "../../infra/log";
import type { AISpendTracker } from "./ai-spend-tracker";
import { injectEngineResults } from "./engine-prompt-injector";
import { enforceWorkerToolRequirements, extractToolNamesUsed, summarizeWorkerToolCoverage } from "./worker-tool-requirements";

const logger = createLogger("pipeline-runtime");

function workerNameFromPrompt(markdown: string): string | undefined {
  const line = markdown.split("\n").find((entry) => entry.startsWith("# "));
  return line?.slice(2).trim() || undefined;
}

function workerLogContext(
  opts: Pick<
    AIWorkerRunOptions,
    "phase" | "sessionId" | "cycleId" | "tradeId" | "worker"
  >,
  workerName?: string,
): {
  sessionId: string;
  phase: PipelinePhase;
  workerId: string;
  workerName: string | null;
  cycleId: string | null;
  tradeId: string | null;
} {
  return {
    sessionId: opts.sessionId,
    phase: opts.phase,
    workerId: opts.worker.id,
    workerName: workerName ?? null,
    cycleId: opts.cycleId ?? null,
    tradeId: opts.tradeId ?? null,
  };
}

function resolveTemperature(
  modelId: string,
  configured: number | undefined,
): number | undefined {
  if (configured == null) return undefined;
  const id = modelId.toLowerCase();
  if (id.includes("/")) return undefined;
  if (
    id.includes("o1") ||
    id.includes("o3") ||
    id.includes("o4") ||
    id.includes("reasoning")
  )
    return undefined;
  return configured;
}

export interface AIWorkerRunnerDeps {
  providerRegistry: ProviderRegistry;
  phaseConfigResolver: AIPhaseConfigResolver;
  toolContext: WorkerToolContext;
  strategyContext: SessionStrategyContext;
  sandboxBudget?: boolean;
}

export interface AIWorkerRunOptions {
  phase: PipelinePhase;
  worker: WorkerDefinition;
  sessionId: string;
  cycleId?: string | null;
  tradeId?: string | null;
  task: Record<string, unknown>;
  prepareStep?: PrepareStepFunction<ToolSet>;
  spendTracker?: AISpendTracker;
}

export async function runAIWorker<TOutput>(
  deps: AIWorkerRunnerDeps,
  opts: AIWorkerRunOptions,
): Promise<LLMRunResult<TOutput>> {
  const { phase, worker, sessionId, cycleId, tradeId, task, spendTracker } =
    opts;

  if (spendTracker && !spendTracker.canContinue()) {
    const abortMessage = spendTracker.abortLogMessage();
    if (abortMessage)
      logger.warn(
        {
          ...workerLogContext(opts),
          phaseSpentUsd: spendTracker.phaseSpent,
          pipelineSpentUsd: spendTracker.pipelineSpent,
        },
        abortMessage,
      );
    throw new AppError(
      abortMessage ?? "Pipeline spend cap exceeded; worker aborted.",
      "SPEND_CAP_EXCEEDED",
    );
  }

  const workerExecConfig = deps.phaseConfigResolver.resolveWorkerExecConfig(
    sessionId,
    phase,
    worker.id,
  );
  const resolvedConfig = deps.phaseConfigResolver.resolveWorkerRuntimeConfig(
    phase,
    worker,
    workerExecConfig.workerOverride,
    deps.sandboxBudget ?? false,
  );

  if (!workerExecConfig.providerKey || !workerExecConfig.modelId) {
    throw new AppError(
      `Phase ${phase} has no provider/model configured for session ${sessionId}`,
      "PROVIDER_NOT_CONFIGURED",
    );
  }

  const adapter = await deps.providerRegistry.get(workerExecConfig.providerKey);

  // Resolve prompt
  let promptMarkdown: string;
  if (
    workerExecConfig.promptSource === "session_override" &&
    workerExecConfig.promptMarkdown.trim()
  ) {
    promptMarkdown = workerExecConfig.promptMarkdown.trim();
  } else {
    promptMarkdown = worker.prompt.trim();
  }

  const workerName = workerNameFromPrompt(promptMarkdown);

  const engineResults = injectEngineResults({
    phase,
    sessionId,
    cycleId: cycleId ?? null,
    strategyContext: deps.strategyContext,
    bindings: resolvedConfig.engines,
    task,
  });

  const messages = buildWorkerPrompt({
    phase,
    workerId: worker.id,
    basePromptMarkdown: promptMarkdown,
    task,
    strategyContext: deps.strategyContext,
    strategyContextRequest: worker.strategyContext,
    engineResults,
    sandboxMode: deps.toolContext.isMockSession ?? false,
    mockScenarioKind: deps.toolContext.mockScenarioKind,
  });

  const outputTool: SubmitOutputToolSpec | undefined =
    worker.outputSchema && resolvedConfig.output
      ? {
          name: worker.outputTool?.name ?? DEFAULT_OUTPUT_TOOL_NAME,
          description:
            worker.outputTool?.description ?? DEFAULT_SUBMIT_TOOL_DESCRIPTION,
          schema: resolvedConfig.output.schema,
        }
      : undefined;
  const terminalToolName = outputTool?.name;

  const tools = await buildWorkerTools(
    resolvedConfig.tools,
    deps.toolContext,
    outputTool,
    worker.toolConfig,
  );
  const registeredToolNames = tools ? Object.keys(tools).sort() : [];
  const configuredToolIds = [...resolvedConfig.tools].sort();
  const engineIds = resolvedConfig.engines.map((binding) => binding.engine);
  const logCtx = () => workerLogContext(opts, workerName);

  logger.info(
    {
      ...logCtx(),
      providerKey: workerExecConfig.providerKey,
      providerType: adapter.providerType,
      model: workerExecConfig.modelId,
      promptSource: workerExecConfig.promptSource,
      promptLength: promptMarkdown.length,
      configuredToolIds,
      registeredToolNames,
      terminalToolName: terminalToolName ?? null,
      engineIds,
      outputMode: worker.outputMode,
      hasOutputSchema: Boolean(worker.outputSchema),
      toolRequirements: worker.toolRequirements ?? null,
      maxSteps: resolvedConfig.caps.maxSteps,
      spendLimitUsd: resolvedConfig.caps.spendLimitUsd ?? null,
      maxTokens:
        resolvedConfig.caps.maxTokens ?? workerExecConfig.maxTokens ?? null,
      temperature: resolveTemperature(
        workerExecConfig.modelId,
        workerExecConfig.temperature,
      ),
      reasoningLevel: workerExecConfig.reasoningLevel,
      taskKeys: Object.keys(task).sort(),
      engineResultKeys: Object.keys(engineResults).sort(),
    },
    "worker configured",
  );

  logger.info(
    {
      ...logCtx(),
      configuredToolIds,
      registeredToolNames,
      terminalToolName: terminalToolName ?? null,
      toolCount: registeredToolNames.length,
    },
    "worker registered tools",
  );

  logger.info(
    {
      ...logCtx(),
      model: workerExecConfig.modelId,
      maxSteps: resolvedConfig.caps.maxSteps,
      toolCount: registeredToolNames.length,
    },
    "worker start",
  );

  const runAgent = () =>
    withLLMRetry(
      (signal) =>
        adapter.runAgent({
          model: workerExecConfig.modelId,
          role: phase,
          workerId: worker.id,
          workerName,
          sessionId,
          cycleId: cycleId ?? null,
          tradeId: tradeId ?? null,
          messages,
          tools,
          maxSteps: resolvedConfig.caps.maxSteps,
          spendLimitUsd: resolvedConfig.caps.spendLimitUsd,
          temperature: resolveTemperature(
            workerExecConfig.modelId,
            workerExecConfig.temperature,
          ),
          maxTokens:
            resolvedConfig.caps.maxTokens ?? workerExecConfig.maxTokens,
          reasoningLevel: workerExecConfig.reasoningLevel,
          abortSignal: signal,
          terminalToolNames: terminalToolName ? [terminalToolName] : undefined,
          prepareStep: opts.prepareStep,
        }),
      {
        providerType: adapter.providerType,
        modelId: workerExecConfig.modelId,
        role: phase,
        workerId: worker.id,
        workerName: workerName ?? null,
        sessionId,
        cycleId: cycleId ?? null,
      },
    );

  let trace = await runAgent();
  let output: TOutput;
  let parseFallback = trace.parseFallback;

  if (terminalToolName && resolvedConfig.output) {
    const outputContract =
      resolvedConfig.output as AIWorkerOutputSchema<TOutput>;
    let resolution = parseWorkerOutput<TOutput>(
      outputContract,
      extractWorkerSubmission(trace, terminalToolName),
      false,
    );
    if ("needsRetry" in resolution) {
      logger.warn(
        {
          ...logCtx(),
          terminalToolName,
          finishReason: trace.finishReason,
          stepCount: trace.steps.length,
        },
        "worker terminal output validation failed; retrying once",
      );
      trace = await runAgent();
      resolution = parseWorkerOutput<TOutput>(
        outputContract,
        extractWorkerSubmission(trace, terminalToolName),
        true,
      );
    }
    if ("needsRetry" in resolution) {
      throw new AppError(
        `Worker ${worker.id} (phase ${phase}) did not submit valid output via ${terminalToolName} after retry.`,
        "VALIDATION_FAILED",
      );
    }
    output = resolution.output;
    parseFallback = resolution.parseFallback;
    if (resolution.parseFallback) {
      logger.warn(
        {
          ...logCtx(),
          terminalToolName,
          retried: resolution.retried,
          finishReason: trace.finishReason,
        },
        "worker terminal output substituted empty dimension after validation failure",
      );
    }
  } else {
    output = { text: trace.assistantText } as TOutput;
  }

  const toolsUsed = [...extractToolNamesUsed(trace)].sort();
  const toolCoverage = summarizeWorkerToolCoverage(
    worker.id,
    worker.toolRequirements,
    toolsUsed,
  );
  enforceWorkerToolRequirements(worker, phase, trace);
  if (toolCoverage.satisfied) {
    logger.info(
      {
        ...logCtx(),
        requiredTools: toolCoverage.requiredTools,
        toolsUsed,
        toolCallCount: trace.steps.reduce(
          (sum, step) => sum + step.toolCalls.length,
          0,
        ),
      },
      "worker tool requirements satisfied",
    );
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
    outputSchemaName: worker.outputSchema ? worker.id : null,
    strategyContext: deps.strategyContext,
    parseFallback,
  });

  logger.info(
    {
      ...logCtx(),
      providerKey: workerExecConfig.providerKey,
      model: workerExecConfig.modelId,
      finishReason: trace.finishReason,
      parseFallback,
      stepCount: trace.steps.length,
      toolsUsed,
      toolCallCount: trace.steps.reduce(
        (sum, step) => sum + step.toolCalls.length,
        0,
      ),
      terminalToolSubmitted: terminalToolName
        ? extractWorkerSubmission(trace, terminalToolName) != null
        : null,
      inputTokens: run.input_tokens,
      outputTokens: run.output_tokens,
      durationMs: run.duration_ms,
      costUsd: run.cost_usd,
      costSource: trace.costSource,
      phaseSpentUsd: spendTracker?.phaseSpent ?? null,
      canContinueWorkers: spendTracker?.canContinue() ?? null,
    },
    "worker complete",
  );

  spendTracker?.record(run.cost_usd);
  if (spendTracker && !spendTracker.canContinue()) {
    const abortMessage = spendTracker.abortLogMessage();
    if (abortMessage)
      logger.warn(
        {
          ...logCtx(),
          phaseSpentUsd: spendTracker.phaseSpent,
          pipelineSpentUsd: spendTracker.pipelineSpent,
        },
        abortMessage,
      );
  }

  return { run, message, output };
}

/**
 * Pull the worker's submitted output from its terminal tool call. The terminal
 * tool's `execute` echoes its validated input, so the call args carry the
 * structured submission. Returns the last submission if called more than once,
 * or undefined if the worker never called the terminal tool.
 */
export function extractWorkerSubmission(
  trace: {
    steps: Array<{
      toolCalls: Array<{ tool?: string; argsJson?: string }>;
    }>;
  },
  terminalToolName: string,
): unknown | undefined {
  let submission: unknown | undefined;
  for (const step of trace.steps) {
    for (const call of step.toolCalls) {
      if (call.tool !== terminalToolName || !call.argsJson) continue;
      try {
        submission = JSON.parse(call.argsJson);
      } catch {
        submission = call.argsJson;
      }
    }
  }
  return submission;
}
