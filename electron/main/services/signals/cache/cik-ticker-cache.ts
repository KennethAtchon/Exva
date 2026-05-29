import type { DbClient } from "../../../db/client";
import { cikTickerCache } from "../../../db/schema";
import { eq } from "drizzle-orm";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class CikTickerCache {
  constructor(private readonly db: DbClient) {}

  get(cik: string): string | null | undefined {
    const row = this.db.db
      .select()
      .from(cikTickerCache)
      .where(eq(cikTickerCache.cik, cik))
      .get();
    if (!row) return undefined;
    const lookedUpMs = new Date(row.lookedUpAt).getTime();
    if (Number.isNaN(lookedUpMs) || Date.now() - lookedUpMs > CACHE_TTL_MS) {
      return undefined;
    }
    return row.ticker ?? null;
  }

  upsert(cik: string, ticker: string | null): void {
    this.db.db
      .insert(cikTickerCache)
      .values({
        cik,
        ticker,
        lookedUpAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: cikTickerCache.cik,
        set: { ticker, lookedUpAt: new Date().toISOString() },
      })
      .run();
  }
}
