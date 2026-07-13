import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { BrokerAccountsRepo } from "./broker-accounts-repo";
import {
  DEFAULT_PAPER_STARTING_BALANCE_USD,
  PaperBalancesRepo,
} from "./paper-balances-repo";

describe("PaperBalancesRepo", () => {
  function setup() {
    const db = createTestDb();
    const accounts = new BrokerAccountsRepo(db);
    const paper = new PaperBalancesRepo(db);
    accounts.insert({
      id: "pm-paper-1",
      name: "Polymarket Paper",
      brokerType: "polymarket",
      supportedInstrumentClasses: ["prediction_market"],
      mode: "paper",
      secretRef: "secret:pm-paper-1",
    });
    return { db, paper };
  }

  it("ensures a default starting balance", () => {
    const { db, paper } = setup();
    expect(paper.getBalance("pm-paper-1")).toBe(
      DEFAULT_PAPER_STARTING_BALANCE_USD,
    );
    db.sqlite.close();
  });

  it("debits and credits; rejects insufficient funds with typed error", () => {
    const { db, paper } = setup();
    paper.ensure("pm-paper-1", 500);
    expect(paper.debit("pm-paper-1", 120)).toBe(380);
    expect(paper.credit("pm-paper-1", 50)).toBe(430);
    try {
      paper.debit("pm-paper-1", 9999);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toMatchObject({
        code: "BROKER_INSUFFICIENT_FUNDS",
        message: expect.stringMatching(/insufficient paper balance/i),
      });
    }
    db.sqlite.close();
  });

  it("resets to starting balance (and can update starting balance)", () => {
    const { db, paper } = setup();
    paper.ensure("pm-paper-1", 1_000);
    paper.debit("pm-paper-1", 250);
    const reset = paper.reset("pm-paper-1");
    expect(reset.balance).toBe(1_000);
    const custom = paper.reset("pm-paper-1", 2_500);
    expect(custom.balance).toBe(2_500);
    expect(custom.startingBalance).toBe(2_500);
    db.sqlite.close();
  });
});
