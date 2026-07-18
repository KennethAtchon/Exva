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
});
