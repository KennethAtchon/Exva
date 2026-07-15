import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { BrokerAccountsRepo } from "./broker-accounts-repo";
import { PaperPositionsRepo } from "./paper-positions-repo";

describe("PaperPositionsRepo", () => {
  function setup() {
    const db = createTestDb();
    const accounts = new BrokerAccountsRepo(db);
    const positions = new PaperPositionsRepo(db);
    accounts.insert({
      id: "pm-paper-1",
      name: "Polymarket Paper",
      brokerType: "polymarket",
      supportedInstrumentClasses: ["prediction_market"],
      mode: "paper",
      secretRef: "secret:pm-paper-1",
    });
    return { db, positions };
  }

  it("upserts and reads back a ghost position with metadata", () => {
    const { db, positions } = setup();
    const row = positions.upsert({
      brokerOrderId: "ghost-1",
      accountId: "pm-paper-1",
      venue: "polymarket",
      instrumentSymbol: "pm:cond-1",
      side: "BUY",
      shares: 10,
      entryPrice: 0.62,
      sizeUsd: 6.2,
      open: true,
      resting: false,
      metadata: { tokenId: "token-yes-1", conditionId: "cond-1" },
    });
    expect(row.open).toBe(true);

    const fetched = positions.get("ghost-1");
    expect(fetched).toMatchObject({
      brokerOrderId: "ghost-1",
      shares: 10,
      entryPrice: 0.62,
      open: true,
      resting: false,
      metadata: { tokenId: "token-yes-1", conditionId: "cond-1" },
    });
    db.sqlite.close();
  });

  it("updates an existing row in place rather than duplicating", () => {
    const { db, positions } = setup();
    positions.upsert({
      brokerOrderId: "ghost-2",
      accountId: "pm-paper-1",
      venue: "polymarket",
      instrumentSymbol: "pm:cond-2",
      side: "BUY",
      shares: 5,
      entryPrice: 0.4,
      sizeUsd: 2,
      open: true,
      resting: true,
    });
    positions.upsert({
      brokerOrderId: "ghost-2",
      accountId: "pm-paper-1",
      venue: "polymarket",
      instrumentSymbol: "pm:cond-2",
      side: "BUY",
      shares: 5,
      entryPrice: 0.45,
      sizeUsd: 2.25,
      open: true,
      resting: false,
    });

    const fetched = positions.get("ghost-2");
    expect(fetched).toMatchObject({ entryPrice: 0.45, resting: false });
    expect(positions.listOpenByAccount("pm-paper-1")).toHaveLength(1);
    db.sqlite.close();
  });

  it("lists only open positions for an account", () => {
    const { db, positions } = setup();
    positions.upsert({
      brokerOrderId: "ghost-3",
      accountId: "pm-paper-1",
      venue: "polymarket",
      instrumentSymbol: "pm:cond-3",
      side: "BUY",
      shares: 1,
      entryPrice: 0.5,
      sizeUsd: 0.5,
      open: true,
      resting: false,
    });
    positions.upsert({
      brokerOrderId: "ghost-4",
      accountId: "pm-paper-1",
      venue: "polymarket",
      instrumentSymbol: "pm:cond-4",
      side: "SELL",
      shares: 2,
      entryPrice: 0.7,
      sizeUsd: 1.4,
      open: true,
      resting: false,
    });

    positions.setClosed("ghost-3");

    const open = positions.listOpenByAccount("pm-paper-1");
    expect(open).toHaveLength(1);
    expect(open[0]?.brokerOrderId).toBe("ghost-4");

    expect(positions.get("ghost-3")).toMatchObject({
      open: false,
      resting: false,
    });
    db.sqlite.close();
  });

  it("returns null for an unknown broker order id", () => {
    const { db, positions } = setup();
    expect(positions.get("does-not-exist")).toBeNull();
    db.sqlite.close();
  });
});
