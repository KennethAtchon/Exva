import { create } from "zustand";
import type { ControlScopeKind } from "@/lib/exva";

interface ControlState {
  /** Conversation shared between the full page and the slide-over. */
  activeConversationId: string | null;
  slideOverOpen: boolean;
  /** Default scope when auto-creating a conversation (e.g. from a session screen). */
  pendingScope: { kind: ControlScopeKind; sessionId: string | null } | null;
  /** Per-conversation composer drafts (survives panel close). */
  draftsByConversationId: Record<string, string>;
  setActiveConversation: (id: string | null) => void;
  openSlideOver: (scope?: {
    kind: ControlScopeKind;
    sessionId: string | null;
  }) => void;
  closeSlideOver: () => void;
  toggleSlideOver: () => void;
  clearPendingScope: () => void;
  setDraft: (conversationId: string, text: string) => void;
  clearDraft: (conversationId: string) => void;
}

export const useControlStore = create<ControlState>((set) => ({
  activeConversationId: null,
  slideOverOpen: false,
  pendingScope: null,
  draftsByConversationId: {},
  setActiveConversation: (id) => set({ activeConversationId: id }),
  openSlideOver: (scope) =>
    set({ slideOverOpen: true, pendingScope: scope ?? null }),
  closeSlideOver: () => set({ slideOverOpen: false }),
  toggleSlideOver: () => set((s) => ({ slideOverOpen: !s.slideOverOpen })),
  clearPendingScope: () => set({ pendingScope: null }),
  setDraft: (conversationId, text) =>
    set((s) => ({
      draftsByConversationId: {
        ...s.draftsByConversationId,
        [conversationId]: text,
      },
    })),
  clearDraft: (conversationId) =>
    set((s) => {
      if (!(conversationId in s.draftsByConversationId)) return s;
      const { [conversationId]: _removed, ...rest } = s.draftsByConversationId;
      void _removed;
      return { draftsByConversationId: rest };
    }),
}));
