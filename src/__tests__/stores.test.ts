import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardStats, Trade } from "@/lib/types";
import type { WorkspaceViewResponse } from "@electron/shared/ipc/dto";

vi.mock("@/lib/exva", () => ({
  api: {
    getWorkspaceView: vi.fn(),
    getStrategy: vi.fn(),
    patchWorkspacePreferences: vi.fn(),
  },
}));

import { api } from "@/lib/exva";
import { useSessionStore } from "@/store/sessionStore";
import { useTradeStore } from "@/store/tradeStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

const mockStats = {
  session_status: "active",
} as unknown as DashboardStats;

const baseTrade = {
  id: "t1",
  symbol: "AAPL",
  status: "open",
} as unknown as Trade;

describe("sessionStore", () => {
  beforeEach(() => {
    useSessionStore.setState({ status: "idle", stats: null });
  });

  it("setStatus updates status", () => {
    useSessionStore.getState().setStatus("active");
    expect(useSessionStore.getState().status).toBe("active");
  });

  it("setStats updates stats", () => {
    useSessionStore.getState().setStats(mockStats);
    expect(useSessionStore.getState().stats).toEqual(mockStats);
  });
});

describe("tradeStore", () => {
  beforeEach(() => {
    useTradeStore.setState({ trades: [], selectedId: null });
  });

  it("upsertTrade prepends new trades", () => {
    useTradeStore.getState().upsertTrade(baseTrade);
    expect(useTradeStore.getState().trades).toEqual([baseTrade]);
  });

  it("upsertTrade merges existing trades in place", () => {
    useTradeStore.getState().setTrades([baseTrade]);
    const updated = { ...baseTrade, symbol: "MSFT" };
    useTradeStore.getState().upsertTrade(updated);
    expect(useTradeStore.getState().trades).toEqual([updated]);
    expect(useTradeStore.getState().trades).toHaveLength(1);
  });
});

describe("workspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      viewMode: "session",
      focusedSessionId: null,
      preferences: null,
      environmentMode: "paper",
      focusedSessionAiReady: null,
    });
    vi.mocked(api.getWorkspaceView).mockReset();
    vi.mocked(api.getStrategy).mockReset();
  });

  it("setViewMode updates mode and focused session", () => {
    useWorkspaceStore.getState().setViewMode("global");
    expect(useWorkspaceStore.getState().viewMode).toBe("global");
    expect(useWorkspaceStore.getState().focusedSessionId).toBeNull();
  });

  it("loadWorkspaceView reflects focus and environment from api", async () => {
    vi.mocked(api.getWorkspaceView).mockResolvedValue({
      workspaceViewMode: "session",
      focusedSessionId: "sess-1",
      preferences: {
        id: 1,
        globalEnvironmentMode: "live",
      } as WorkspaceViewResponse["preferences"],
    });
    vi.mocked(api.getStrategy).mockResolvedValue({
      providers: [{ isConfigured: true }],
    } as Awaited<ReturnType<typeof api.getStrategy>>);

    await useWorkspaceStore.getState().loadWorkspaceView();

    const state = useWorkspaceStore.getState();
    expect(api.getWorkspaceView).toHaveBeenCalledOnce();
    expect(state.viewMode).toBe("session");
    expect(state.focusedSessionId).toBe("sess-1");
    expect(state.environmentMode).toBe("live");
    expect(state.focusedSessionAiReady).toBe(true);
  });
});
