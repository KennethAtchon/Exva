/** Control Center (AI assistant) domain types — see docs/specs/ai-control-center.md */

export type ControlScopeKind = "workspace" | "session";

export type ControlMessageRole = "user" | "assistant" | "system";

export type ControlMessageStatus =
  | "complete"
  | "streaming"
  | "cancelled"
  | "error";

export type ControlToolKind = "read" | "mutating";

export type ControlToolCallStatus =
  | "running"
  | "awaiting_confirm"
  | "succeeded"
  | "rejected"
  | "failed";

export type ControlConfirmation =
  | "not_required"
  | "auto_approved"
  | "confirmed"
  | "rejected";

export interface ControlConversation {
  id: string;
  title: string;
  scopeKind: ControlScopeKind;
  scopeSessionId: string | null;
  autoApproved: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ControlMessage {
  id: string;
  conversationId: string;
  role: ControlMessageRole;
  content: string;
  status: ControlMessageStatus;
  turnId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  createdAt: string;
}

export interface ControlToolCall {
  id: string;
  conversationId: string;
  turnId: string;
  capability: string;
  kind: ControlToolKind;
  inputJson: string;
  resultJson: string | null;
  status: ControlToolCallStatus;
  confirmation: ControlConfirmation | null;
  affectedEntity: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ControlConversationDetail {
  conversation: ControlConversation;
  messages: ControlMessage[];
  toolCalls: ControlToolCall[];
}

export interface ControlConversationSummary {
  id: string;
  title: string;
  scopeKind: ControlScopeKind;
  scopeSessionId: string | null;
  messageCount: number;
  updatedAt: string;
}
