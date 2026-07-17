import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { Form4TransactionsRepo } from "./form4-transactions-repo";

describe("Form4TransactionsRepo", () => {
  it("upserts and lists recent open-market buys", () => {
    const db = createTestDb();
    const repo = new Form4TransactionsRepo(db);
    repo.upsert({
      accessionNumber: "acc-1",
      cik: "0001",
      ticker: "ACME",
      companyName: "Acme",
      insiderName: "Jane",
      role: "CEO",
      transactionCode: "P",
      shares: 1000,
      pricePerShare: 10,
      totalValueUsd: 10_000,
      isOpenMarketBuy: true,
      filedAt: "2026-07-01T00:00:00.000Z",
      transactionDate: "2026-06-30",
      documentUrl: null,
    });
    repo.upsert({
      accessionNumber: "acc-2",
      cik: "0001",
      ticker: "ACME",
      companyName: "Acme",
      insiderName: "Joe",
      role: "CFO",
      transactionCode: "S",
      shares: 100,
      pricePerShare: 10,
      totalValueUsd: 1_000,
      isOpenMarketBuy: false,
      filedAt: "2026-07-02T00:00:00.000Z",
      transactionDate: "2026-07-01",
      documentUrl: null,
    });

    const buys = repo.listRecentOpenMarketBuys({
      sinceIso: "2026-06-01T00:00:00.000Z",
    });
    expect(buys).toHaveLength(1);
    expect(buys[0]?.insiderName).toBe("Jane");
    db.sqlite.close();
  });
});
