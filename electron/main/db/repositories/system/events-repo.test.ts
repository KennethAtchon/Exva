import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { EventsRepo } from "./events-repo";

describe("EventsRepo", () => {
  it("inserts and queries events with filters", () => {
    const db = createTestDb();
    const repo = new EventsRepo(db);
    const session = createMinimalSession(db);

    repo.insert({
      session_id: session.id,
      trade_id: null,
      level: "INFO",
      agent_type: "selector",
      message: "Selector picked NVDA",
    });
    repo.insert({
      session_id: session.id,
      trade_id: null,
      level: "ERROR",
      agent_type: "technical",
      message: "Technical analysis failed",
    });

    expect(
      repo.query({ sessionId: session.id, minLevel: "WARN" }),
    ).toHaveLength(1);
    expect(
      repo.query({ sessionId: session.id, search: "nvda", limit: 10 }),
    ).toHaveLength(1);

    db.sqlite.close();
  });
});
