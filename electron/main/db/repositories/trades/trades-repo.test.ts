import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../test-helpers";
import {
  createMinimalSession,
  insertBrokerAccount,
  insertTrade,
} from "../../test-fixtures";
import { trades } from "../../schema";
import { toTrade } from "../system/mappers";
import { TradesRepo } from "./trades-repo";

describe("TradesRepo", () => {
  it("inserts, finds, lists, and updates trades", () => {
    const db = createTestDb();
    const repo = new TradesRepo(db);
    const session = createMinimalSession(db);
    const broker = insertBrokerAccount(db, { id: "broker-1" });

    const trade = insertTrade(db, {
      id: "trade-1",
      sessionId: session.id,
      brokerAccountId: broker.id,
      instrumentSymbol: "NVDA",
      status: "pending",
    });

    expect(repo.find("trade-1")).toMatchObject({
      instrumentSymbol: "NVDA",
      status: "pending",
    });
    expect(repo.listAll(session.id)).toHaveLength(1);
    expect(repo.listOpenAndPending(session.id)).toHaveLength(1);

    repo.markOpen("trade-1", "order-123", 120.5);
    expect(repo.require("trade-1")).toMatchObject({
      status: "open",
      entry_price: 120.5,
    });

    repo.updateStatus("trade-1", "closed", 25);
    expect(repo.listClosed(session.id)).toMatchObject([
      { final_pnl_usd: 25, status: "closed" },
    ]);

    const row = db.db
      .select()
      .from(trades)
      .where(eq(trades.id, trade.id))
      .get();
    expect(row).toBeDefined();
    if (!row) throw new Error("expected trade row");
    expect(toTrade(row)).toMatchObject({
      id: trade.id,
      instrumentSymbol: "NVDA",
      final_pnl_usd: 25,
    });

    db.sqlite.close();
  });
});
