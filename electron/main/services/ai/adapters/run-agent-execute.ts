import { generateText, Output, stepCountIs, type FinishReason, type LanguageModel, type StepResult, type StopCondition, type ToolSet } from "ai";
import type { z } from "zod";
import type { AgentRunFinishReason } from "@electron/shared/domain";
import { estimateCostUsd, resolveModelPricingRates } from "../model-pricing";
import type { RuntimeAgentMessage, RunTrace, StepTrace, ToolCallRecord } from "../ai-runtime-types";
import { createLogger } from "../../infra/log";

const logger = createLogger("run-agent-execute");

export interface RunAgentExecuteParams<T> {
  model: LanguageModel;
  modelId: string;
  messages: RuntimeAgentMessage[];
  tools?: ToolSet;
  maxSteps: number;
  spendLimitUsd?: number;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  schema?: z.ZodType<T>;
}

function splitSystem(messages: RuntimeAgentMessage[]): { system: string | undefined; rest: RuntimeAgentMessage[] } {
  const sys: string[] = [];
  const rest: RuntimeAgentMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") sys.push(m.content);
    else rest.push(m);
  }
  return { system: sys.length ? sys.join("\n\n") : undefined, rest };
}

function userPromptFrom(messages: RuntimeAgentMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
}

function loopFingerprintGuard<T extends ToolSet>(): StopCondition<T> {
  return ({ steps }) => {
    const recent = steps.slice(-3).map((s) =>
      s.toolCalls.map((tc) => `${String(tc.toolName)}:${JSON.stringify(tc.input)}`).join("|"),
    );
    return recent.length === 3 && new Set(recent).size === 1;
  };
}

function spendGuardUsd<T extends ToolSet>(modelId: string, maxUsd: number): StopCondition<T> {
  const rates = resolveModelPricingRates(modelId);
  return ({ steps }) => {
    const inTok = steps.reduce((acc, st) => acc + (st.usage?.inputTokens ?? 0), 0);
    const outTok = steps.reduce((acc, st) => acc + (st.usage?.outputTokens ?? 0), 0);
    const cost = (inTok / 1_000_000) * rates.inputPer1M + (outTok / 1_000_000) * rates.outputPer1M;
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

function buildStepTraces<TOOLS extends ToolSet>(sdkSteps: StepResult<TOOLS>[], durationMs: number): StepTrace[] {
  const per = sdkSteps.length ? Math.max(0, Math.round(durationMs / sdkSteps.length)) : 0;
  return sdkSteps.map((st, i) => {
    const toolCalls: ToolCallRecord[] = [];
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
        resultJson: typeof rawOut === "string" ? rawOut : JSON.stringify(rawOut ?? null),
        latencyMs: per,
      });
    }
    return {
      step: i + 1,
      toolCalls,
      inputTokens: st.usage?.inputTokens ?? 0,
      outputTokens: st.usage?.outputTokens ?? 0,
      latencyMs: per,
    };
  });
}

function persistedMessages(system: string | undefined, userBlock: string, assistantText: string): RuntimeAgentMessage[] {
  const m: RuntimeAgentMessage[] = [];
  if (system?.trim()) m.push({ role: "system", content: system.trim() });
  m.push({ role: "user", content: userBlock });
  m.push({ role: "assistant", content: assistantText });
  return m;
}

export async function executeRunAgent<T = undefined>(params: RunAgentExecuteParams<T>): Promise<RunTrace<T>> {
  const started = Date.now();
  const { system, rest } = splitSystem(params.messages);
  const prompt = userPromptFrom(rest);
  logger.debug(
    {
      modelId: params.modelId,
      hasTools: Boolean(params.tools),
      hasSchema: Boolean(params.schema),
      promptChars: prompt.length,
      promptTooLong: prompt.length > 2_000,
      maxSteps: params.maxSteps,
      spendLimitUsd: params.spendLimitUsd ?? null,
    },
    "execute run agent start",
  );

  const conditions: StopCondition<ToolSet>[] = [];
  if (params.tools && params.maxSteps > 0) {
    conditions.push(stepCapStop(params.maxSteps));
  }
  if (params.spendLimitUsd != null && params.spendLimitUsd > 0) {
    conditions.push(spendGuardUsd(params.modelId, params.spendLimitUsd));
  }
  if (params.tools) {
    conditions.push(loopFingerprintGuard());
  }

  let stopWhen: StopCondition<ToolSet> | StopCondition<ToolSet>[] = stepCountIs(1);
  if (params.tools && conditions.length > 0) {
    const first = conditions[0];
    stopWhen = conditions.length === 1 && first ? first : conditions;
  }

  const baseArgs = {
    model: params.model,
    system,
    prompt,
    tools: params.tools,
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    abortSignal: params.abortSignal,
    stopWhen,
  } as const;

  const result = params.schema
    ? await generateText({
        ...baseArgs,
        experimental_output: Output.object({ schema: params.schema }),
      })
    : await generateText(baseArgs);

  const durationMs = Date.now() - started;
  const steps = buildStepTraces(result.steps, durationMs);
  const totalIn = result.totalUsage.inputTokens ?? 0;
  const totalOut = result.totalUsage.outputTokens ?? 0;
  const totalCost = estimateCostUsd(params.modelId, totalIn, totalOut);
  const spendExceeded = params.spendLimitUsd != null && params.spendLimitUsd > 0 && totalCost > params.spendLimitUsd;
  const stepCapHit = Boolean(params.tools && params.maxSteps > 0 && result.steps.length >= params.maxSteps);

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
    auditMessagesJson = JSON.stringify(persistedMessages(system, prompt, result.text));
  }

  logger.info(
    {
      modelId: params.modelId,
      finishReason: result.finishReason,
      mappedFinishReason: mapFinishReason(result.finishReason, { spendExceeded, stepCapHit }),
      steps: result.steps.length,
      inputTokens: totalIn,
      outputTokens: totalOut,
      durationMs,
      totalCostUsd: totalCost,
      spendExceeded,
      stepCapHit,
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
    finishReason: mapFinishReason(result.finishReason, { spendExceeded, stepCapHit }),
    parseFallback,
    inputTokens: totalIn,
    outputTokens: totalOut,
    durationMs,
  };
}
