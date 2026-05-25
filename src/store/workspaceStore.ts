import { create } from "zustand";
import type { WorkspacePreferences, WorkspaceViewMode } from "@/lib/types";
import { api } from "@/lib/exva";
import { clearWorkspaceEnvironmentCache } from "@/lib/workspace-environment-cache";

interface WorkspaceState {
  viewMode: WorkspaceViewMode;
  focusedSessionId: string | null;
  preferences: WorkspacePreferences | null;
  environmentMode: "paper" | "live";
  /** null = unknown/loading, true = all roles connected, false = one or more unconnected */
  focusedSessionAiReady: boolean | null;
  setViewMode: (
    mode: WorkspaceViewMode,
    focusedSessionId?: string | null,
  ) => void;
  setPreferences: (prefs: WorkspacePreferences) => void;
  setEnvironmentMode: (mode: "paper" | "live") => Promise<void>;
  loadWorkspaceView: () => Promise<void>;
  checkAiReady: (sessionId: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  viewMode: "session",
  focusedSessionId: null,
  preferences: null,
  environmentMode: "paper",
  focusedSessionAiReady: null,
  setViewMode: (viewMode, focusedSessionId = null) => {
    set({ viewMode, focusedSessionId, focusedSessionAiReady: null });
    if (focusedSessionId) void get().checkAiReady(focusedSessionId);
  },
  setPreferences: (preferences) => set({ preferences }),
  setEnvironmentMode: async (mode) => {
    const previousMode = get().environmentMode;
    const previousPreferences = get().preferences;
    clearWorkspaceEnvironmentCache();
    set({
      environmentMode: mode,
      preferences: previousPreferences
        ? { ...previousPreferences, globalEnvironmentMode: mode }
        : null,
    });
    try {
      const preferences = await api.patchWorkspacePreferences({
        globalEnvironmentMode: mode,
      });
      set({
        preferences,
        environmentMode: preferences.globalEnvironmentMode ?? mode,
      });
      await get().loadWorkspaceView();
    } catch (error) {
      clearWorkspaceEnvironmentCache();
      set({
        environmentMode: previousMode,
        preferences: previousPreferences,
      });
      throw error;
    }
  },
  loadWorkspaceView: async () => {
    const view = await api.getWorkspaceView();
    set({
      viewMode: view.workspaceViewMode,
      focusedSessionId: view.focusedSessionId,
      preferences: view.preferences,
      environmentMode: view.preferences.globalEnvironmentMode ?? "paper",
      focusedSessionAiReady: null,
    });
    if (view.focusedSessionId) {
      try {
        const strategy = await api.getStrategy(view.focusedSessionId);
        set({
          focusedSessionAiReady: strategy.providers.some((p) => p.isConfigured),
        });
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
      set({
        focusedSessionAiReady: strategy.providers.some((p) => p.isConfigured),
      });
    } catch {
      set({ focusedSessionAiReady: false });
    }
  },
}));
