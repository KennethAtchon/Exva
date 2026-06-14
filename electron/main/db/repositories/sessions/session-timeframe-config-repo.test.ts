import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { SessionTimeframeConfigRepo } from "./session-timeframe-config-repo";

describe("SessionTimeframeConfigRepo", () => {
  it("reads and upserts timeframe config", () => {
    const db = createTestDb();
    const repo = new SessionTimeframeConfigRepo(db);
    const session = createMinimalSession(db);

    const updated = repo.upsert(session.id, {
      primaryTradingTimeframe: "4h",
      targetHoldDays: 5,
      timeframeNotes: "Shorter holds",
    });
    expect(updated).toMatchObject({
      primaryTradingTimeframe: "4h",
      targetHoldDays: 5,
      timeframeNotes: "Shorter holds",
    });

    db.sqlite.close();
  });
});
