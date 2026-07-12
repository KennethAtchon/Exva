import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlpacaAdapter } from "../alpaca-adapter";

const fetchMock = vi.hoisted(() => vi.fn());

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

vi.stubGlobal("fetch", fetchMock);

// Friday 2026-06-12, 10:00 ET — inside US regular trading hours (non-holiday),
// so order-type behavior is deterministic regardless of when the suite runs.
const regularHoursClock = () => new Date("2026-06-12T14:00:00Z");
// Friday 2026-06-12, 18:00 ET — post-market extended-hours window.
const extendedHoursClock = () => new Date("2026-06-12T22:00:00Z");
// Friday 2026-06-12, 02:00 ET — fully closed (overnight).
const closedClock = () => new Date("2026-06-12T06:00:00Z");

describe("AlpacaAdapter", () => {
  const credentials = {
    provider: "alpaca" as const,
    api_key: "test-key",
    secret_key: "test-secret",
    mode: "paper" as const,
  };

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/v2/account")) {
        return jsonResponse({
          portfolio_value: "25000.50",
          buying_power: "20000",
        });
      }
      if (url.includes("/trades/latest")) {
        return jsonResponse({
          trade: { p: 185.25, t: "2026-06-13T12:00:00Z" },
        });
      }
      if (url.includes("/v2/orders") && init?.method === "POST") {
        return jsonResponse({
          id: "alpaca-order-1",
          filled_avg_price: "185.25",
        });
      }
      if (url.match(/\/v2\/positions\/[^/]+$/)) {
        return jsonResponse({ unrealized_pl: "25.50" });
      }
      if (url.includes("/v2/positions") && init?.method === "DELETE") {
        return jsonResponse({}, 204);
      }
      if (url.includes("/v2/positions")) {
        return jsonResponse([
          {
            symbol: "AAPL",
            qty: "10",
            market_value: "1852.50",
            unrealized_pl: "25.50",
            asset_class: "us_equity",
          },
        ]);
      }
      if (url.includes("/v2/orders/")) {
        return jsonResponse({
          id: "alpaca-order-1",
          symbol: "AAPL",
          status: "filled",
          filled_avg_price: "185.25",
        });
      }
      if (url.includes("/bars")) {
        return jsonResponse({
          bars: [
            {
              t: "2026-06-12T00:00:00Z",
              o: 180,
              h: 186,
              l: 179,
              c: 185,
              v: 1000,
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
  });

  it("connects and reads account balance from paper API", async () => {
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);

    const connection = await adapter.testConnection();
    const balance = await adapter.getAccountBalance();

    expect(connection).toMatchObject({
      ok: true,
      account_balance: 20000,
    });
    expect(balance).toBe(20000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("paper-api.alpaca.markets/v2/account"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "APCA-API-KEY-ID": "test-key",
        }),
      }),
    );
  });

  it("uses usable cash or buying power when account value is zero", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/v2/account")) {
        return jsonResponse({
          portfolio_value: "0",
          buying_power: "100000",
          cash: "100000",
        });
      }
      return jsonResponse({}, 404);
    });
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);

    const connection = await adapter.testConnection();
    const balance = await adapter.getAccountBalance();

    expect(connection).toMatchObject({
      ok: true,
      account_balance: 100000,
    });
    expect(balance).toBe(100000);
  });

  it("fetches quotes and places notional market orders", async () => {
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);
    const quote = await adapter.getMarketSnapshot("AAPL");
    const order = await adapter.placeOrder({
      instrumentSymbol: "AAPL",
      instrumentType: "stock",
      side: "BUY",
      sizeUsd: 500,
      clientOrderId: "client-1",
    });

    expect(quote.price).toBe(185.25);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "data.alpaca.markets/v2/stocks/AAPL/trades/latest?feed=iex",
      ),
      expect.any(Object),
    );
    expect(order).toEqual({
      brokerOrderId: "alpaca-order-1",
      filledAvgPrice: 185.25,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v2/orders"),
      expect.objectContaining({ method: "POST" }),
    );
    const orderCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes("/v2/orders") && init?.method === "POST",
    );
    expect(JSON.parse(String(orderCall?.[1]?.body))).toMatchObject({
      client_order_id: "client-1",
    });
  });

  it("refreshes an accepted order before returning its fill price", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/v2/orders") && init?.method === "POST") {
        return jsonResponse({ id: "alpaca-order-async", status: "accepted" });
      }
      if (url.includes("/v2/orders/alpaca-order-async")) {
        return jsonResponse({
          id: "alpaca-order-async",
          status: "filled",
          filled_avg_price: "186.01",
        });
      }
      return jsonResponse({}, 404);
    });
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);

    const order = await adapter.placeOrder({
      instrumentSymbol: "AAPL",
      instrumentType: "stock",
      side: "BUY",
      sizeUsd: 500,
      clientOrderId: "client-async",
    });

    expect(order).toEqual({
      brokerOrderId: "alpaca-order-async",
      filledAvgPrice: 186.01,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v2/orders/alpaca-order-async"),
      expect.any(Object),
    );
  });

  it("lists equity positions and closes filled orders", async () => {
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);
    const positions = await adapter.getPositions();
    const closed = await adapter.closeOrder("alpaca-order-1");

    expect(positions).toEqual([
      expect.objectContaining({
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "long",
        sizeUsd: 1852.5,
        unrealizedPnl: 25.5,
      }),
    ]);
    expect(closed.realizedPnlUsd).toBe(25.5);
  });

  it("places crypto orders with gtc time-in-force", async () => {
    // Crypto trades 24/7 and Alpaca rejects `day` for it, so the adapter must
    // send `gtc` — a stock-only `day` TIF would be rejected for BTC/USD.
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);

    const result = await adapter.placeOrder({
      instrumentSymbol: "BTC/USD",
      instrumentType: "crypto",
      side: "BUY",
      sizeUsd: 500,
      clientOrderId: "client-crypto",
    });

    expect(result.brokerOrderId).toBe("alpaca-order-1");
    const orderPost = fetchMock.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        call[0].includes("/v2/orders") &&
        (call[1] as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse(
      (orderPost?.[1] as RequestInit | undefined)?.body as string,
    );
    expect(body.symbol).toBe("BTC/USD");
    expect(body.time_in_force).toBe("gtc");
  });

  it("rejects instrument classes Alpaca cannot trade", async () => {
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "ES",
        instrumentType: "futures",
        side: "BUY",
        sizeUsd: 500,
        clientOrderId: "client-futures",
      }),
    ).rejects.toThrow(/stocks, crypto, and options only/i);
  });

  it("sizes options orders in whole contracts via qty, not notional", async () => {
    const optionSymbol = "AAPL250117C00150000";
    let orderBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      // Per-contract price $5.00 → cost $500/contract.
      if (url.includes("/v1beta1/options/trades/latest")) {
        return jsonResponse({
          trades: { [optionSymbol]: { p: 5, t: "2026-06-13T12:00:00Z" } },
        });
      }
      if (url.includes("/v2/orders") && init?.method === "POST") {
        orderBody = JSON.parse(String(init.body));
        return jsonResponse({ id: "opt-order-1", filled_avg_price: "5.00" });
      }
      return jsonResponse({}, 404);
    });

    const adapter = new AlpacaAdapter(credentials, regularHoursClock);
    const result = await adapter.placeOrder({
      instrumentSymbol: optionSymbol,
      instrumentType: "options",
      side: "BUY",
      sizeUsd: 1500,
      clientOrderId: "client-opt",
    });

    expect(result.brokerOrderId).toBe("opt-order-1");
    // $1500 budget / $500 per contract = 3 contracts; no dollar-notional.
    expect(orderBody).toMatchObject({ symbol: optionSymbol, qty: "3" });
    expect(orderBody).not.toHaveProperty("notional");
  });

  it("places a regular-hours stock order as a notional market DAY order", async () => {
    let orderBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/v2/orders") && init?.method === "POST") {
        orderBody = JSON.parse(String(init.body));
        return jsonResponse({ id: "rth-1", filled_avg_price: "185.25" });
      }
      return jsonResponse({}, 404);
    });
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);

    await adapter.placeOrder({
      instrumentSymbol: "AAPL",
      instrumentType: "stock",
      side: "BUY",
      sizeUsd: 500,
      clientOrderId: "client-rth",
    });

    expect(orderBody).toMatchObject({
      type: "market",
      time_in_force: "day",
      notional: "500",
    });
    expect(orderBody).not.toHaveProperty("extended_hours");
  });

  it("places an extended-hours stock order as a marketable limit with extended_hours", async () => {
    let orderBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/trades/latest")) {
        return jsonResponse({
          trade: { p: 185.25, t: "2026-06-12T22:00:00Z" },
        });
      }
      if (url.includes("/v2/orders") && init?.method === "POST") {
        orderBody = JSON.parse(String(init.body));
        return jsonResponse({ id: "ext-1", filled_avg_price: "186.0" });
      }
      return jsonResponse({}, 404);
    });
    const adapter = new AlpacaAdapter(credentials, extendedHoursClock);

    const order = await adapter.placeOrder({
      instrumentSymbol: "AAPL",
      instrumentType: "stock",
      side: "BUY",
      sizeUsd: 500,
      clientOrderId: "client-ext",
    });

    expect(order.filledAvgPrice).toBe(186);
    // Marketable buy limit = 185.25 * 1.005 = 186.18 (penny-rounded);
    // qty = floor(500 / 186.18) = 2; never a market order off-hours.
    expect(orderBody).toMatchObject({
      type: "limit",
      time_in_force: "day",
      extended_hours: true,
      limit_price: "186.18",
      qty: "2",
    });
    expect(orderBody).not.toHaveProperty("notional");
  });

  it("refuses a stock order when the market is fully closed", async () => {
    const adapter = new AlpacaAdapter(credentials, closedClock);

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 500,
        clientOrderId: "client-closed",
      }),
    ).rejects.toThrow(/market is closed/i);
  });

  it("refuses an options order outside regular hours (no extended-hours options)", async () => {
    const adapter = new AlpacaAdapter(credentials, extendedHoursClock);

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "AAPL250117C00150000",
        instrumentType: "options",
        side: "BUY",
        sizeUsd: 1500,
        clientOrderId: "client-opt-ext",
      }),
    ).rejects.toThrow(/market is closed/i);
  });

  // Regression: Alpaca's bars endpoints return [] when `start` is omitted,
  // which silently starved the deterministic signal engines (every cycle hit
  // "insufficient bars" and skipped at confidence 0.2). Every OHLCV request
  // must carry an explicit lookback window wide enough to backfill barCount.
  it("requests stock bars with an explicit start window", async () => {
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);
    const bars = await adapter.getOhlcv("SPY", "1h", 30);

    expect(bars.length).toBe(1);
    const barsCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/v2/stocks/SPY/bars"),
    );
    const url = String(barsCall?.[0]);
    expect(url).toContain("timeframe=1Hour");
    expect(url).toContain("limit=30");
    // start must be present and strictly before "now" (the regular-hours clock).
    const start = new URL(url).searchParams.get("start");
    expect(start).toBeTruthy();
    expect(new Date(start as string).getTime()).toBeLessThan(
      regularHoursClock().getTime(),
    );
    // 30 1h bars * 3x slack = 90h back, comfortably > 1 day.
    const ageMs =
      regularHoursClock().getTime() - new Date(start as string).getTime();
    expect(ageMs).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it("requests crypto bars with an explicit start window", async () => {
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);
    await adapter.getOhlcv("BTC/USD", "4h", 30);

    const barsCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/v1beta3/crypto/us/bars"),
    );
    const start = new URL(String(barsCall?.[0])).searchParams.get("start");
    expect(start).toBeTruthy();
    expect(new Date(start as string).getTime()).toBeLessThan(
      regularHoursClock().getTime(),
    );
  });

  it("requests option bars with an explicit start window", async () => {
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);
    await adapter.getOhlcv("AAPL250117C00150000", "1d", 30);

    const barsCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/v1beta1/options/bars"),
    );
    const start = new URL(String(barsCall?.[0])).searchParams.get("start");
    expect(start).toBeTruthy();
  });

  it("parses the option chain snapshot into typed contracts", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/v1beta1/options/snapshots/AAPL")) {
        return jsonResponse({
          snapshots: {
            AAPL250117C00150000: {
              latestQuote: { bp: 5.0, ap: 5.2 },
              greeks: { delta: 0.55 },
              impliedVolatility: 0.32,
              dailyBar: { v: 4200 },
              openInterest: 3100,
            },
            AAPL250117P00150000: {
              latestQuote: { bp: 3.0, ap: 3.2 },
              greeks: { delta: -0.45 },
              dailyBar: { v: 900 },
            },
            NOT_AN_OCC_SYMBOL: { dailyBar: { v: 1 } },
          },
        });
      }
      return jsonResponse({}, 404);
    });
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);

    const chain = await adapter.getOptionChain("AAPL");

    expect(chain).toHaveLength(2); // the non-OCC key is dropped
    const call = chain.find((c) => c.type === "call");
    expect(call).toMatchObject({
      symbol: "AAPL250117C00150000",
      strike: 150,
      expiry: "2025-01-17",
      delta: 0.55, // absolute value
      openInterest: 3100,
      dayVolume: 4200,
    });
    const put = chain.find((c) => c.type === "put");
    // delta absolute, missing OI defaults to 0
    expect(put).toMatchObject({ delta: 0.45, openInterest: 0, dayVolume: 900 });
  });

  it("always places crypto as a market order regardless of clock", async () => {
    let orderBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/v2/orders") && init?.method === "POST") {
        orderBody = JSON.parse(String(init.body));
        return jsonResponse({ id: "crypto-closed", filled_avg_price: "60000" });
      }
      return jsonResponse({}, 404);
    });
    const adapter = new AlpacaAdapter(credentials, closedClock);

    await adapter.placeOrder({
      instrumentSymbol: "BTC/USD",
      instrumentType: "crypto",
      side: "BUY",
      sizeUsd: 500,
      clientOrderId: "client-crypto-closed",
    });

    expect(orderBody).toMatchObject({
      type: "market",
      time_in_force: "gtc",
      notional: "500",
    });
  });

  it("placeOrderV2 limit+units posts qty and limit_price", async () => {
    let orderBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/v2/orders") && init?.method === "POST") {
        orderBody = JSON.parse(String(init.body));
        return jsonResponse({ id: "lim-1", filled_avg_price: "185.00" });
      }
      return jsonResponse({}, 404);
    });
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);

    const result = await adapter.placeOrderV2({
      clientOrderId: "client-lim",
      instrument: { symbol: "AAPL", instrumentClass: "stock" },
      side: "BUY",
      quantity: { kind: "units", value: 3 },
      orderType: "limit",
      limitPrice: 185.5,
      timeInForce: "day",
    });

    expect(result.brokerOrderId).toBe("lim-1");
    expect(result.filledAvgPrice).toBe(185);
    expect(orderBody).toMatchObject({
      type: "limit",
      qty: "3",
      limit_price: "185.5",
      time_in_force: "day",
    });
  });

  it("placeOrderV2 market+units posts qty market order", async () => {
    let orderBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/v2/orders") && init?.method === "POST") {
        orderBody = JSON.parse(String(init.body));
        return jsonResponse({ id: "mkt-qty-1", filled_avg_price: "184.00" });
      }
      return jsonResponse({}, 404);
    });
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);

    await adapter.placeOrderV2({
      clientOrderId: "client-mkt-qty",
      instrument: { symbol: "AAPL", instrumentClass: "stock" },
      side: "BUY",
      quantity: { kind: "units", value: 5 },
      orderType: "market",
      timeInForce: "day",
    });

    expect(orderBody).toMatchObject({
      type: "market",
      qty: "5",
      time_in_force: "day",
    });
    expect(orderBody).not.toHaveProperty("notional");
  });

  it("createOrderEventFeed returns a feed that starts and stops", async () => {
    const adapter = new AlpacaAdapter(credentials, regularHoursClock);
    expect(adapter.capabilities.supportsStreaming).toBe(false);

    const feed = adapter.createOrderEventFeed();
    expect(feed).toBeDefined();
    expect(typeof feed.start).toBe("function");
    expect(typeof feed.stop).toBe("function");
    expect(typeof feed.onEvent).toBe("function");
    expect(typeof feed.watchOrders).toBe("function");

    await expect(feed.start()).resolves.toBeUndefined();
    feed.watchOrders?.(["alpaca-order-1"]);
    await expect(feed.stop()).resolves.toBeUndefined();
  });
});
