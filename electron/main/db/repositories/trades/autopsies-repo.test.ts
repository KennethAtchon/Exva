import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession, insertTrade } from "../../test-fixtures";
import { AutopsiesRepo } from "./autopsies-repo";

describe("AutopsiesRepo", () => {
  it("inserts and lists trade autopsies", () => {
    const db = createTestDb();
    const repo = new AutopsiesRepo(db);
    const session = createMinimalSession(db);
    const trade = insertTrade(db, {
      id: "trade-1",
      sessionId: session.id,
    });
    const createdAt = new Date().toISOString();

    const record = repo.insertTrade({
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

    expect(repo.findTrade(record.id)?.summary).toBe("Entry was late.");
    expect(repo.listByTrade(trade.id)).toHaveLength(1);
    expect(repo.findLatestByTrade(trade.id)?.id).toBe(record.id);

    db.sqlite.close();
  });

  it("inserts and lists period autopsies by period_scope", () => {
    const db = createTestDb();
    const repo = new AutopsiesRepo(db);
    const session = createMinimalSession(db);
    const createdAt = new Date().toISOString();

    const record = repo.insertPeriod({
      scope: "session",
      sessionId: session.id,
      windowStart: "2025-01-01T00:00:00.000Z",
      windowEnd: "2025-01-31T23:59:59.999Z",
      modelId: "openai/gpt-4o-mini",
      filtersJson: "{}",
      tradeCount: 3,
      tradeIdsJson: "[]",
      summaryStructuredJson: "{}",
      phaseTracesJson: "[]",
      qualityGrade: "A",
      qualityScore: 0.9,
      isFallback: false,
      totalCostUsd: 0.5,
      createdAt,
      createdBy: "system",
    });

    const listed = repo.listPeriod({
      scope: "session",
      sessionId: session.id,
    });
    expect(listed.items).toMatchObject([{ id: record.id, tradeCount: 3 }]);
    expect(listed.total).toBe(1);
    expect(repo.findLatestByScope("session", session.id)?.id).toBe(record.id);

    db.sqlite.close();
  });
});
