import { beforeEach, describe, expect, it, vi } from "vitest";
import { TradierAdapter } from "../tradier-adapter";

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

describe("TradierAdapter money-field validation", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("throws BROKER_DATA when quote has no usable price", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ quotes: { quote: { symbol: "SPY" } } }),
    );
    const adapter = new TradierAdapter(
      { accessToken: "t", accountId: "a" },
      "paper",
    );
    await expect(adapter.getMarketSnapshot("SPY")).rejects.toMatchObject({
      code: "BROKER_DATA",
    });
  });

  it("throws BROKER_DATA when position quantity is missing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        positions: {
          position: [{ symbol: "SPY", cost_basis: 100 }],
        },
      }),
    );
    const adapter = new TradierAdapter(
      { accessToken: "t", accountId: "a" },
      "paper",
    );
    await expect(adapter.getPositions()).rejects.toMatchObject({
      code: "BROKER_DATA",
    });
  });

  it("allows explicit zero equity balance", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ balances: { total_equity: 0 } }),
    );
    const adapter = new TradierAdapter(
      { accessToken: "t", accountId: "a" },
      "paper",
    );
    await expect(adapter.getAccountBalance()).resolves.toBe(0);
  });

  it("throws BROKER_DATA when balance fields are absent", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ balances: {} }));
    const adapter = new TradierAdapter(
      { accessToken: "t", accountId: "a" },
      "paper",
    );
    await expect(adapter.getAccountBalance()).rejects.toMatchObject({
      code: "BROKER_DATA",
    });
  });

  it("skips OHLCV bars with missing prices instead of coercing to 0", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        history: {
          day: [
            { date: "2026-07-01", open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
            { date: "2026-07-02", open: null, high: 101, low: 99, close: 100 },
            { date: "2026-07-03", open: 102, high: 103, low: 101, close: 102.5, volume: 0 },
          ],
        },
      }),
    );
    const adapter = new TradierAdapter(
      { accessToken: "t", accountId: "a" },
      "paper",
    );
    const bars = await adapter.getOhlcv("SPY", "1d", 10);
    expect(bars).toHaveLength(2);
    expect(bars[0]?.close).toBe(100.5);
    expect(bars[1]?.close).toBe(102.5);
    expect(bars[1]?.volume).toBe(0);
  });

  it("skips option contracts with missing strike", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ expirations: { date: ["2026-08-15"] } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          options: {
            option: [
              {
                symbol: "SPY260815C00500000",
                option_type: "call",
                strike: 500,
                open_interest: 12,
                volume: 3,
              },
              {
                symbol: "SPY260815C00505000",
                option_type: "call",
                // missing strike — skipped
                open_interest: 1,
              },
            ],
          },
        }),
      );
    const adapter = new TradierAdapter(
      { accessToken: "t", accountId: "a" },
      "paper",
    );
    const chain = await adapter.getOptionChain("SPY");
    expect(chain).toHaveLength(1);
    expect(chain[0]?.strike).toBe(500);
    expect(chain[0]?.openInterest).toBe(12);
  });
});
