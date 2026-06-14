import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import {
  createMinimalSession,
  insertAgentRun,
  insertTrade,
} from "../../test-fixtures";
import { AgentMessagesRepo } from "./agent-messages-repo";
import { AgentRunsRepo } from "./agent-runs-repo";

describe("AgentRunsRepo", () => {
  it("inserts and lists runs by trade and cycle", () => {
    const db = createTestDb();
    const repo = new AgentRunsRepo(db);
    const session = createMinimalSession(db);
    const trade = insertTrade(db, {
      id: "trade-1",
      sessionId: session.id,
      instrumentSymbol: "NVDA",
    });
    const cycleId = "cycle-1";
    const run = insertAgentRun(db, {
      id: "run-1",
      session_id: session.id,
      trade_id: trade.id,
      agent_type: "technical",
      cost_usd: 0.75,
    });

    new AgentMessagesRepo(db).insert({
      id: "msg-1",
      agent_run_id: run.id,
      session_id: session.id,
      trade_id: trade.id,
      cycle_id: cycleId,
      role: "assistant",
      provider_key: "provider-openrouter",
      model_id: "openai/gpt-4o-mini",
      messages_json: "[]",
      thinking_json: null,
      tool_calls_json: null,
      output_json: null,
      output_schema_name: null,
      parse_fallback: false,
      strategy_snapshot_json: "{}",
      market_snapshot_json: null,
      created_at: run.created_at,
    });

    expect(repo.listByTrade(trade.id)).toMatchObject([
      { id: "run-1", agent_type: "technical", cost_usd: 0.75 },
    ]);
    expect(repo.listByCycle(cycleId)).toMatchObject([{ id: "run-1" }]);
    expect(repo.dailyAiSpendUsd(session.id)).toBeCloseTo(0.75, 6);

    db.sqlite.close();
  });
});
