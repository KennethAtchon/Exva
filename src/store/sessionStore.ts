import { create } from "zustand";
import type { DashboardStats, SessionStatus } from "@/lib/types";

interface SessionState {
  status: SessionStatus;
  stats: DashboardStats | null;
  setStatus: (s: SessionStatus) => void;
  setStats: (s: DashboardStats | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: "idle",
  stats: null,
  setStatus: (status) => set({ status }),
  setStats: (stats) => set({ stats }),
}));
