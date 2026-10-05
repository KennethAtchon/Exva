import { afterEach, describe, expect, test } from "bun:test";
import { AlpacaBroker } from "../src/broker/alpaca.ts";
import { etToEpoch } from "../src/core/calendar.ts";
import { AlpacaData } from "../src/data/alpaca-data.ts";
import { BrokerRejected, BrokerUnavailable, DataError } from "../src/errors.ts";
import { fakeServer } from "./fakes.ts";

const keys = { keyId: "PKTEST", secretKey: "SECRET" };
let stop: () => void = () => {};
afterEach(() => stop());

const rawOrder = (over: Record<string, unknown> = {}) => ({
  id: "b-1",
  client_order_id: "exva-ord_1",
  status: "accepted",
  filled_qty: "0",
  filled_avg_price: null,
  filled_at: null,
  updated_at: "2026-01-15T15:00:00Z",
  ...over,
});

describe("Alpaca broker", () => {
  test("crypto buys are notional, good-til-canceled, keyed by client order id", async () => {
    const srv = fakeServer(() => [200, rawOrder()]);
    stop = srv.stop;
    const b = new AlpacaBroker({ keys, baseUrl: srv.url });
    const o = await b.submit({
      clientOrderId: "exva-ord_1",
      symbol: "BTC/USD",
      side: "buy",
      notional: 10,
      refTs: 0,
    });
    const req = srv.requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/v2/orders");
    expect(req.headers.get("APCA-API-KEY-ID")).toBe("PKTEST");
    expect(req.body).toEqual({
      symbol: "BTC/USD",
      side: "buy",
      type: "market",
      time_in_force: "gtc",
      client_order_id: "exva-ord_1",
      notional: "10.00",
    });
    expect(o.status).toBe("submitted");
  });

  test("stock sells send the quantity with day time-in-force", async () => {
    const srv = fakeServer(() => [200, rawOrder()]);
    stop = srv.stop;
    await new AlpacaBroker({ keys, baseUrl: srv.url }).submit({
      clientOrderId: "c",
      symbol: "SPY",
      side: "sell",
      qty: 1.25,
      refTs: 0,
    });
    expect(srv.requests[0]!.body).toMatchObject({ time_in_force: "day", qty: "1.25" });
  });

  test("a filled order maps to filled, never to 'closed'", async () => {
    const srv = fakeServer(() => [
      200,
      rawOrder({
        status: "filled",
        filled_qty: "0.0001",
        filled_avg_price: "100000.5",
        filled_at: "2026-01-15T15:00:01Z",
      }),
    ]);
    stop = srv.stop;
    const o = await new AlpacaBroker({ keys, baseUrl: srv.url }).getOrder("b-1");
    expect(o).toMatchObject({
      status: "filled",
      filledQty: 0.0001,
      avgFillPrice: 100000.5,
      filledAt: Date.parse("2026-01-15T15:00:01Z"),
    });
  });

  test("done_for_day is still working; crypto sells carry Alpaca's estimated fee", async () => {
    let raw: Record<string, unknown> = rawOrder({ status: "done_for_day", filled_qty: "0" });
    const srv = fakeServer(() => [200, raw]);
    stop = srv.stop;
    const b = new AlpacaBroker({ keys, baseUrl: srv.url });
    expect((await b.getOrder("b-1"))?.status).toBe("submitted");
    raw = rawOrder({
      status: "filled",
      symbol: "BTC/USD",
      side: "sell",
      asset_class: "crypto",
      filled_qty: "0.01",
      filled_avg_price: "100000",
    });
    expect((await b.getOrder("b-1"))?.fee).toBeCloseTo(2.5, 8);
    raw = { ...raw, symbol: "SPY", asset_class: "us_equity" };
    expect((await b.getOrder("b-1"))?.fee).toBeUndefined();
  });

  test("unknown client order id is null; 4xx is a rejection; 5xx is retryable", async () => {
    let status = 404;
    const srv = fakeServer(() => [
      status,
      { message: status === 403 ? "insufficient buying power" : "nope" },
    ]);
    stop = srv.stop;
    const b = new AlpacaBroker({ keys, baseUrl: srv.url });
    expect(await b.getByClientId("missing")).toBeNull();
    expect(srv.requests[0]!.path).toBe("/v2/orders:by_client_order_id?client_order_id=missing");
    status = 403;
    await expect(
      b.submit({ clientOrderId: "c", symbol: "SPY", side: "buy", notional: 10, refTs: 0 }),
    ).rejects.toThrow(BrokerRejected);
    status = 503;
    await expect(b.account()).rejects.toThrow(BrokerUnavailable);
  });

  test("crypto positions come back as BTCUSD and are normalized", async () => {
    const srv = fakeServer(() => [
      200,
      [
        { symbol: "BTCUSD", asset_class: "crypto", qty: "0.0099", avg_entry_price: "100000" },
        { symbol: "SPY", asset_class: "us_equity", qty: "2", avg_entry_price: "500" },
      ],
    ]);
    stop = srv.stop;
    const pos = await new AlpacaBroker({ keys, baseUrl: srv.url }).positions();
    expect(pos.map((p) => p.symbol)).toEqual(["BTC/USD", "SPY"]);
  });

  test("calendar sessions become New York times", async () => {
    const srv = fakeServer(() => [200, [{ date: "2026-11-27", open: "09:30", close: "13:00" }]]);
    stop = srv.stop;
    const [s] = await new AlpacaBroker({ keys, baseUrl: srv.url }).calendar(
      "2026-11-27",
      "2026-11-27",
    );
    expect(s).toEqual({
      date: "2026-11-27",
      open: etToEpoch(2026, 11, 27, 9, 30),
      close: etToEpoch(2026, 11, 27, 13, 0),
    });
  });
});

