import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channels } from "@electron/shared/ipc/channels";
import {
  createMinimalSession,
  insertBrokerAccount,
  insertTrade,
  insertAgentRun,
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

describe("trades IPC handlers", () => {
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

  it("trades:list-active filters trades by workspace execution mode", async () => {
    const paperSession = createMinimalSession(db, {
      name: "Paper",
      executionMode: "paper_only",
    });
    const liveSession = createMinimalSession(db, {
      name: "Live",
      executionMode: "live_allowed",
    });
    const paperBroker = insertBrokerAccount(db, { id: "broker-paper" });
    const liveBroker = insertBrokerAccount(db, {
      id: "broker-live",
      mode: "live",
    });

    insertTrade(db, {
      id: "trade-paper",
      sessionId: paperSession.id,
      brokerAccountId: paperBroker.id,
      instrumentSymbol: "NVDA",
      status: "open",
    });
    insertTrade(db, {
      id: "trade-live",
      sessionId: liveSession.id,
      brokerAccountId: liveBroker.id,
      instrumentSymbol: "AAPL",
      status: "open",
    });

    const paperWorkspace = await invokeIpc<Array<{ id: string }>>(
      channels.trades.listActive,
      {},
    );
    expect(paperWorkspace.map((trade) => trade.id)).toEqual(["trade-paper"]);

    harness.services.repos.workspacePreferences.update({
      globalEnvironmentMode: "live",
    });

    const liveWorkspace = await invokeIpc<Array<{ id: string }>>(
      channels.trades.listActive,
      {},
    );
    expect(liveWorkspace.map((trade) => trade.id)).toEqual(["trade-live"]);
  });

  it("trades:get-detail returns trade detail with agent traces", async () => {
    const session = createMinimalSession(db);
    const broker = insertBrokerAccount(db, { id: "broker-1" });
    insertTrade(db, {
      id: "trade-detail",
      sessionId: session.id,
      brokerAccountId: broker.id,
      status: "open",
    });
    insertAgentRun(db, {
      id: "run-1",
      session_id: session.id,
      trade_id: "trade-detail",
      cycle_id: "cycle-1",
    });

    const detail = await invokeIpc<{
      trade: { id: string };
      runs: Array<{ id: string }>;
      messages: unknown[];
    }>(channels.trades.getDetail, { tradeId: "trade-detail" });

    expect(detail.trade.id).toBe("trade-detail");
    expect(detail.runs.map((run) => run.id)).toEqual(["run-1"]);
  });

  it("trades:force-close closes an open trade and emits trade_closed", async () => {
    const session = createMinimalSession(db);
    const broker = insertBrokerAccount(db, { id: "broker-close" });
    insertTrade(db, {
      id: "trade-close",
      sessionId: session.id,
      brokerAccountId: broker.id,
      broker_order_id: "order-1",
      status: "open",
    });

    const closedEvents: unknown[] = [];
    harness.eventBus.on("trade_closed", (payload) => {
      closedEvents.push(payload);
    });

    await invokeIpc(channels.trades.forceClose, { tradeId: "trade-close" });

    expect(harness.services.repos.trades.require("trade-close").status).toBe(
      "closed",
    );
    expect(closedEvents).toHaveLength(1);
  });

  it("trades:approve rejects a pending approval through the approval flow", async () => {
    const session = createMinimalSession(db);
    const broker = insertBrokerAccount(db, { id: "broker-approve" });
    insertTrade(db, {
      id: "trade-approve",
      sessionId: session.id,
      brokerAccountId: broker.id,
      status: "pending",
    });
    const approvals = new TradeApprovalsRepo(db);
    const pending = approvals.createPending({
      sessionId: session.id,
      tradeId: "trade-approve",
      brokerAccountId: broker.id,
      instrumentSymbol: "NVDA",
      instrumentClass: "stock",
      proposedSide: "BUY",
      proposedSizeUsd: 500,
      decisionSummaryJson: '{"confidence":0.75}',
    });

    const resolvedEvents: unknown[] = [];
    harness.eventBus.on("approval_resolved", (payload) => {
      resolvedEvents.push(payload);
    });

    const result = await invokeIpc<{ status: string }>(
      channels.trades.approve,
      {
        tradeId: "trade-approve",
        approved: false,
      },
    );

    expect(result?.status).toBe("rejected");
    expect(approvals.require(pending.id).status).toBe("rejected");
    expect(harness.services.repos.trades.require("trade-approve").status).toBe(
      "rejected",
    );
    expect(resolvedEvents).toHaveLength(1);
  });

  it("trades:get-detail rejects invalid payloads", async () => {
    const error = await invokeIpcError(channels.trades.getDetail, {});

    expect(error.message.length).toBeGreaterThan(0);
  });
});
