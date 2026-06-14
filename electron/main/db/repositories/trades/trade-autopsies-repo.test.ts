import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession, insertTrade } from "../../test-fixtures";
import { TradeAutopsiesRepo } from "./trade-autopsies-repo";

describe("TradeAutopsiesRepo", () => {
  it("inserts and lists trade autopsies", () => {
    const db = createTestDb();
    const repo = new TradeAutopsiesRepo(db);
    const session = createMinimalSession(db);
    const trade = insertTrade(db, {
      id: "trade-1",
      sessionId: session.id,
    });
    const createdAt = new Date().toISOString();

    const record = repo.insert({
      tradeId: trade.id,
      sessionId: session.id,
      modelId: "openai/gpt-4o-mini",
      summary: "Entry was late.",
      summaryStructuredJson: "{}",
      phaseTracesJson: "[]",
      qualityGrade: "B",
      qualityScore: 0.8,
      isFallback: false,
      createdAt,
      createdBy: "system",
    });

    expect(repo.find(record.id)?.summary).toBe("Entry was late.");
    expect(repo.listByTrade(trade.id)).toHaveLength(1);
    expect(repo.findLatest(trade.id)?.id).toBe(record.id);

    db.sqlite.close();
  });
});
