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
    const adapter = new AlpacaAdapter(credentials);

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
    const adapter = new AlpacaAdapter(credentials);

    const connection = await adapter.testConnection();
    const balance = await adapter.getAccountBalance();

    expect(connection).toMatchObject({
      ok: true,
      account_balance: 100000,
    });
    expect(balance).toBe(100000);
  });

  it("fetches quotes and places notional market orders", async () => {
    const adapter = new AlpacaAdapter(credentials);
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
    const adapter = new AlpacaAdapter(credentials);

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
    const adapter = new AlpacaAdapter(credentials);
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

  it("rejects non-stock instruments", async () => {
    const adapter = new AlpacaAdapter(credentials);

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "BTC-USD",
        instrumentType: "crypto",
        side: "BUY",
        sizeUsd: 500,
        clientOrderId: "client-2",
      }),
    ).rejects.toThrow(/stocks only/i);
  });
});
