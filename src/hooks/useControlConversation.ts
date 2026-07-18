import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/exva";
import type {
  ControlConversation,
  ControlMessage,
  ControlToolCall,
} from "@/lib/exva";
import type { CapabilityRisk } from "@electron/shared/domain/control";
import { useExvaEvent } from "@/hooks/useExvaEvent";

export interface ToolItemConfirm {
  preview: string;
  inputJson: string;
  alwaysConfirm: boolean;
  confirmClass: string | null;
  risk: CapabilityRisk | null;
  outOfScope: boolean;
}

export type ControlItem =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant" | "system";
      content: string;
      status: "complete" | "streaming" | "cancelled" | "error";
      createdAt?: string;
    }
  | {
      kind: "tool";
      id: string;
      capability: string;
      label: string;
      toolKind: "read" | "mutating";
      summary: string;
      inputJson: string;
      status:
        | "running"
        | "awaiting_confirm"
        | "succeeded"
        | "rejected"
        | "failed";
      resultSummary?: string;
      resultJson?: string | null;
      confirm?: ToolItemConfirm;
    };

export function heuristicConversationTitle(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New conversation";
  if (cleaned.length <= 48) return cleaned;
  return `${cleaned.slice(0, 45).trimEnd()}…`;
}

function isLiveAssistantId(id: string): boolean {
  return id === "live-assistant" || id.startsWith("live-");
}

function dropLiveAssistantItems(prev: ControlItem[]): ControlItem[] {
  return prev.filter((item) => !isLiveAssistantId(item.id));
}

function summarizeResultValue(result: unknown): string | null {
  if (result == null) return null;
  if (typeof result === "string" && result.trim()) return result.trim();
  if (typeof result === "number" || typeof result === "boolean") {
    return String(result);
  }
  if (Array.isArray(result)) {
    return `${result.length} item${result.length === 1 ? "" : "s"}`;
  }
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (obj.rejected === true) return "Skipped by operator.";
    if (typeof obj.error === "string") return `Failed: ${obj.error}`;
    for (const key of ["summary", "message", "status", "name", "id"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    const keys = Object.keys(obj);
    if (keys.length === 0) return null;
    if (keys.length <= 3) {
      const parts = keys
        .map((k) => {
          const v = obj[k];
          if (v == null || typeof v === "object") return null;
          return `${k}: ${String(v)}`;
        })
        .filter((p): p is string => p != null);
      if (parts.length > 0) return parts.join(" · ");
    }
    return `${keys.length} fields`;
  }
  return null;
}

function deriveResultSummary(call: ControlToolCall): string | undefined {
  if (call.status === "rejected") return "Skipped by operator.";
  if (call.status === "failed") {
    try {
      const parsed = call.resultJson ? JSON.parse(call.resultJson) : null;
      const err = parsed?.error;
      return typeof err === "string" ? `Failed: ${err}` : "Failed.";
    } catch {
      return "Failed.";
    }
  }
  if (call.status === "succeeded") {
    try {
      const parsed = call.resultJson ? JSON.parse(call.resultJson) : null;
      return summarizeResultValue(parsed) ?? "Done.";
    } catch {
      return "Done.";
    }
  }
  return undefined;
}

function humanizeCapability(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Best-effort one-line summary from persisted tool input (describe() is not stored). */
function summarizeInputJson(inputJson: string): string | null {
  try {
    const parsed = JSON.parse(inputJson) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return null;
    const preferred = ["session", "name", "tradeId", "id", "symbol", "source"];
    const parts: string[] = [];
    for (const key of preferred) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) {
        parts.push(`${key} ${value.trim()}`);
      }
    }
    if (parts.length > 0) return parts.slice(0, 2).join(", ");
    return null;
  } catch {
    return null;
  }
}

function mapServerItems(
  messages: ControlMessage[],
  toolCalls: ControlToolCall[],
): ControlItem[] {
  const items: Array<{ at: string; item: ControlItem }> = [];
  for (const m of messages) {
    items.push({
      at: m.createdAt,
      item: {
        kind: "message",
        id: m.id,
        role: m.role,
        content: m.content,
        status: m.status,
        createdAt: m.createdAt,
      },
    });
  }
  for (const c of toolCalls) {
    const label = humanizeCapability(c.capability);
    const inputSummary = summarizeInputJson(c.inputJson);
    items.push({
      at: c.startedAt,
      item: {
        kind: "tool",
        id: c.id,
        capability: c.capability,
        label,
        toolKind: c.kind,
        summary: inputSummary ?? label,
        inputJson: c.inputJson,
        status: c.status,
        resultSummary: deriveResultSummary(c),
        resultJson: c.resultJson,
      },
    });
  }
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return items.map((entry) => entry.item);
}

