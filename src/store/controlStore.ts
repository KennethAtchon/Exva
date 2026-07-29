import { create } from "zustand";
import type { ControlScopeKind } from "@/lib/exva";
import { api } from "@/lib/exva";

interface ControlUiContext {
  route: string | null;
  selectedSessionId: string | null;
}

interface ControlState {
  /** Conversation shared between the full page and the slide-over. */
  activeConversationId: string | null;
  slideOverOpen: boolean;
  /** Default scope when auto-creating a conversation (e.g. from a session screen). */
  pendingScope: { kind: ControlScopeKind; sessionId: string | null } | null;
  /** Per-conversation composer drafts (survives panel close). */
  draftsByConversationId: Record<string, string>;
  /** Latest UI route + focused session, synced from App for control.send context. */
  uiContext: ControlUiContext;
  /**
   * When on, tool confirmations are auto-approved so the assistant stops asking.
   * Live (real-money) actions are still held back — see useControlConversation.
   */
  autoApproveTools: boolean;
  setActiveConversation: (id: string | null) => void;
  openSlideOver: (scope?: {
    kind: ControlScopeKind;
    sessionId: string | null;
  }) => void;
  closeSlideOver: () => void;
  toggleSlideOver: () => void;
  clearPendingScope: () => void;
  setUiContext: (ctx: ControlUiContext) => void;
  setAutoApproveTools: (on: boolean) => Promise<void>;
  setDraft: (conversationId: string, text: string) => void;
  clearDraft: (conversationId: string) => void;
}

export const useControlStore = create<ControlState>((set, get) => ({
  activeConversationId: null,
  slideOverOpen: false,
  pendingScope: null,
  draftsByConversationId: {},
  uiContext: { route: null, selectedSessionId: null },
  autoApproveTools: false,
  setActiveConversation: (id) => set({ activeConversationId: id }),
  openSlideOver: (scope) =>
    set({ slideOverOpen: true, pendingScope: scope ?? null }),
  closeSlideOver: () => set({ slideOverOpen: false }),
  toggleSlideOver: () => set((s) => ({ slideOverOpen: !s.slideOverOpen })),
  clearPendingScope: () => set({ pendingScope: null }),
  setUiContext: (uiContext) => set({ uiContext }),
  setAutoApproveTools: async (autoApproveTools) => {
    const previous = get().autoApproveTools;
    set({ autoApproveTools });
    try {
      await api.patchWorkspacePreferences({
        autoApproveAssistantTools: autoApproveTools,
      });
    } catch (error) {
      set({ autoApproveTools: previous });
      throw error;
    }
  },
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
