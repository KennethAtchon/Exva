import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
  generateText,
  hasToolCall,
  Output,
  stepCountIs,
  type FinishReason,
  type LanguageModel,
  type PrepareStepFunction,
  type StepResult,
  type StopCondition,
  type ToolSet,
} from "ai";
import type { z } from "zod";
import type { AgentRole } from "@/lib/types";
import type { ReasoningLevel } from "@electron/shared/ai/ai-phase";
import type { AgentRunFinishReason } from "@electron/shared/domain";
import { estimateCostUsd, resolveModelPricingRates } from "../model-pricing";
import { resolveRunCostUsd } from "../resolve-run-cost";
import type {
  LLMMessage,
  LLMCallTrace,
  LLMToolStepTrace,
  LLMToolCall,
} from "../llm-types";
import { createLogger } from "../../infra/log";
import {
  buildToolStepSignature,
  canonicalizeToolInput,
} from "../tool-loop-guard";

const logger = createLogger("run-agent-execute");

function agentLogContext(params: RunAgentExecuteParams<unknown>): {
  role: AgentRole | null;
  workerId: string | null;
  workerName: string | null;
  sessionId: string | null;
  cycleId: string | null;
  tradeId: string | null;
  modelId: string;
} {
  return {
    role: params.role ?? null,
    workerId: params.workerId ?? null,
    workerName: params.workerName ?? null,
    sessionId: params.sessionId ?? null,
    cycleId: params.cycleId ?? null,
    tradeId: params.tradeId ?? null,
    modelId: params.modelId,
  };
}

export interface RunAgentExecuteParams<T> {
  model: LanguageModel;
  modelId: string;
  providerType?: string;
  role?: AgentRole;
  workerId?: string;
  workerName?: string;
  sessionId?: string;
  cycleId?: string | null;
  tradeId?: string | null;
  messages: LLMMessage[];
  tools?: ToolSet;
  maxSteps: number;
  spendLimitUsd?: number;
  temperature?: number;
  maxOutputTokens?: number;
  reasoningLevel?: ReasoningLevel;
  providerOptions?: ProviderOptions;
  abortSignal?: AbortSignal;
  schema?: z.ZodType<T>;
  terminalToolNames?: string[];
  prepareStep?: PrepareStepFunction<ToolSet>;
}

function splitSystem(messages: LLMMessage[]): {
  system: string | undefined;
  rest: LLMMessage[];
} {
  const sys: string[] = [];
  const rest: LLMMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") sys.push(m.content);
    else rest.push(m);
  }
  return { system: sys.length ? sys.join("\n\n") : undefined, rest };
}

function userPromptFrom(messages: LLMMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
}

function loopFingerprintGuard<T extends ToolSet>(): StopCondition<T> {
  return ({ steps }) => {
    const recent = steps
      .slice(-4)
      .map((s) => buildToolStepSignature(s as never));
    if (recent.length >= 4 && new Set(recent).size === 1) {
      return true;
    }

    const recentCalls = steps
      .flatMap((step) =>
        step.toolCalls.map((call) => ({
          toolName: String(call.toolName),
          signature: canonicalizeToolInput(String(call.toolName), call.input),
        })),
      )
      .slice(-6);

    if (recentCalls.length < 4) return false;

    const searchCalls = recentCalls.filter(
      (call) =>
        call.toolName === "search_web" || call.toolName === "search_reddit",
    );
    if (
      searchCalls.length >= 4 &&
      new Set(searchCalls.map((call) => `${call.toolName}:${call.signature}`))
        .size <= 2
    ) {
      return true;
    }

    const verifyCalls = recentCalls.filter(
      (call) =>
        call.toolName === "get_quote" ||
        call.toolName === "get_news" ||
        call.toolName === "get_ohlcv",
    );
    if (
      verifyCalls.length >= 4 &&
      new Set(verifyCalls.map((call) => call.signature)).size === 1
    ) {
      return true;
    }

    return false;
  };
}

function spendGuardUsd<T extends ToolSet>(
  modelId: string,
  maxUsd: number,
): StopCondition<T> {
  const rates = resolveModelPricingRates(modelId);
  return ({ steps }) => {
    const inTok = steps.reduce(
      (acc, st) => acc + (st.usage?.inputTokens ?? 0),
      0,
    );
    const outTok = steps.reduce(
      (acc, st) => acc + (st.usage?.outputTokens ?? 0),
      0,
    );
    const cost =
      (inTok / 1_000_000) * rates.inputPer1M +
      (outTok / 1_000_000) * rates.outputPer1M;
    return cost > maxUsd;
  };
}

