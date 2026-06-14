import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { PeriodAutopsiesRepo } from "./period-autopsies-repo";

describe("PeriodAutopsiesRepo", () => {
  it("inserts and lists period autopsies by scope", () => {
    const db = createTestDb();
    const repo = new PeriodAutopsiesRepo(db);
    const session = createMinimalSession(db);
    const createdAt = new Date().toISOString();

    const record = repo.insert({
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

    const listed = repo.listByScope({
      scope: "session",
      sessionId: session.id,
    });
    expect(listed.items).toMatchObject([{ id: record.id, tradeCount: 3 }]);
    expect(listed.total).toBe(1);
    expect(repo.findLatestByScope("session", session.id)?.id).toBe(record.id);

    db.sqlite.close();
  });
});
