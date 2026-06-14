import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channels } from "@electron/shared/ipc/channels";
import {
  createMinimalSession,
  insertBrokerAccount,
  insertTrade,
} from "../../db/test-fixtures";
import { createTestDb } from "../../db/test-helpers";
import { TradeApprovalsRepo } from "../../db/repositories/trades/trade-approvals-repo";
import {
  createIpcTestServices,
  invokeIpc,
  invokeIpcError,
  registerPhase4IpcHandlers,
  resetIpcHandlers,
} from "./ipc-test-harness";

describe("approvals IPC handlers", () => {
  let db = createTestDb();
  let harness = createIpcTestServices(db);

  beforeEach(() => {
    db = createTestDb();
    harness = createIpcTestServices(db);
    resetIpcHandlers();
    registerPhase4IpcHandlers(harness.services);
    harness.configureAiProvider();
  });

  afterEach(() => {
    harness.cleanup();
    resetIpcHandlers();
    vi.restoreAllMocks();
  });

  function seedPendingApproval() {
    const session = createMinimalSession(db, { name: "Approval Session" });
    harness.services.repos.session.setFocus(session.id);
    const broker = insertBrokerAccount(db, { id: "broker-approval" });
    insertTrade(db, {
      id: "trade-pending",
      sessionId: session.id,
      brokerAccountId: broker.id,
      status: "pending",
    });
    const approvals = new TradeApprovalsRepo(db);
    const pending = approvals.createPending({
      sessionId: session.id,
      tradeId: "trade-pending",
      brokerAccountId: broker.id,
      instrumentSymbol: "NVDA",
      instrumentClass: "stock",
      proposedSide: "BUY",
      proposedSizeUsd: 750,
      decisionSummaryJson: '{"confidence":0.82}',
    });
    return { session, pending };
  }

  it("approval:list returns pending approvals for the focused session", async () => {
    const { pending } = seedPendingApproval();

    const result = await invokeIpc<{
      workspaceViewMode: string;
      approvals: Array<{ id: string; confidenceScore?: number }>;
    }>(channels.approvals.list, { status: "pending" });

    expect(result.workspaceViewMode).toBe("session");
    expect(result.approvals.map((row) => row.id)).toEqual([pending.id]);
    expect(result.approvals[0]?.confidenceScore).toBe(0.82);
  });

  it("approval:decide rejects a pending approval and updates trade status", async () => {
    const { pending } = seedPendingApproval();

    const resolvedEvents: unknown[] = [];
    harness.eventBus.on("approval_resolved", (payload) => {
      resolvedEvents.push(payload);
    });

    const result = await invokeIpc<{ status: string }>(
      channels.approvals.decide,
      {
        id: pending.id,
        decision: "rejected",
        decisionNote: "Too risky",
      },
    );

    expect(result.status).toBe("rejected");
    expect(
      harness.services.repos.tradeApprovals.require(pending.id).status,
    ).toBe("rejected");
    expect(harness.services.repos.trades.require("trade-pending").status).toBe(
      "rejected",
    );
    expect(resolvedEvents).toHaveLength(1);
  });

  it("approval:decide requires an active runtime before approving", async () => {
    const { pending } = seedPendingApproval();

    const error = await invokeIpcError(channels.approvals.decide, {
      id: pending.id,
      decision: "approved",
    });

    expect(error.code).toBe("SESSION_NOT_ACTIVE");
  });

  it("approval:decide approves when a session runtime is available", async () => {
    const { session, pending } = seedPendingApproval();
    const enqueueSpy = vi
      .spyOn(harness.services.runtimeManager, "enqueueApprovalRecheck")
      .mockResolvedValue(undefined);
    vi.spyOn(harness.services.runtimeManager, "get").mockReturnValue({
      status: "active",
      orchestrator: {
        hasApprovalCallback: () => false,
        resolveApproval: vi.fn(),
      },
    } as never);

    const result = await invokeIpc<{ status: string }>(
      channels.approvals.decide,
      {
        id: pending.id,
        decision: "approved",
      },
    );

    expect(result.status).toBe("approved");
    expect(
      harness.services.repos.tradeApprovals.require(pending.id).status,
    ).toBe("approved");
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        approvalId: pending.id,
      }),
    );
  });
});
