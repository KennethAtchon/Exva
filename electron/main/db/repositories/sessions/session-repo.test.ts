import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { SessionRepo } from "./session-repo";

describe("SessionRepo", () => {
  it("creates, lists, gets, transitions status, duplicates, and manages focus", () => {
    const db = createTestDb();
    const repo = new SessionRepo(db);

    const session = createMinimalSession(db, {
      name: "Alpha",
      isFocused: true,
    });
    expect(session).toMatchObject({
      name: "Alpha",
      status: "draft",
      isFocused: true,
    });
    expect(repo.get(session.id)?.name).toBe("Alpha");
    expect(repo.list()).toHaveLength(1);

    repo.setStatus("archived", session.id);
    expect(repo.get(session.id)?.status).toBe("archived");
    expect(repo.list()).toHaveLength(0);
    expect(repo.list({ includeArchived: true })).toHaveLength(1);

    const second = createMinimalSession(db, { name: "Beta" });
    repo.setFocus(second.id);
    expect(repo.getFocused()?.id).toBe(second.id);
    expect(repo.get(session.id)?.isFocused).toBe(false);

    repo.clearFocus();
    expect(repo.getFocused()).toBeNull();

    const duplicate = repo.duplicate(second.id, { name: "Beta Copy" });
    expect(duplicate).toMatchObject({
      name: "Beta Copy",
      status: "draft",
      objective: second.objective,
    });

    db.sqlite.close();
  });
});
