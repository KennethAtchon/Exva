import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { SessionResearchPostureRepo } from "./session-research-posture-repo";

describe("SessionResearchPostureRepo", () => {
  it("reads and upserts research posture for a session", () => {
    const db = createTestDb();
    const repo = new SessionResearchPostureRepo(db);
    const session = createMinimalSession(db);

    const current = repo.get(session.id);
    expect(current.sessionId).toBe(session.id);

    const updated = repo.upsert(session.id, {
      postureNotes: "Prefer 8-K catalysts.",
      evidenceMode: "document_first",
    });
    expect(updated).toMatchObject({
      postureNotes: "Prefer 8-K catalysts.",
      evidenceMode: "document_first",
    });

    db.sqlite.close();
  });
});
