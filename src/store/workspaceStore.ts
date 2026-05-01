import { create } from "zustand";
import type { WorkspacePreferences, WorkspaceViewMode } from "@/lib/types";
import { api } from "@/lib/exva";

interface WorkspaceState {
  viewMode: WorkspaceViewMode;
  focusedSessionId: string | null;
  preferences: WorkspacePreferences | null;
  setViewMode: (mode: WorkspaceViewMode, focusedSessionId?: string | null) => void;
  setPreferences: (prefs: WorkspacePreferences) => void;
  loadWorkspaceView: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  viewMode: "session",
  focusedSessionId: null,
  preferences: null,
  setViewMode: (viewMode, focusedSessionId = null) => set({ viewMode, focusedSessionId }),
  setPreferences: (preferences) => set({ preferences }),
  loadWorkspaceView: async () => {
    const view = await api.getWorkspaceView();
    set({
      viewMode: view.workspaceViewMode,
      focusedSessionId: view.focusedSessionId,
      preferences: view.preferences,
    });
  },
}));
