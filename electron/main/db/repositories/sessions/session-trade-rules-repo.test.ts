import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { SessionTradeRulesRepo } from "./session-trade-rules-repo";

describe("SessionTradeRulesRepo", () => {
  it("reads and upserts trade rules", () => {
    const db = createTestDb();
    const repo = new SessionTradeRulesRepo(db);
    const session = createMinimalSession(db);

    const updated = repo.upsert(session.id, {
      ruleNotes: "Only trade liquid names.",
      sideBias: "long_only",
    });
    expect(updated).toMatchObject({
      ruleNotes: "Only trade liquid names.",
      sideBias: "long_only",
    });

    db.sqlite.close();
  });
});