function stepCapStop<T extends ToolSet>(maxSteps: number): StopCondition<T> {
  return ({ steps }) => steps.length >= maxSteps;
}

function mapFinishReason(
  fr: FinishReason,
  opts: { spendExceeded: boolean; stepCapHit: boolean },
): AgentRunFinishReason {
  if (opts.spendExceeded) return "tool_budget";
  if (opts.stepCapHit && fr !== "stop") return "tool_budget";
  if (fr === "length") return "length";
  if (fr === "error") return "error";
  return "stop";
}

function buildLLMToolStepTraces<TOOLS extends ToolSet>(
  sdkSteps: StepResult<TOOLS>[],
  stepFinishTimes: number[],
  startedAt: number,
): LLMToolStepTrace[] {
  return sdkSteps.map((st, i) => {
    const finishTime = stepFinishTimes[i];
    const prevTime =
      i === 0 ? startedAt : (stepFinishTimes[i - 1] ?? startedAt);
    const latencyMs =
      finishTime != null ? Math.max(0, finishTime - prevTime) : 0;
    const toolCalls: LLMToolCall[] = [];
    const resultsById = new Map<string, unknown>();
    for (const tr of st.toolResults) {
      resultsById.set(tr.toolCallId, "output" in tr ? tr.output : undefined);
    }
    for (const tc of st.toolCalls) {
      const argsJson = JSON.stringify(tc.input);
      const rawOut = resultsById.get(tc.toolCallId);
      toolCalls.push({
        step: i + 1,
        tool: String(tc.toolName),
        argsJson,
        resultJson:
          typeof rawOut === "string" ? rawOut : JSON.stringify(rawOut ?? null),
        latencyMs,
      });
    }
    return {
      step: i + 1,
      toolCalls,
      inputTokens: st.usage?.inputTokens ?? 0,
      outputTokens: st.usage?.outputTokens ?? 0,
      latencyMs,
    };
  });
}

function persistedMessages(
  system: string | undefined,
  userBlock: string,
  assistantText: string,
): LLMMessage[] {
  const m: LLMMessage[] = [];
  if (system?.trim()) m.push({ role: "system", content: system.trim() });
  m.push({ role: "user", content: userBlock });
  m.push({ role: "assistant", content: assistantText });
  return m;
}

