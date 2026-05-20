import type {
  AgentMessage as PersistedAgentMessage,
  AgentRun,
  AgentRunFinishReason,
} from "@/lib/types";

/** Minimal message shape for provider `generateText` input (plan § Phase 0). */
export type RuntimeAgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
};

export type ToolCallRecord = {
  step: number;
  tool: string;
  argsJson: string;
  resultJson: string;
  latencyMs: number;
  error?: string;
  fromCache?: boolean;
};

export type StepTrace = {
  step: number;
  toolCalls: ToolCallRecord[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type RunTrace<T = undefined> = {
  assistantText: string;
  structuredOutput?: T;
  messages: RuntimeAgentMessage[];
  /** Best-effort JSON serialization of provider response messages for audit replay. */
  auditMessagesJson: string;
  steps: StepTrace[];
  thinkingText?: string | null;
  finishReason: AgentRunFinishReason;
  parseFallback: boolean;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export interface AgentResult<T> {
  run: AgentRun;
  message: PersistedAgentMessage;
  output: T;
}
