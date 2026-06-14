import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { SessionAiSettingsRepo } from "./session-ai-settings-repo";

describe("SessionAiSettingsRepo", () => {
  it("reads and upserts AI settings for a session", () => {
    const db = createTestDb();
    const repo = new SessionAiSettingsRepo(db);
    const session = createMinimalSession(db);

    expect(repo.get(session.id)).toMatchObject({
      sessionId: session.id,
      workerGuidanceMarkdown: "",
    });

    const updated = repo.upsert(session.id, {
      workerGuidanceMarkdown: "Focus on catalyst quality.",
    });
    expect(updated.workerGuidanceMarkdown).toBe("Focus on catalyst quality.");
    expect(repo.get(session.id).workerGuidanceMarkdown).toBe(
      "Focus on catalyst quality.",
    );

    db.sqlite.close();
  });
});
