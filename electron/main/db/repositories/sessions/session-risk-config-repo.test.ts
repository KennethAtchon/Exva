import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { SessionRiskConfigRepo } from "./session-risk-config-repo";

describe("SessionRiskConfigRepo", () => {
  it("reads and upserts risk config for a session", () => {
    const db = createTestDb();
    const repo = new SessionRiskConfigRepo(db);
    const session = createMinimalSession(db);

    const current = repo.get(session.id);
    expect(current.sessionId).toBe(session.id);

    const updated = repo.upsert(session.id, {
      maxPositionUsd: 750,
      dailyLossLimitUsd: 150,
    });
    expect(updated).toMatchObject({
      maxPositionUsd: 750,
      dailyLossLimitUsd: 150,
    });

    db.sqlite.close();
  });
});
