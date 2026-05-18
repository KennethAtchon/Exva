import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { buildStrategyPromptContext } from "../strategy-prompt-context";
import type { RuntimeAgentMessage } from "../ai-runtime/ai-runtime-types";

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
  sandboxMode?: boolean;
  riskPolicy?: {
    maxPositionUsd: number;
    maxDataSpendUsd: number;
    humanApprovalRequired: boolean;
  } | null;
}

export function buildPromptEnvelope(input: PromptEnvelopeInput): PromptEnvelope {
  return {
    systemPrompt: input.basePromptMarkdown.trim(),
    userPayload: {
      phase: input.phase,
      workerId: input.workerId,
      task: input.task,
      sandboxMode: input.sandboxMode ?? false,
    },
  };
}

export function envelopeToMessages(
  envelope: PromptEnvelope,
  strategyContext: SessionStrategyContext,
): RuntimeAgentMessage[] {
  const { snapshot, prompt: strategyPrompt } = buildStrategyPromptContext(strategyContext);

  const userContent = [
    `<trusted_session_context>\n${strategyPrompt}\n</trusted_session_context>`,
    `<task>\n${JSON.stringify(envelope.userPayload.task, null, 2)}\n</task>`,
  ].join("\n\n");

  return [
    { role: "system", content: envelope.systemPrompt },
    { role: "user", content: userContent },
  ];
}

export { buildStrategyPromptContext };