export async function executeRunAgent<T = undefined>(
  params: RunAgentExecuteParams<T>,
): Promise<LLMCallTrace<T>> {
  const started = Date.now();
  const { system, rest } = splitSystem(params.messages);
  const prompt = userPromptFrom(rest);

  logger.info(
    {
      ...agentLogContext(params),
      systemPrompt: system ?? null,
      userPrompt: prompt,
    },
    "agent prompt",
  );
  logger.info(
    {
      providerType: params.providerType ?? null,
      ...agentLogContext(params),
      temperature: params.temperature ?? null,
      reasoningLevel: params.reasoningLevel ?? null,
      hasTools: Boolean(params.tools),
      toolNames: params.tools ? Object.keys(params.tools) : [],
      hasSchema: Boolean(params.schema),
      systemChars: system?.length ?? 0,
      promptChars: prompt.length,
      maxSteps: params.maxSteps,
      spendLimitUsd: params.spendLimitUsd ?? null,
    },
    "execute run agent start",
  );

  const conditions: StopCondition<ToolSet>[] = [];
  if (params.tools && params.maxSteps > 0) {
    conditions.push(stepCapStop(params.maxSteps));
  }
  for (const toolName of params.terminalToolNames ?? []) {
    conditions.push(hasToolCall(toolName));
  }
  if (params.spendLimitUsd != null && params.spendLimitUsd > 0) {
    conditions.push(spendGuardUsd(params.modelId, params.spendLimitUsd));
  }
  if (params.tools) {
    conditions.push(loopFingerprintGuard());
  }

  let stopWhen: StopCondition<ToolSet> | StopCondition<ToolSet>[] =
    stepCountIs(1);
  if (params.tools && conditions.length > 0) {
    const first = conditions[0];
    stopWhen = conditions.length === 1 ? first : conditions;
  }

  const baseArgs = {
    model: params.model,
    system,
    prompt,
    tools: params.tools,
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    ...(params.providerOptions ? { providerOptions: params.providerOptions } : {}),
    abortSignal: params.abortSignal,
    stopWhen,
    prepareStep: params.prepareStep,
    // Disable SDK-level retry so withLLMRetry owns the retry policy and
    // we don't lose the underlying provider error behind "Failed after N attempts".
    maxRetries: 0,
  } as const;

  const onStepFinish = (step: StepResult<ToolSet>, stepIndex: number) => {
    if (params.abortSignal?.aborted) {
      return;
    }
    if (step.toolCalls.length > 0) {
      const resultsById = new Map<string, unknown>();
      for (const tr of step.toolResults) {
        resultsById.set(tr.toolCallId, "output" in tr ? tr.output : undefined);
      }
      for (const tc of step.toolCalls) {
        const rawOut = resultsById.get(tc.toolCallId);
        logger.info(
          {
            ...agentLogContext(params),
            step: stepIndex + 1,
            tool: String(tc.toolName),
            toolArgs: tc.input,
            toolResult: rawOut ?? null,
          },
          "agent tool call",
        );
      }
    }
    if (step.text) {
      logger.info(
        {
          ...agentLogContext(params),
          step: stepIndex + 1,
          fullText: step.text,
        },
        "agent step text",
      );
    }
  };

  const stepFinishTimes: number[] = [];
  let stepIndex = 0;
  const wrappedBaseArgs = {
    ...baseArgs,
    onStepFinish: (step: StepResult<ToolSet>) => {
      stepFinishTimes.push(Date.now());
      onStepFinish(step, stepIndex++);
    },
  };

  const result = params.schema
    ? await generateText({
        ...wrappedBaseArgs,
        experimental_output: Output.object({ schema: params.schema }),
      })
    : await generateText(wrappedBaseArgs);

  if (params.abortSignal?.aborted) {
    throw new Error("AI request aborted");
  }

  const durationMs = Date.now() - started;
  const steps = buildLLMToolStepTraces(result.steps, stepFinishTimes, started);
  const totalIn = result.totalUsage.inputTokens ?? 0;
  const totalOut = result.totalUsage.outputTokens ?? 0;
  const { costUsd: totalCost, costSource } = resolveRunCostUsd({
    modelId: params.modelId,
    inputTokens: totalIn,
    outputTokens: totalOut,
    providerMetadata: result.providerMetadata,
    providerType: params.providerType,
  });
  if (costSource === "estimated") {
    logger.warn(
      {
        ...agentLogContext(params),
        modelId: params.modelId,
        costSource,
        costUsd: totalCost,
        providerType: params.providerType ?? null,
      },
      "agent run cost estimated from pricing table fallback",
    );
  }
  const spendExceeded =
    params.spendLimitUsd != null &&
    params.spendLimitUsd > 0 &&
    totalCost > params.spendLimitUsd;
  const stepCapHit = Boolean(
    params.tools &&
    params.maxSteps > 0 &&
    result.steps.length >= params.maxSteps,
  );

  let structured: T | undefined;
  let parseFallback = false;
  if (params.schema) {
    structured = result.experimental_output as T | undefined;
    parseFallback = structured === undefined;
  }

  let auditMessagesJson: string;
  try {
    auditMessagesJson = JSON.stringify(result.response.messages);
  } catch {
    auditMessagesJson = JSON.stringify(
      persistedMessages(system, prompt, result.text),
    );
  }

  if (result.reasoningText) {
    logger.info(
      {
        ...agentLogContext(params),
        thinkingChars: result.reasoningText.length,
        thinking: result.reasoningText,
      },
      "agent reasoning",
    );
  }

  logger.info(
    {
      ...agentLogContext(params),
      finishReason: result.finishReason,
      mappedFinishReason: mapFinishReason(result.finishReason, {
        spendExceeded,
        stepCapHit,
      }),
      steps: result.steps.length,
      inputTokens: totalIn,
      outputTokens: totalOut,
      durationMs,
      totalCostUsd: totalCost,
      costSource,
      spendExceeded,
      stepCapHit,
      responseText: result.text,
    },
    "execute run agent complete",
  );

  return {
    assistantText: result.text,
    structuredOutput: structured,
    messages: persistedMessages(system, prompt, result.text),
    auditMessagesJson,
    steps,
    thinkingText: result.reasoningText ?? null,
    finishReason: mapFinishReason(result.finishReason, {
      spendExceeded,
      stepCapHit,
    }),
    parseFallback,
    inputTokens: totalIn,
    outputTokens: totalOut,
    durationMs,
    costUsd: totalCost,
    costSource,
  };
}
