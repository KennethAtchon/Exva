import { and, desc, eq, sql } from "drizzle-orm";
import type { DbClient } from "../../client";
import {
  controlConversations,
  controlMessages,
  controlToolCalls,
} from "../../schema";
import type {
  ControlConversation,
  ControlConversationSummary,
  ControlMessage,
  ControlMessageRole,
  ControlMessageStatus,
  ControlScopeKind,
  ControlToolCall,
  ControlToolCallStatus,
  ControlToolKind,
  ControlConfirmation,
} from "@electron/shared/domain/control";
import { safeJsonParse } from "../../../services/infra/safe-json-parse";

type ConversationRow = typeof controlConversations.$inferSelect;
type MessageRow = typeof controlMessages.$inferSelect;
type ToolCallRow = typeof controlToolCalls.$inferSelect;

function toConversation(row: ConversationRow): ControlConversation {
  const parsed = safeJsonParse<unknown>(
    row.autoApprovedJson,
    undefined,
    "control-repo.autoApproved",
  );
  const autoApproved = Array.isArray(parsed)
    ? parsed.filter((v): v is string => typeof v === "string")
    : [];
  return {
    id: row.id,
    title: row.title,
    scopeKind: row.scopeKind as ControlScopeKind,
    scopeSessionId: row.scopeSessionId,
    autoApproved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMessage(row: MessageRow): ControlMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as ControlMessageRole,
    content: row.content,
    status: row.status as ControlMessageStatus,
    turnId: row.turnId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    createdAt: row.createdAt,
  };
}

function toToolCall(row: ToolCallRow): ControlToolCall {
  return {
    id: row.id,
    conversationId: row.conversationId,
    turnId: row.turnId,
    capability: row.capability,
    kind: row.kind as ControlToolKind,
    inputJson: row.inputJson,
    resultJson: row.resultJson,
    status: row.status as ControlToolCallStatus,
    confirmation: row.confirmation as ControlConfirmation | null,
    affectedEntity: row.affectedEntity,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

/** Persistence for control_conversations, control_messages, control_tool_calls. */
export class ControlRepo {
  constructor(private readonly client: DbClient) {}

  // --- Conversations ---

  createConversation(input: {
    id: string;
    title: string;
    scopeKind: ControlScopeKind;
    scopeSessionId: string | null;
  }): ControlConversation {
    const now = new Date().toISOString();
    this.client.db
      .insert(controlConversations)
      .values({
        id: input.id,
        title: input.title,
        scopeKind: input.scopeKind,
        scopeSessionId: input.scopeSessionId,
        autoApprovedJson: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.requireConversation(input.id);
  }

  findConversation(id: string): ControlConversation | null {
    const row = this.client.db
      .select()
      .from(controlConversations)
      .where(eq(controlConversations.id, id))
      .get();
    return row ? toConversation(row) : null;
  }

  requireConversation(id: string): ControlConversation {
    const found = this.findConversation(id);
    if (!found) throw new Error(`Control conversation not found: ${id}`);
    return found;
  }

  listConversations(): ControlConversationSummary[] {
    const rows = this.client.db
      .select()
      .from(controlConversations)
      .orderBy(desc(controlConversations.updatedAt))
      .all();
    const counts = this.client.db
      .select({
        conversationId: controlMessages.conversationId,
        count: sql<number>`count(*)`,
      })
      .from(controlMessages)
      .groupBy(controlMessages.conversationId)
      .all();
    const countById = new Map(
      counts.map((c) => [c.conversationId, Number(c.count ?? 0)]),
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      scopeKind: row.scopeKind as ControlScopeKind,
      scopeSessionId: row.scopeSessionId,
      messageCount: countById.get(row.id) ?? 0,
      updatedAt: row.updatedAt,
    }));
  }

  renameConversation(id: string, title: string): void {
    this.client.db
      .update(controlConversations)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(eq(controlConversations.id, id))
      .run();
  }

  deleteConversation(id: string): void {
    this.client.db
      .delete(controlConversations)
      .where(eq(controlConversations.id, id))
      .run();
  }

  setAutoApproved(id: string, autoApproved: string[]): void {
    this.client.db
      .update(controlConversations)
      .set({
        autoApprovedJson: JSON.stringify(autoApproved),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(controlConversations.id, id))
      .run();
  }

  touchConversation(id: string): void {
    this.client.db
      .update(controlConversations)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(controlConversations.id, id))
      .run();
  }

  // --- Messages ---

  insertMessage(input: {
    id: string;
    conversationId: string;
    role: ControlMessageRole;
    content: string;
    status: ControlMessageStatus;
    turnId: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    costUsd?: number | null;
  }): ControlMessage {
    const now = new Date().toISOString();
    this.client.db
      .insert(controlMessages)
      .values({
        id: input.id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        status: input.status,
        turnId: input.turnId,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        costUsd: input.costUsd ?? null,
        createdAt: now,
      })
      .run();
    this.touchConversation(input.conversationId);
    return this.requireMessage(input.id);
  }

  updateMessage(
    id: string,
    patch: {
      content?: string;
      status?: ControlMessageStatus;
      inputTokens?: number | null;
      outputTokens?: number | null;
      costUsd?: number | null;
    },
  ): void {
    this.client.db
      .update(controlMessages)
      .set(patch)
      .where(eq(controlMessages.id, id))
      .run();
  }

  requireMessage(id: string): ControlMessage {
    const row = this.client.db
      .select()
      .from(controlMessages)
      .where(eq(controlMessages.id, id))
      .get();
    if (!row) throw new Error(`Control message not found: ${id}`);
    return toMessage(row);
  }

  listMessages(conversationId: string): ControlMessage[] {
    const rows = this.client.db
      .select()
      .from(controlMessages)
      .where(eq(controlMessages.conversationId, conversationId))
      .orderBy(controlMessages.createdAt)
      .all();
    return rows.map(toMessage);
  }

  // --- Tool calls ---

  insertToolCall(input: {
    id: string;
    conversationId: string;
    turnId: string;
    capability: string;
    kind: ControlToolKind;
    inputJson: string;
    status: ControlToolCallStatus;
    confirmation: ControlConfirmation | null;
    affectedEntity: string | null;
  }): void {
    this.client.db
      .insert(controlToolCalls)
      .values({
        id: input.id,
        conversationId: input.conversationId,
        turnId: input.turnId,
        capability: input.capability,
        kind: input.kind,
        inputJson: input.inputJson,
        resultJson: null,
        status: input.status,
        confirmation: input.confirmation,
        affectedEntity: input.affectedEntity,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      })
      .run();
  }

  updateToolCall(
    id: string,
    patch: {
      resultJson?: string | null;
      status?: ControlToolCallStatus;
      confirmation?: ControlConfirmation | null;
      finishedAt?: string | null;
    },
  ): void {
    this.client.db
      .update(controlToolCalls)
      .set(patch)
      .where(eq(controlToolCalls.id, id))
      .run();
  }

  listToolCalls(conversationId: string): ControlToolCall[] {
    const rows = this.client.db
      .select()
      .from(controlToolCalls)
      .where(eq(controlToolCalls.conversationId, conversationId))
      .orderBy(controlToolCalls.startedAt)
      .all();
    return rows.map(toToolCall);
  }

  listMutatingToolCalls(): ControlToolCall[] {
    const rows = this.client.db
      .select()
      .from(controlToolCalls)
      .where(
        and(
          eq(controlToolCalls.kind, "mutating"),
          eq(controlToolCalls.status, "succeeded"),
        ),
      )
      .orderBy(desc(controlToolCalls.startedAt))
      .all();
    return rows.map(toToolCall);
  }
}
