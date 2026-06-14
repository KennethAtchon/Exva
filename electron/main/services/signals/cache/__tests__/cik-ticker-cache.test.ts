import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../../../db/test-helpers";
import { cikTickerCache as cikTickerCacheTable } from "../../../../db/schema";
import { CikTickerCache } from "../cik-ticker-cache";

describe("CikTickerCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("upserts and reads ticker mappings with TTL", () => {
    const db = createTestDb();
    const cache = new CikTickerCache(db);

    expect(cache.get("0000320193")).toBeUndefined();

    cache.upsert("0000320193", "AAPL");
    expect(cache.get("0000320193")).toBe("AAPL");

    cache.upsert("0000320193", null);
    expect(cache.get("0000320193")).toBeNull();

    db.sqlite.close();
  });

  it("treats stale cache rows as misses so SEC lookup can refresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));

    const db = createTestDb();
    const cache = new CikTickerCache(db);
    cache.upsert("0000320193", "AAPL");

    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
    expect(cache.get("0000320193")).toBeUndefined();

    db.db
      .update(cikTickerCacheTable)
      .set({ lookedUpAt: "2024-06-01T12:00:00.000Z", ticker: "AAPL" })
      .where(eq(cikTickerCacheTable.cik, "0000320193"))
      .run();
    expect(cache.get("0000320193")).toBeUndefined();

    cache.upsert("0000320193", "AAPL");
    expect(cache.get("0000320193")).toBe("AAPL");

    db.sqlite.close();
  });
});