export function useControlConversation(conversationId: string | null) {
  const [conversation, setConversation] = useState<ControlConversation | null>(
    null,
  );
  const [items, setItems] = useState<ControlItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const idRef = useRef(conversationId);
  idRef.current = conversationId;

  const refetch = useCallback(async () => {
    if (!conversationId) {
      setConversation(null);
      setItems([]);
      return;
    }
    const detail = await api.control.getConversation(conversationId);
    if (idRef.current !== conversationId) return;
    setConversation(detail.conversation);
    setItems(mapServerItems(detail.messages, detail.toolCalls));
  }, [conversationId]);

  useEffect(() => {
    setStreaming(false);
    setError(null);
    if (!conversationId) {
      setConversation(null);
      setItems([]);
      return;
    }
    setLoading(true);
    void refetch().finally(() => setLoading(false));
  }, [conversationId, refetch]);

  const upsertTool = useCallback(
    (
      id: string,
      update: (
        prev?: Extract<ControlItem, { kind: "tool" }>,
      ) => Extract<ControlItem, { kind: "tool" }>,
    ) => {
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.kind === "tool" && i.id === id);
        if (idx === -1) {
          return [...prev, update()];
        }
        const next = [...prev];
        next[idx] = update(next[idx] as Extract<ControlItem, { kind: "tool" }>);
        return next;
      });
    },
    [],
  );

  useExvaEvent(
    "control_tool_call",
    useCallback(
      (p) => {
        if (p.conversationId !== idRef.current) return;
        upsertTool(p.toolCallId, (prev) => ({
          kind: "tool",
          id: p.toolCallId,
          capability: p.capability,
          label: p.label,
          toolKind: p.kind,
          summary: p.summary,
          inputJson: p.inputJson,
          status: p.status,
          resultSummary: prev?.resultSummary,
          resultJson: prev?.resultJson,
          confirm: prev?.confirm,
        }));
      },
      [upsertTool],
    ),
  );

  useExvaEvent(
    "control_confirmation_required",
    useCallback(
      (p) => {
        if (p.conversationId !== idRef.current) return;
        upsertTool(p.toolCallId, (prev) => ({
          kind: "tool",
          id: p.toolCallId,
          capability: p.capability,
          label: p.label,
          toolKind: "mutating",
          summary: prev?.summary ?? p.preview,
          inputJson: p.inputJson,
          status: "awaiting_confirm",
          resultSummary: undefined,
          resultJson: undefined,
          confirm: {
            preview: p.preview,
            inputJson: p.inputJson,
            alwaysConfirm: p.alwaysConfirm,
            confirmClass: p.confirmClass,
            risk: p.risk,
            outOfScope: p.outOfScope,
          },
        }));
      },
      [upsertTool],
    ),
  );

  useExvaEvent(
    "control_tool_result",
    useCallback(
      (p) => {
        if (p.conversationId !== idRef.current) return;
        upsertTool(p.toolCallId, (prev) => ({
          kind: "tool",
          id: p.toolCallId,
          capability: prev?.capability ?? "",
          label: prev?.label ?? "",
          toolKind: prev?.toolKind ?? "mutating",
          summary: prev?.summary ?? "",
          inputJson: prev?.inputJson ?? "{}",
          status: p.status,
          resultSummary: p.resultSummary,
          resultJson: p.resultJson,
          confirm: undefined,
        }));
      },
      [upsertTool],
    ),
  );

  useExvaEvent(
    "control_delta",
    useCallback((p) => {
      if (p.conversationId !== idRef.current) return;
      const liveId = `live-${p.turnId}`;
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === liveId);
        const item: ControlItem = {
          kind: "message",
          id: liveId,
          role: "assistant",
          content: p.text,
          status: "streaming",
        };
        if (idx === -1) return [...prev, item];
        const next = [...prev];
        next[idx] = item;
        return next;
      });
    }, []),
  );

  useExvaEvent(
    "control_turn_complete",
    useCallback(
      (p) => {
        if (p.conversationId !== idRef.current) return;
        setStreaming(false);
        setItems(dropLiveAssistantItems);
        void refetch();
      },
      [refetch],
    ),
  );

  useExvaEvent(
    "control_error",
    useCallback(
      (p) => {
        if (p.conversationId !== idRef.current) return;
        setStreaming(false);
        setError(p.message);
        setItems(dropLiveAssistantItems);
        void refetch();
      },
      [refetch],
    ),
  );

  const send = useCallback(
    async (message: string, opts?: { replaceId?: string }) => {
      if (!conversationId || !message.trim()) return;
      const text = message.trim();
      const tempId = opts?.replaceId ?? `temp-${Date.now()}`;
      setError(null);
      setItems((prev) => {
        const base = opts?.replaceId
          ? prev.filter((i) => i.id !== opts.replaceId)
          : prev;
        return [
          ...base,
          {
            kind: "message",
            id: tempId,
            role: "user",
            content: text,
            status: "complete",
          },
        ];
      });
      setStreaming(true);
      try {
        await api.control.send({ conversationId, message: text });
        // Heuristic auto-title after the first user message (avoids a cheap LLM round-trip).
        if (
          conversation?.title === "New conversation" ||
          conversation?.title.trim() === ""
        ) {
          const title = heuristicConversationTitle(text);
          try {
            await api.control.renameConversation({ id: conversationId, title });
            setConversation((prev) => (prev ? { ...prev, title } : prev));
          } catch {
            // Title is cosmetic; ignore rename failures.
          }
        }
      } catch (e) {
        setStreaming(false);
        setError(e instanceof Error ? e.message : "Failed to send.");
        setItems((prev) =>
          prev.map((item) =>
            item.kind === "message" && item.id === tempId
              ? { ...item, status: "error" }
              : item,
          ),
        );
      }
    },
    [conversationId, conversation?.title],
  );

  const confirm = useCallback(
    async (toolCallId: string, alwaysApprove?: boolean) => {
      if (!conversationId) return;
      let snapshot: ToolItemConfirm | undefined;
      upsertTool(toolCallId, (prev) => {
        snapshot = prev?.confirm;
        return {
          ...(prev as Extract<ControlItem, { kind: "tool" }>),
          status: "running",
          // Keep confirm so the card can show "Applying…" until IPC settles.
          confirm: prev?.confirm,
        };
      });
      try {
        await api.control.confirm({
          conversationId,
          toolCallId,
          alwaysApprove,
        });
        upsertTool(toolCallId, (prev) => ({
          ...(prev as Extract<ControlItem, { kind: "tool" }>),
          status: "running",
          confirm: undefined,
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to confirm.");
        upsertTool(toolCallId, (prev) => ({
          ...(prev as Extract<ControlItem, { kind: "tool" }>),
          status: "awaiting_confirm",
          confirm: snapshot ?? prev?.confirm,
        }));
      }
    },
    [conversationId, upsertTool],
  );

  const reject = useCallback(
    async (toolCallId: string) => {
      if (!conversationId) return;
      let snapshot: ToolItemConfirm | undefined;
      upsertTool(toolCallId, (prev) => {
        snapshot = prev?.confirm;
        return {
          ...(prev as Extract<ControlItem, { kind: "tool" }>),
          status: "rejected",
          confirm: prev?.confirm,
        };
      });
      try {
        await api.control.reject({ conversationId, toolCallId });
        upsertTool(toolCallId, (prev) => ({
          ...(prev as Extract<ControlItem, { kind: "tool" }>),
          status: "rejected",
          confirm: undefined,
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to reject.");
        upsertTool(toolCallId, (prev) => ({
          ...(prev as Extract<ControlItem, { kind: "tool" }>),
          status: "awaiting_confirm",
          confirm: snapshot ?? prev?.confirm,
        }));
      }
    },
    [conversationId, upsertTool],
  );

  const cancel = useCallback(async () => {
    if (!conversationId) return;
    try {
      await api.control.cancel(conversationId);
      setStreaming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel.");
    }
  }, [conversationId]);

  return {
    conversation,
    items,
    streaming,
    error,
    loading,
    send,
    confirm,
    reject,
    cancel,
    refetch,
  };
}
