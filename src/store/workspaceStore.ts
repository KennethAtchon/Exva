import { create } from "zustand";
import type { WorkspacePreferences, WorkspaceViewMode } from "@/lib/types";
import { api } from "@/lib/exva";

interface WorkspaceState {
  viewMode: WorkspaceViewMode;
  focusedSessionId: string | null;
  preferences: WorkspacePreferences | null;
  /** null = unknown/loading, true = all roles connected, false = one or more unconnected */
  focusedSessionAiReady: boolean | null;
  setViewMode: (mode: WorkspaceViewMode, focusedSessionId?: string | null) => void;
  setPreferences: (prefs: WorkspacePreferences) => void;
  loadWorkspaceView: () => Promise<void>;
  checkAiReady: (sessionId: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  viewMode: "session",
  focusedSessionId: null,
  preferences: null,
  focusedSessionAiReady: null,
  setViewMode: (viewMode, focusedSessionId = null) => set({ viewMode, focusedSessionId, focusedSessionAiReady: null }),
  setPreferences: (preferences) => set({ preferences }),
  loadWorkspaceView: async () => {
    const view = await api.getWorkspaceView();
    set({
      viewMode: view.workspaceViewMode,
      focusedSessionId: view.focusedSessionId,
      preferences: view.preferences,
      focusedSessionAiReady: null,
    });
    if (view.focusedSessionId) {
      try {
        const strategy = await api.getStrategy(view.focusedSessionId);
        set({ focusedSessionAiReady: strategy.providers.some((p) => p.isConfigured) });
      } catch {
        set({ focusedSessionAiReady: false });
      }
    } else {
      set({ focusedSessionAiReady: null });
    }
  },
  checkAiReady: async (sessionId) => {
    set({ focusedSessionAiReady: null });
    try {
      const strategy = await api.getStrategy(sessionId);
      set({ focusedSessionAiReady: strategy.providers.some((p) => p.isConfigured) });
    } catch {
      set({ focusedSessionAiReady: false });
    }
  },
}));
