import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import {
  createMinimalSession,
  insertAgentRun,
  insertTrade,
} from "../../test-fixtures";
import { AgentMessagesRepo } from "./agent-messages-repo";

describe("AgentMessagesRepo", () => {
  it("inserts and lists messages by trade and cycle", () => {
    const db = createTestDb();
    const repo = new AgentMessagesRepo(db);
    const session = createMinimalSession(db);
    const trade = insertTrade(db, {
      id: "trade-1",
      sessionId: session.id,
    });
    const run = insertAgentRun(db, {
      id: "run-1",
      session_id: session.id,
      trade_id: trade.id,
    });
    const cycleId = "cycle-abc";

    repo.insert({
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
      output_json: '{"ok":true}',
      output_schema_name: "decision",
      parse_fallback: false,
      strategy_snapshot_json: "{}",
      market_snapshot_json: null,
      created_at: run.created_at,
    });

    expect(repo.listByTrade(trade.id)).toMatchObject([
      { id: "msg-1", output_schema_name: "decision" },
    ]);
    expect(repo.listByCycle(cycleId)).toMatchObject([{ id: "msg-1" }]);
    expect(repo.listByTrades([trade.id])).toHaveLength(1);
    expect(repo.listByTrades([])).toEqual([]);

    db.sqlite.close();
  });
});
