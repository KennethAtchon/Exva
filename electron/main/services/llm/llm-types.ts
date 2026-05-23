import type {
  AgentMessage as PersistedAgentMessage,
  AgentRun,
  AgentRunFinishReason,
} from "@/lib/types";

/** Minimal message shape for provider `generateText` input (plan § Phase 0). */
export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
};

export type LLMToolCall = {
  step: number;
  tool: string;
  argsJson: string;
  resultJson: string;
  latencyMs: number;
  error?: string;
  fromCache?: boolean;
};

export type LLMToolStepTrace = {
  step: number;
  toolCalls: LLMToolCall[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type LLMCallTrace<T = undefined> = {
  assistantText: string;
  structuredOutput?: T;
  messages: LLMMessage[];
  /** Best-effort JSON serialization of provider response messages for audit replay. */
  auditMessagesJson: string;
  steps: LLMToolStepTrace[];
  thinkingText?: string | null;
  finishReason: AgentRunFinishReason;
  parseFallback: boolean;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number;
  costSource: "provider" | "estimated";
};

export interface LLMRunResult<T> {
  run: AgentRun;
  message: PersistedAgentMessage;
  output: T;
}
