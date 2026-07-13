import { and, eq, gte, lte } from "drizzle-orm";
import type { DbClient } from "../../../db/client";
import { fundingRates } from "../../../db/schema";

export interface FundingRateRow {
  id: string;
  venue: string;
  symbol: string;
  ts: string;
  rate: number;
  ingestedAt: string;
}

export class FundingRatesRepo {
  constructor(private readonly db: DbClient) {}

  upsert(input: {
    venue: string;
    symbol: string;
    ts: string;
    rate: number;
  }): FundingRateRow {
    const existing = this.db.db
      .select()
      .from(fundingRates)
      .where(
        and(
          eq(fundingRates.venue, input.venue),
          eq(fundingRates.symbol, input.symbol),
          eq(fundingRates.ts, input.ts),
        ),
      )
      .get();
    if (existing) {
      this.db.db
        .update(fundingRates)
        .set({ rate: input.rate, ingestedAt: new Date().toISOString() })
        .where(eq(fundingRates.id, existing.id))
        .run();
      return mapRow(existing);
    }
    const id = crypto.randomUUID();
    const ingestedAt = new Date().toISOString();
    this.db.db
      .insert(fundingRates)
      .values({
        id,
        venue: input.venue,
        symbol: input.symbol,
        ts: input.ts,
        rate: input.rate,
        ingestedAt,
      })
      .run();
    return {
      id,
      venue: input.venue,
      symbol: input.symbol,
      ts: input.ts,
      rate: input.rate,
      ingestedAt,
    };
  }

  listHistory(opts: {
    venue?: string;
    symbol: string;
    fromTs: string;
    toTs: string;
  }): FundingRateRow[] {
    const conditions = [
      eq(fundingRates.symbol, opts.symbol),
      gte(fundingRates.ts, opts.fromTs),
      lte(fundingRates.ts, opts.toTs),
    ];
    if (opts.venue) conditions.push(eq(fundingRates.venue, opts.venue));
    return this.db.db
      .select()
      .from(fundingRates)
      .where(and(...conditions))
      .all()
      .map(mapRow)
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }
}

function mapRow(row: typeof fundingRates.$inferSelect): FundingRateRow {
  return {
    id: row.id,
    venue: row.venue,
    symbol: row.symbol,
    ts: row.ts,
    rate: row.rate,
    ingestedAt: row.ingestedAt,
  };
}
