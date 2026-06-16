import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/exva";
import type {
  ControlConversation,
  ControlMessage,
  ControlToolCall,
} from "@/lib/exva";
import { useExvaEvent } from "@/hooks/useExvaEvent";

export interface ToolItemConfirm {
  preview: string;
  inputJson: string;
  alwaysConfirm: boolean;
  confirmClass: string | null;
  risk: string | null;
}

export type ControlItem =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant" | "system";
      content: string;
      status: "complete" | "streaming" | "cancelled" | "error";
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

function deriveResultSummary(call: ControlToolCall): string | undefined {
  if (call.status === "succeeded") return "Done.";
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
  return undefined;
}

function humanizeCapability(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
      },
    });
  }
  for (const c of toolCalls) {
    items.push({
      at: c.startedAt,
      item: {
        kind: "tool",
        id: c.id,
        capability: c.capability,
        label: humanizeCapability(c.capability),
        toolKind: c.kind,
        summary: humanizeCapability(c.capability),
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
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === "live-assistant");
        const item: ControlItem = {
          kind: "message",
          id: "live-assistant",
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
        void refetch();
      },
      [refetch],
    ),
  );

  const send = useCallback(
    async (message: string) => {
      if (!conversationId || !message.trim()) return;
      setError(null);
      setItems((prev) => [
        ...prev,
        {
          kind: "message",
          id: `temp-${Date.now()}`,
          role: "user",
          content: message.trim(),
          status: "complete",
        },
      ]);
      setStreaming(true);
      try {
        await api.control.send({ conversationId, message: message.trim() });
      } catch (e) {
        setStreaming(false);
        setError(e instanceof Error ? e.message : "Failed to send.");
        void refetch();
      }
    },
    [conversationId, refetch],
  );

  const confirm = useCallback(
    async (toolCallId: string, alwaysApprove?: boolean) => {
      if (!conversationId) return;
      upsertTool(toolCallId, (prev) => ({
        ...(prev as Extract<ControlItem, { kind: "tool" }>),
        status: "running",
        confirm: undefined,
      }));
      await api.control.confirm({ conversationId, toolCallId, alwaysApprove });
    },
    [conversationId, upsertTool],
  );

  const reject = useCallback(
    async (toolCallId: string) => {
      if (!conversationId) return;
      await api.control.reject({ conversationId, toolCallId });
    },
    [conversationId],
  );

  const cancel = useCallback(async () => {
    if (!conversationId) return;
    await api.control.cancel(conversationId);
    setStreaming(false);
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
