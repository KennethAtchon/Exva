import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { FundingRatesRepo } from "./funding-rates-repo";

describe("FundingRatesRepo", () => {
  it("upserts and lists history", () => {
    const db = createTestDb();
    const repo = new FundingRatesRepo(db);
    repo.upsert({
      venue: "kraken",
      symbol: "BTC/USD",
      ts: "2026-01-01T00:00:00.000Z",
      rate: 0.0001,
    });
    repo.upsert({
      venue: "kraken",
      symbol: "BTC/USD",
      ts: "2026-01-01T08:00:00.000Z",
      rate: 0.0002,
    });
    const rows = repo.listHistory({
      venue: "kraken",
      symbol: "BTC/USD",
      fromTs: "2026-01-01T00:00:00.000Z",
      toTs: "2026-01-02T00:00:00.000Z",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.rate).toBe(0.0001);
    db.sqlite.close();
  });
});
