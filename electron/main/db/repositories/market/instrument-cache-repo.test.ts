import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession, insertAgentRun } from "../../test-fixtures";
import { InstrumentCacheRepo } from "./instrument-cache-repo";

describe("InstrumentCacheRepo", () => {
  it("saves, reads, and clears session instrument cache", () => {
    const db = createTestDb();
    const repo = new InstrumentCacheRepo(db);
    const session = createMinimalSession(db);
    const selectedAt = new Date().toISOString();

    repo.save({
      sessionId: session.id,
      instruments: '["AAPL","MSFT"]',
      definitionHash: "hash-v1",
      selectedAt,
      selectorAgentRunId: null,
      cycleId: "cycle-1",
      researchBriefsJson: '{"AAPL":"brief"}',
    });

    expect(repo.get(session.id)).toMatchObject({
      sessionId: session.id,
      instruments: '["AAPL","MSFT"]',
      cycleId: "cycle-1",
    });

    repo.save({
      sessionId: session.id,
      instruments: '["NVDA"]',
      definitionHash: "hash-v2",
      selectedAt,
      selectorAgentRunId: insertAgentRun(db, {
        id: "run-1",
        session_id: session.id,
      }).id,
      cycleId: "cycle-2",
    });
    expect(repo.get(session.id)?.definitionHash).toBe("hash-v2");

    repo.clear(session.id);
    expect(repo.get(session.id)).toBeNull();

    db.sqlite.close();
  });
});
