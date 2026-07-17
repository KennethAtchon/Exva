import { and, desc, eq, gte } from "drizzle-orm";
import type { DbClient } from "../../../db/client";
import { form4Transactions } from "../../../db/schema";
import type { Form4Transaction } from "../../../services/signals/form4/form4-parser";

export interface Form4TransactionRow extends Form4Transaction {
  id: string;
  ingestedAt: string;
}

export class Form4TransactionsRepo {
  constructor(private readonly db: DbClient) {}

  upsert(input: Form4Transaction): Form4TransactionRow {
    const existing = this.db.db
      .select()
      .from(form4Transactions)
      .where(
        and(
          eq(form4Transactions.accessionNumber, input.accessionNumber),
          eq(form4Transactions.insiderName, input.insiderName),
          eq(form4Transactions.transactionCode, input.transactionCode),
          eq(form4Transactions.transactionDate, input.transactionDate),
        ),
      )
      .get();

    if (existing) {
      this.db.db
        .update(form4Transactions)
        .set({
          cik: input.cik,
          ticker: input.ticker,
          companyName: input.companyName,
          role: input.role,
          shares: input.shares,
          pricePerShare: input.pricePerShare,
          totalValueUsd: input.totalValueUsd,
          isOpenMarketBuy: input.isOpenMarketBuy,
          filedAt: input.filedAt,
          documentUrl: input.documentUrl,
          ingestedAt: new Date().toISOString(),
        })
        .where(eq(form4Transactions.id, existing.id))
        .run();
      const updated = this.get(existing.id);
      if (!updated) throw new Error("form4 transaction update vanished");
      return updated;
    }

    const id = crypto.randomUUID();
    const ingestedAt = new Date().toISOString();
    this.db.db
      .insert(form4Transactions)
      .values({
        id,
        accessionNumber: input.accessionNumber,
        cik: input.cik,
        ticker: input.ticker,
        companyName: input.companyName,
        insiderName: input.insiderName,
        role: input.role,
        transactionCode: input.transactionCode,
        shares: input.shares,
        pricePerShare: input.pricePerShare,
        totalValueUsd: input.totalValueUsd,
        isOpenMarketBuy: input.isOpenMarketBuy,
        filedAt: input.filedAt,
        transactionDate: input.transactionDate,
        documentUrl: input.documentUrl,
        ingestedAt,
      })
      .run();
    const created = this.get(id);
    if (!created) throw new Error("form4 transaction insert vanished");
    return created;
  }

  get(id: string): Form4TransactionRow | null {
    const row = this.db.db
      .select()
      .from(form4Transactions)
      .where(eq(form4Transactions.id, id))
      .get();
    return row ? mapRow(row) : null;
  }

  /** Recent open-market buys for cluster scanning (default 30d lookback). */
  listRecentOpenMarketBuys(opts?: {
    sinceIso?: string;
    limit?: number;
  }): Form4Transaction[] {
    const since =
      opts?.sinceIso ??
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const limit = opts?.limit ?? 5_000;
    return this.db.db
      .select()
      .from(form4Transactions)
      .where(
        and(
          eq(form4Transactions.isOpenMarketBuy, true),
          gte(form4Transactions.filedAt, since),
        ),
      )
      .orderBy(desc(form4Transactions.filedAt))
      .limit(limit)
      .all()
      .map(mapRow);
  }
}

function mapRow(
  row: typeof form4Transactions.$inferSelect,
): Form4TransactionRow {
  return {
    id: row.id,
    accessionNumber: row.accessionNumber,
    cik: row.cik,
    ticker: row.ticker,
    companyName: row.companyName,
    insiderName: row.insiderName,
    role: row.role,
    transactionCode: row.transactionCode,
    shares: row.shares,
    pricePerShare: row.pricePerShare,
    totalValueUsd: row.totalValueUsd,
    isOpenMarketBuy: row.isOpenMarketBuy,
    filedAt: row.filedAt,
    transactionDate: row.transactionDate,
    documentUrl: row.documentUrl,
    ingestedAt: row.ingestedAt,
  };
}
