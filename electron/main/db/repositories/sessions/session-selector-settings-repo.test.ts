import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { SessionSelectorSettingsRepo } from "./session-selector-settings-repo";

describe("SessionSelectorSettingsRepo", () => {
  it("reads and updates selector settings", () => {
    const db = createTestDb();
    const repo = new SessionSelectorSettingsRepo(db);
    const session = createMinimalSession(db);

    expect(repo.get(session.id).aiPickerEnabled).toBe(true);

    const updated = repo.update(session.id, { aiPickerEnabled: false });
    expect(updated.aiPickerEnabled).toBe(false);
    expect(repo.get(session.id).aiPickerEnabled).toBe(false);

    db.sqlite.close();
  });
});
