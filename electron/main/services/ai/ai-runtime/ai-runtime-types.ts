import type { AgentMessage as PersistedAgentMessage, AgentRun, AgentRunFinishReason, AgentRole } from "@/lib/types";

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

/** Role-specific harness caps (plan §4). */
export const ROLE_HARNESS_CAPS: Record<AgentRole, { maxSteps: number; spendUsd: number }> = {
  instrument_selector: { maxSteps: 25, spendUsd: 0.15 },
  analyst_technical: { maxSteps: 12, spendUsd: 0.08 },
  analyst_fundamental: { maxSteps: 12, spendUsd: 0.08 },
  reviewer: { maxSteps: 8, spendUsd: 0.05 },
  decision_maker: { maxSteps: 1, spendUsd: 0.04 },
};

export type RoleToolPolicy = {
  /** Session/workspace search provider → `search_web` tool when configured. */
  allowSearch: boolean;
  /** Broker wiring + search provider → `get_news` market tool (same backend as web search). */
  allowMarketNewsTool: boolean;
  /** Broker wiring → `get_quote` and `get_ohlcv`. */
  allowMarketQuoteTools: boolean;
  /** Universe researcher terminal tool `submit_candidates`. */
  allowSubmitCandidates: boolean;
  /** Structured-output path with no tool loop (decision maker). */
  enforceNoTools: boolean;
};

export const ROLE_TOOL_POLICY: Record<AgentRole, RoleToolPolicy> = {
  instrument_selector: {
    allowSearch: true,
    allowMarketNewsTool: true,
    allowMarketQuoteTools: true,
    allowSubmitCandidates: true,
    enforceNoTools: false,
  },
  analyst_technical: {
    allowSearch: true,
    allowMarketNewsTool: true,
    allowMarketQuoteTools: false,
    allowSubmitCandidates: false,
    enforceNoTools: false,
  },
  analyst_fundamental: {
    allowSearch: true,
    allowMarketNewsTool: true,
    allowMarketQuoteTools: false,
    allowSubmitCandidates: false,
    enforceNoTools: false,
  },
  reviewer: {
    allowSearch: true,
    allowMarketNewsTool: false,
    allowMarketQuoteTools: false,
    allowSubmitCandidates: false,
    enforceNoTools: false,
  },
  decision_maker: {
    allowSearch: false,
    allowMarketNewsTool: false,
    allowMarketQuoteTools: false,
    allowSubmitCandidates: false,
    enforceNoTools: true,
  },
};
