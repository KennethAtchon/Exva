import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBridge = vi.hoisted(() => {
  const bridge = {
    dashboard: {
      getStats: vi.fn().mockResolvedValue({ session_status: "idle" }),
      getCostBreakdown: vi.fn().mockResolvedValue({}),
    },
    session: {
      start: vi.fn().mockResolvedValue({ status: "active" }),
      pause: vi.fn().mockResolvedValue({ status: "paused" }),
      list: vi.fn().mockResolvedValue({ sessions: [] }),
    },
    trades: {
      listActive: vi.fn().mockResolvedValue([]),
      getDetail: vi.fn().mockResolvedValue({}),
    },
    workspace: {
      getView: vi.fn().mockResolvedValue({}),
      patchPreferences: vi.fn().mockResolvedValue({}),
    },
    approvals: {
      list: vi.fn().mockResolvedValue({ approvals: [] }),
    },
    events: {
      subscribe: vi.fn().mockResolvedValue(() => {}),
    },
  };
  vi.stubGlobal("window", { exva: bridge });
  return bridge;
});

import { api } from "@/lib/exva";

describe("exva api bridge contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getDashboardStats delegates to dashboard.getStats", async () => {
    await api.getDashboardStats();
    expect(mockBridge.dashboard.getStats).toHaveBeenCalledOnce();
  });

  it("getCostBreakdown delegates with default date range", async () => {
    await api.getCostBreakdown();
    expect(mockBridge.dashboard.getCostBreakdown).toHaveBeenCalledWith("today");
  });

  it("startSession delegates to session.start", async () => {
    await api.startSession();
    expect(mockBridge.session.start).toHaveBeenCalledOnce();
  });

  it("pauseSession delegates to session.pause", async () => {
    await api.pauseSession();
    expect(mockBridge.session.pause).toHaveBeenCalledOnce();
  });

  it("getActiveTrades delegates to trades.listActive", async () => {
    await api.getActiveTrades({ sessionId: "s1" });
    expect(mockBridge.trades.listActive).toHaveBeenCalledWith({
      sessionId: "s1",
    });
  });

  it("getWorkspaceView delegates to workspace.getView", async () => {
    await api.getWorkspaceView();
    expect(mockBridge.workspace.getView).toHaveBeenCalledOnce();
  });

  it("listApprovals delegates to approvals.list", async () => {
    await api.listApprovals({ status: "pending" });
    expect(mockBridge.approvals.list).toHaveBeenCalledWith({
      status: "pending",
    });
  });
});
