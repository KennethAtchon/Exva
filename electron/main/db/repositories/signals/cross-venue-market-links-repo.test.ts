import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import {
  CrossVenueMarketLinksRepo,
  questionSimilarity,
} from "./cross-venue-market-links-repo";

describe("CrossVenueMarketLinksRepo", () => {
  it("upserts and approves links", () => {
    const db = createTestDb();
    const repo = new CrossVenueMarketLinksRepo(db);
    const row = repo.upsert({
      polymarketId: "pm-1",
      kalshiTicker: "KXTEST",
      confidence: questionSimilarity(
        "Will the Fed cut in July?",
        "Fed cuts rates in July",
      ),
      approved: false,
      questionPolymarket: "Will the Fed cut in July?",
      questionKalshi: "Fed cuts rates in July",
      matchMethod: "heuristic",
    });
    expect(row.approved).toBe(false);
    const approved = repo.setApproved(row.id, true);
    expect(approved?.approved).toBe(true);
    expect(repo.list({ approvedOnly: true })).toHaveLength(1);
    db.sqlite.close();
  });
});
