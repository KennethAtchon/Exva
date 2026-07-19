import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-helpers";
import type { DbClient } from "../client";
import { brokerAccounts } from "../schema";
import {
  runSeed,
  SEEDED_POLYMARKET_BROKER_ID,
  SEEDED_POLYMARKET_SECRET_REF,
} from "../seed";
import { BrokerAccountsRepo } from "../repositories/brokers/broker-accounts-repo";
import { BrokerRegistry } from "../../services/broker/broker-registry";
import { PolymarketAdapter } from "../../services/broker/adapters/polymarket-adapter";
import { DEFAULT_PAPER_STARTING_BALANCE_USD } from "../repositories/brokers/paper-balances-repo";

const clobClientMethods = vi.hoisted(() => ({
  getOk: vi.fn(),
  getBalanceAllowance: vi.fn(),
  getMarket: vi.fn(),
  getLastTradePrice: vi.fn(),
  getTickSize: vi.fn(),
  createAndPostMarketOrder: vi.fn(),
  createAndPostOrder: vi.fn(),
  cancelOrder: vi.fn(),
  getOrder: vi.fn(),
  createOrDeriveApiKey: vi.fn(),
}));

vi.mock("@polymarket/clob-client", () => ({
  AssetType: { COLLATERAL: "COLLATERAL" },
  OrderType: { FOK: "FOK", GTC: "GTC" },
  Side: { BUY: "BUY", SELL: "SELL" },
  ClobClient: vi.fn(function () {
    return clobClientMethods;
  }),
}));

vi.mock("viem", () => ({
  createWalletClient: vi.fn(() => ({})),
  http: vi.fn(() => ({})),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({})),
}));

vi.mock("viem/chains", () => ({
  polygon: { id: 137 },
}));

vi.mock("../../config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/env")>();
  return {
    env: {
      ...actual.env,
      isTest: false,
      openRouterKey: null,
      openRouterModel: null,
      alpacaApiKey: null,
      alpacaSecretKey: null,
    },
  };
});

describe("seed-polymarket-paper", () => {
  let db: DbClient;
  const secrets = { get: vi.fn() };

  beforeEach(() => {
    db = createTestDb();
    secrets.get.mockReset();
    secrets.get.mockResolvedValue(null);
    Object.values(clobClientMethods).forEach((fn) => fn.mockReset());
    clobClientMethods.getOk.mockResolvedValue(true);
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("inserts Polymarket Hover when env.isTest is false", () => {
    // createTestDb already ran seed under the mocked env (isTest=false).
    const row = db.db
      .select()
      .from(brokerAccounts)
      .where(eq(brokerAccounts.id, SEEDED_POLYMARKET_BROKER_ID))
      .get();

    expect(row).toMatchObject({
      id: SEEDED_POLYMARKET_BROKER_ID,
      name: "Polymarket Hover (Seeded)",
      brokerType: "polymarket",
      mode: "paper",
      secretRef: SEEDED_POLYMARKET_SECRET_REF,
    });
  });

  it("is idempotent across runSeed calls", () => {
    runSeed(db.db, db);
    runSeed(db.db, db);
    const rows = db.db
      .select()
      .from(brokerAccounts)
      .where(eq(brokerAccounts.id, SEEDED_POLYMARKET_BROKER_ID))
      .all();
    expect(rows).toHaveLength(1);
  });

  it("BrokerRegistry.get builds an adapter with no stored secret", async () => {
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    const adapter = await registry.get(SEEDED_POLYMARKET_BROKER_ID);
    expect(adapter).toBeInstanceOf(PolymarketAdapter);

    const conn = await adapter.testConnection();
    expect(conn).toMatchObject({
      ok: true,
      account_balance: DEFAULT_PAPER_STARTING_BALANCE_USD,
    });
    expect(conn.message).toMatch(/ghost|paper/i);
  });
});
