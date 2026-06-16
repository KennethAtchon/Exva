import { create } from "zustand";
import type { ControlScopeKind } from "@/lib/exva";

interface ControlState {
  /** Conversation shared between the full page and the slide-over. */
  activeConversationId: string | null;
  slideOverOpen: boolean;
  /** Default scope when auto-creating a conversation (e.g. from a session screen). */
  pendingScope: { kind: ControlScopeKind; sessionId: string | null } | null;
  setActiveConversation: (id: string | null) => void;
  openSlideOver: (scope?: {
    kind: ControlScopeKind;
    sessionId: string | null;
  }) => void;
  closeSlideOver: () => void;
  toggleSlideOver: () => void;
}

export const useControlStore = create<ControlState>((set) => ({
  activeConversationId: null,
  slideOverOpen: false,
  pendingScope: null,
  setActiveConversation: (id) => set({ activeConversationId: id }),
  openSlideOver: (scope) =>
    set({ slideOverOpen: true, pendingScope: scope ?? null }),
  closeSlideOver: () => set({ slideOverOpen: false }),
  toggleSlideOver: () => set((s) => ({ slideOverOpen: !s.slideOverOpen })),
}));
