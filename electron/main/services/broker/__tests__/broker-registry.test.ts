import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { insertBrokerAccount } from "../../../db/test-fixtures";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { BrokerRegistry } from "../broker-registry";
import { MockBrokerAdapter } from "../adapters/mock-adapter";
import { AlpacaAdapter } from "../adapters/alpaca-adapter";
import { PolymarketAdapter } from "../adapters/polymarket-adapter";
import { DEFAULT_PAPER_STARTING_BALANCE_USD } from "../../../db/repositories/brokers/paper-balances-repo";

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

describe("BrokerRegistry", () => {
  let db = createTestDb();
  const secrets = { get: vi.fn() };

  beforeEach(() => {
    db = createTestDb();
    secrets.get.mockReset();
    Object.values(clobClientMethods).forEach((fn) => fn.mockReset());
    clobClientMethods.getOk.mockResolvedValue(true);
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("caches adapters per broker account id", async () => {
    insertBrokerAccount(db, { id: "mock-1" });
    secrets.get.mockResolvedValue("{}");
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    const first = await registry.get("mock-1");
    const second = await registry.get("mock-1");

    expect(first).toBe(second);
    expect(secrets.get).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the adapter after invalidation", async () => {
    insertBrokerAccount(db, { id: "mock-1" });
    secrets.get.mockResolvedValue("{}");
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    const first = await registry.get("mock-1");
    registry.invalidate("mock-1");
    const second = await registry.get("mock-1");

    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(MockBrokerAdapter);
  });

  it("buildEphemeral does not populate the cache", async () => {
    const repo = new BrokerAccountsRepo(db);
    insertBrokerAccount(db, {
      id: "mock-1",
      mockScenarioKind: "failed_breakout",
    });
    const account = repo.require("mock-1");
    const registry = new BrokerRegistry(repo, secrets as never);

    const ephemeral = await registry.buildEphemeral(account, "{}");
    const cached = await registry.get("mock-1");

    expect(ephemeral).not.toBe(cached);
    expect((ephemeral as MockBrokerAdapter).getScenarioKind()).toBe(
      "failed_breakout",
    );
  });

  it("builds an Alpaca adapter from stored credentials", async () => {
    insertBrokerAccount(db, {
      id: "alpaca-1",
      brokerType: "alpaca",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "secret:alpaca-1",
    });
    secrets.get.mockResolvedValue(
      JSON.stringify({
        provider: "alpaca",
        api_key: "key",
        secret_key: "secret",
        mode: "paper",
      }),
    );
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    const adapter = await registry.get("alpaca-1");

    expect(adapter).toBeInstanceOf(AlpacaAdapter);
    expect(secrets.get).toHaveBeenCalledWith("secret:alpaca-1");
  });

  it("throws when a live broker account is missing secrets", async () => {
    insertBrokerAccount(db, {
      id: "alpaca-1",
      brokerType: "alpaca",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "secret:alpaca-1",
    });
    secrets.get.mockResolvedValue(null);
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    await expect(registry.get("alpaca-1")).rejects.toMatchObject({
      code: "MISSING_SECRET",
    });
  });

  it("builds credential-free paper Polymarket without a stored secret", async () => {
    insertBrokerAccount(db, {
      id: "pm-paper-1",
      brokerType: "polymarket",
      supportedInstrumentClasses: ["prediction_market"],
      mode: "paper",
      secretRef: "secret:pm-paper-1",
    });
    secrets.get.mockResolvedValue(null);
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    const adapter = await registry.get("pm-paper-1");
    expect(adapter).toBeInstanceOf(PolymarketAdapter);

    const conn = await adapter.testConnection();
    expect(conn).toMatchObject({
      ok: true,
      account_balance: DEFAULT_PAPER_STARTING_BALANCE_USD,
    });
    expect(conn.message).toMatch(/ghost|paper/i);
  });

  it("still throws MISSING_SECRET for live Polymarket with no secret", async () => {
    insertBrokerAccount(db, {
      id: "pm-live-1",
      brokerType: "polymarket",
      supportedInstrumentClasses: ["prediction_market"],
      mode: "live",
      secretRef: "secret:pm-live-1",
    });
    secrets.get.mockResolvedValue(null);
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    await expect(registry.get("pm-live-1")).rejects.toMatchObject({
      code: "MISSING_SECRET",
    });
  });

  it("reports whether an account is a mock broker", () => {
    insertBrokerAccount(db, { id: "mock-1" });
    insertBrokerAccount(db, {
      id: "alpaca-1",
      brokerType: "alpaca",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "secret:alpaca-1",
    });
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    expect(registry.isMockAccount("mock-1")).toBe(true);
    expect(registry.isMockAccount("alpaca-1")).toBe(false);
    expect(registry.isMockAccount("missing")).toBe(false);
  });
});
