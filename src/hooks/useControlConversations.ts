import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/exva";
import type { ControlConversationSummary, ControlScopeKind } from "@/lib/exva";
import { useControlStore } from "@/store/controlStore";

export function useControlConversations(options?: { autoCreate?: boolean }) {
  const autoCreate = options?.autoCreate ?? false;
  const [conversations, setConversations] = useState<
    ControlConversationSummary[]
  >([]);
  const [loading, setLoading] = useState(true);
  const activeId = useControlStore((s) => s.activeConversationId);
  const setActive = useControlStore((s) => s.setActiveConversation);

  const refresh = useCallback(async () => {
    const result = await api.control.listConversations();
    setConversations(result.conversations);
    return result.conversations;
  }, []);

  const createNew = useCallback(
    async (scope?: { kind: ControlScopeKind; sessionId: string | null }) => {
      const { conversation } = await api.control.createConversation({
        scopeKind: scope?.kind ?? "workspace",
        scopeSessionId: scope?.sessionId ?? null,
      });
      await refresh();
      setActive(conversation.id);
      return conversation.id;
    },
    [refresh, setActive],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.control.deleteConversation(id);
      const next = await refresh();
      if (activeId === id) {
        setActive(next[0]?.id ?? null);
      }
    },
    [refresh, activeId, setActive],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      await api.control.renameConversation({ id, title });
      await refresh();
    },
    [refresh],
  );

  // Ensure an active conversation exists once the list is known.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const list = await refresh();
      if (cancelled) return;
      const current = useControlStore.getState().activeConversationId;
      if (!current || !list.some((c) => c.id === current)) {
        if (list.length > 0) {
          setActive(list[0].id);
        } else if (autoCreate) {
          await createNew();
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // reason: run once per autoCreate activation; createNew/refresh are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCreate]);

  return {
    conversations,
    loading,
    activeId,
    setActive,
    refresh,
    createNew,
    remove,
    rename,
  };
}
