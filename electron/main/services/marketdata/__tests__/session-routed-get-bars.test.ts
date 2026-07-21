import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlpacaAdapter } from "../../broker/adapters/alpaca-adapter";
import {
  InstrumentNormalizer,
  resolveCanonicalSymbol,
} from "../../broker/instrument-normalizer";
import { createSessionRoutedGetBars } from "../session-routed-get-bars";

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

describe("createSessionRoutedGetBars", () => {
  const normalizer = new InstrumentNormalizer();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/v1beta3/crypto/us/bars")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            bars: {
              "BTC/USD": [
                {
                  t: "2026-07-20T15:00:00.000Z",
                  o: 1,
                  h: 2,
                  l: 0.5,
                  c: 1.5,
                  v: 10,
                },
              ],
            },
          }),
          text: async () => "",
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    });
  });

  it("routes scheduled BTC-USD to Alpaca crypto bars via the session account", async () => {
    const adapter = new AlpacaAdapter(
      {
        provider: "alpaca",
        api_key: "k",
        secret_key: "s",
        mode: "paper",
      },
      () => new Date("2026-07-20T15:00:00.000Z"),
    );
    const resolveAdapter = vi.fn(async () => ({
      brokerAccountId: "alpaca-session-1",
      adapter,
    }));

    const getBarsCb = createSessionRoutedGetBars({
      resolveFanout: () => [{ sessionId: "sess-1" }],
      resolveAdapter: resolveAdapter as never,
      toBrokerSymbol: (input) => normalizer.toBrokerSymbol(input),
      resolveCanonicalSymbol,
      getBars: async (input) => input.fetchOverride?.() ?? [],
      mapOhlcvTimeframe: () => "4h",
      marketDataProviderForBroker: () => "alpaca",
    });

    await getBarsCb("BTC-USD", "4h", 1, "crypto", {
      subscriptionIds: ["sub-1"],
    });

    expect(resolveAdapter).toHaveBeenCalledWith("sess-1", "crypto");
    const cryptoCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/v1beta3/crypto/us/bars"),
    );
    const stockCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/v2/stocks/"),
    );
    expect(cryptoCall).toBeTruthy();
    expect(stockCall).toBeUndefined();
    expect(String(cryptoCall?.[0])).toContain("BTC%2FUSD");
  });

  it("uses the session-assigned broker account, not a global first account", async () => {
    const resolveAdapter = vi.fn(async () => ({
      brokerAccountId: "assigned-alpaca",
      adapter: {
        brokerType: "alpaca",
        getOhlcv: vi.fn(async () => []),
      },
    }));
    const getBarsCb = createSessionRoutedGetBars({
      resolveFanout: () => [{ sessionId: "sess-pm" }],
      resolveAdapter: resolveAdapter as never,
      toBrokerSymbol: (input) => normalizer.toBrokerSymbol(input),
      resolveCanonicalSymbol,
      getBars: async (input) => input.fetchOverride?.() ?? [],
      mapOhlcvTimeframe: () => "1h",
      marketDataProviderForBroker: () => "alpaca",
    });

    await getBarsCb("SPY", "1h", 20, "stock", { subscriptionIds: ["sub-a"] });

    expect(resolveAdapter).toHaveBeenCalledWith("sess-pm", "stock");
    expect(resolveAdapter).toHaveBeenCalledTimes(1);
  });

  it("fails loud when no session fanout target exists", async () => {
    const getBarsCb = createSessionRoutedGetBars({
      resolveFanout: () => [],
      resolveAdapter: vi.fn(),
      toBrokerSymbol: (input) => normalizer.toBrokerSymbol(input),
      resolveCanonicalSymbol,
      getBars: vi.fn(),
      mapOhlcvTimeframe: () => "1h",
      marketDataProviderForBroker: () => "alpaca",
    });

    await expect(
      getBarsCb("BTC-USD", "4h", 21, "crypto", { subscriptionIds: [] }),
    ).rejects.toThrow(/session fanout/i);
  });
});