describe("Alpaca market data", () => {
  test("follows page tokens and parses bar start times", async () => {
    const srv = fakeServer((r) => {
      const page2 = r.path.includes("page_token=p2");
      const bar = (t: string, c: number) => ({ t, o: c, h: c, l: c, c, v: 1 });
      return [
        200,
        {
          bars: {
            "BTC/USD": [
              bar(page2 ? "2026-01-15T00:15:00Z" : "2026-01-15T00:00:00Z", page2 ? 2 : 1),
            ],
          },
          next_page_token: page2 ? null : "p2",
        },
      ];
    });
    stop = srv.stop;
    const data = new AlpacaData({ keys: () => null, stockFeed: () => "iex", baseUrl: srv.url });
    const out = await data.fetchBars(
      ["BTC/USD"],
      "15m",
      Date.UTC(2026, 0, 15),
      Date.UTC(2026, 0, 16),
    );
    expect(out.get("BTC/USD")?.map((b) => [b.ts, b.c])).toEqual([
      [Date.UTC(2026, 0, 15, 0, 0), 1],
      [Date.UTC(2026, 0, 15, 0, 15), 2],
    ]);
    expect(srv.requests[0]!.path).toContain("/v1beta3/crypto/us/bars");
    expect(srv.requests[0]!.path).toContain("timeframe=15Min");
  });

  test("stock data needs keys and asks for the chosen feed", async () => {
    const srv = fakeServer(() => [200, { bars: {}, next_page_token: null }]);
    stop = srv.stop;
    const noKeys = new AlpacaData({ keys: () => null, stockFeed: () => "iex", baseUrl: srv.url });
    await expect(noKeys.fetchBars(["SPY"], "15m", 0, 1)).rejects.toThrow(DataError);
    const withKeys = new AlpacaData({ keys: () => keys, stockFeed: () => "sip", baseUrl: srv.url });
    await withKeys.fetchBars(["SPY"], "1h", 0, 3_600_000);
    expect(srv.requests[0]!.path).toContain("feed=sip");
    expect(srv.requests[0]!.path).toContain("timeframe=1Hour");
  });
});
