import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { SqliteSessionExecutionStepsRepo } from "./session-execution-steps-repo";

describe("SqliteSessionExecutionStepsRepo", () => {
  it("upserts and reads execution step state", () => {
    const db = createTestDb();
    const repo = new SqliteSessionExecutionStepsRepo(db);
    const session = createMinimalSession(db);
    const cycleId = "cycle-1";
    const startedAt = new Date().toISOString();

    const step = repo.upsert({
      sessionId: session.id,
      cycleId,
      stage: "selector",
      status: "running",
      attempt: 1,
      startedAt,
      completedAt: null,
      nextRetryAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      outcome: null,
      retryable: true,
    });

    expect(step.stage).toBe("selector");
    expect(repo.get(session.id, cycleId, "selector")).toMatchObject({
      status: "running",
      attempt: 1,
    });

    repo.upsert({
      sessionId: session.id,
      cycleId,
      stage: "selector",
      status: "succeeded",
      attempt: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      nextRetryAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      outcome: "ok",
      retryable: false,
    });
    expect(repo.getLatestByCycle(session.id, cycleId)[0]?.status).toBe(
      "succeeded",
    );
    expect(repo.getLatestCycleState(session.id).cycleId).toBe(cycleId);

    db.sqlite.close();
  });
});
