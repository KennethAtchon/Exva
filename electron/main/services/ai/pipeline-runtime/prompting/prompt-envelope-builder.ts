import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import { RUNTIME_DEFAULTS } from "@electron/shared/ai/pipeline-phase";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { buildWorkerStrategyPromptContext } from "../../strategy-prompt-context";
import type { RuntimeAgentMessage } from "../../ai-runtime/ai-runtime-types";
import { createLogger } from "../../../infra/log";
import { buildPresetBehaviorGuidance } from "./preset-behavior-guidance";

const logger = createLogger("prompt-envelope");

export interface PromptEnvelope {
  systemPrompt: string;
  userPayload: Record<string, unknown>;
}

export interface PromptEnvelopeInput {
  phase: PipelinePhase;
  workerId: string;
  basePromptMarkdown: string;
  task: Record<string, unknown>;
  strategyContext: SessionStrategyContext;
  engineResults?: Record<string, unknown>;
  sandboxMode?: boolean;
  riskPolicy?: {
    maxPositionUsd: number;
    maxDataSpendUsd: number;
    humanApprovalRequired: boolean;
  } | null;
}

export interface PromptEnvelopeSizeReport {
  systemChars: number;
  userChars: number;
  maxSystemChars: number;
  maxUserChars: number;
  exceedsSystem: boolean;
  exceedsUser: boolean;
}

export function buildPromptEnvelope(
  input: PromptEnvelopeInput,
): PromptEnvelope {
  return {
    systemPrompt: input.basePromptMarkdown.trim(),
    userPayload: {
      phase: input.phase,
      workerId: input.workerId,
      task: input.task,
      engineResults: input.engineResults ?? {},
      sandboxMode: input.sandboxMode ?? false,
    },
  };
}

/** Character counts vs RUNTIME_DEFAULTS — for tests and observability only; never mutates content. */
export function measurePromptEnvelope(
  messages: RuntimeAgentMessage[],
): PromptEnvelopeSizeReport {
  const systemChars =
    messages.find((m) => m.role === "system")?.content.length ?? 0;
  const userChars =
    messages.find((m) => m.role === "user")?.content.length ?? 0;
  const maxSystemChars = RUNTIME_DEFAULTS.prompt.maxSystemChars;
  const maxUserChars = RUNTIME_DEFAULTS.prompt.maxUserPayloadChars;
  return {
    systemChars,
    userChars,
    maxSystemChars,
    maxUserChars,
    exceedsSystem: systemChars > maxSystemChars,
    exceedsUser: userChars > maxUserChars,
  };
}

export function envelopeToMessages(
  envelope: PromptEnvelope,
  strategyContext: SessionStrategyContext,
): RuntimeAgentMessage[] {
  const phase = envelope.userPayload.phase as PipelinePhase;
  const strategyPrompt = buildWorkerStrategyPromptContext(
    strategyContext,
    phase,
  );
  const presetGuidance = buildPresetBehaviorGuidance(strategyContext, phase);

  const userContent = [
    `<trusted_session_context>\n${strategyPrompt}\n</trusted_session_context>`,
    presetGuidance.trim()
      ? `<preset_behavior>\n${presetGuidance}\n</preset_behavior>`
      : null,
    Object.keys(envelope.userPayload.engineResults as Record<string, unknown>)
      .length > 0
      ? `<engine_results>\n${JSON.stringify(envelope.userPayload.engineResults, null, 2)}\n</engine_results>`
      : null,
    `<task>\n${JSON.stringify(envelope.userPayload.task, null, 2)}\n</task>`,
  ]
    .filter((block): block is string => block != null)
    .join("\n\n");

  const messages: RuntimeAgentMessage[] = [
    { role: "system", content: envelope.systemPrompt },
    { role: "user", content: userContent },
  ];

  const sizes = measurePromptEnvelope(messages);
  if (sizes.exceedsSystem || sizes.exceedsUser) {
    logger.warn(
      {
        phase,
        workerId: envelope.userPayload.workerId,
        ...sizes,
      },
      "worker prompt exceeds RUNTIME_DEFAULTS.prompt limits (content unchanged — shorten session config or worker task)",
    );
  }

  return messages;
}
