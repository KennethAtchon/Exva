import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { channels } from "@electron/shared/ipc/channels";
import {
  createMinimalSession,
  insertAgentRun,
  insertTrade,
} from "../../db/test-fixtures";
import {
  createIpcTestServices,
  invokeIpc,
  registerIpcTestHandlers,
  type IpcTestContext,
} from "./ipc-test-harness";

describe("dashboard IPC", () => {
  let ctx: IpcTestContext;

  beforeEach(() => {
    ctx = createIpcTestServices();
    registerIpcTestHandlers(ctx.services);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("dashboard:get-stats returns stats aligned with DB session state", async () => {
    const session = createMinimalSession(ctx.db, {
      executionMode: "paper_only",
    });
    ctx.services.repos.session.setFocus(session.id);
    ctx.services.repos.session.setStatus("idle", session.id);

    insertTrade(ctx.db, {
      id: "trade-open",
      sessionId: session.id,
      status: "open",
      final_pnl_usd: null,
      created_at: new Date().toISOString(),
    });
    insertAgentRun(ctx.db, {
      id: "run-today",
      session_id: session.id,
      cost_usd: 1.25,
      created_at: new Date().toISOString(),
    });

    const stats = (await invokeIpc(channels.dashboard.getStats)) as {
      session_status: string;
      open_trades: number;
      portfolio_value_source: string;
      portfolio_broker_count: number;
    };

    expect(stats.session_status).toBe("idle");
    expect(stats.open_trades).toBe(1);
    expect(stats.portfolio_value_source).toBe("broker");
    expect(stats.portfolio_broker_count).toBe(0);
  });

  it("dashboard:get-cost-breakdown aggregates agent costs for focused session", async () => {
    const session = createMinimalSession(ctx.db, {
      executionMode: "paper_only",
    });
    ctx.services.repos.session.setFocus(session.id);

    insertAgentRun(ctx.db, {
      id: "run-selector",
      session_id: session.id,
      agent_type: "selector",
      model: "openai/gpt-4o-mini",
      cost_usd: 0.75,
      created_at: new Date().toISOString(),
    });
    insertAgentRun(ctx.db, {
      id: "run-decision",
      session_id: session.id,
      agent_type: "decision",
      model: "openai/gpt-4o-mini",
      cost_usd: 1.25,
      created_at: new Date().toISOString(),
    });

    const breakdown = (await invokeIpc(channels.dashboard.getCostBreakdown, {
      dateRange: "today",
    })) as {
      total: number;
      by_agent: Array<{ name: string; cost: number }>;
    };

    expect(breakdown.total).toBeCloseTo(2, 5);
    expect(breakdown.by_agent.length).toBeGreaterThan(0);
    expect(
      breakdown.by_agent.reduce((sum, row) => sum + Number(row.cost ?? 0), 0),
    ).toBeCloseTo(2, 5);
  });
});
