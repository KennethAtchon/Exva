import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession, insertTrade } from "../../test-fixtures";
import { AutopsyLessonsRepo } from "./autopsy-lessons-repo";
import { TradeAutopsiesRepo } from "./trade-autopsies-repo";

describe("AutopsyLessonsRepo", () => {
  it("inserts, lists, and updates autopsy lessons", () => {
    const db = createTestDb();
    const lessonsRepo = new AutopsyLessonsRepo(db);
    const autopsiesRepo = new TradeAutopsiesRepo(db);
    const session = createMinimalSession(db);
    const trade = insertTrade(db, {
      id: "trade-1",
      sessionId: session.id,
    });
    const now = new Date().toISOString();
    const autopsy = autopsiesRepo.insert({
      tradeId: trade.id,
      sessionId: session.id,
      modelId: "openai/gpt-4o-mini",
      summary: "Summary",
      summaryStructuredJson: "{}",
      phaseTracesJson: "[]",
      qualityGrade: null,
      qualityScore: null,
      isFallback: false,
      createdAt: now,
      createdBy: "system",
    });

    const lesson = lessonsRepo.insert({
      autopsyId: autopsy.id,
      periodAutopsyId: null,
      tradeId: trade.id,
      sessionId: session.id,
      lesson: "Wait for confirmation before entry.",
      severity: "medium",
      category: "execution",
      proposedFix: "Add confirmation rule.",
      status: "pending",
      recurrenceCount: 1,
      source: "trade",
      scope: "session",
      createdAt: now,
      updatedAt: now,
      validatedAt: null,
    });

    expect(lessonsRepo.listByAutopsy(autopsy.id)).toMatchObject([
      { id: lesson.id, lesson: "Wait for confirmation before entry." },
    ]);
    expect(lessonsRepo.listBySession(session.id)).toHaveLength(1);

    const updated = lessonsRepo.update(lesson.id, { status: "validated" });
    expect(updated.status).toBe("validated");

    db.sqlite.close();
  });
});
