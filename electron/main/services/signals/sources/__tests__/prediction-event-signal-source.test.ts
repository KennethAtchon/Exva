import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PredictionEventSignalSource } from "../prediction-event-signal-source";

function gammaMarkets(rows: Array<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("PredictionEventSignalSource", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls gamma markets and emits qualifying prediction events", async () => {
    fetchMock.mockResolvedValueOnce(
      gammaMarkets([
        {
          conditionId: "cond-1",
          question: "Will rates cut in June?",
          slug: "rates-june",
          category: "macro",
          liquidity: 25_000,
          lastTradePrice: 0.62,
          tokens: [{ outcome: "Yes", token_id: "yes-token-1" }],
        },
        {
          conditionId: "cond-2",
          question: "Low liquidity market",
          slug: "low-liq",
          liquidity: 100,
          lastTradePrice: 0.7,
          tokens: [{ outcome: "Yes", token_id: "yes-token-2" }],
        },
      ]),
    );

    const source = new PredictionEventSignalSource(
      "pm-1",
      JSON.stringify({ minLiquidityUsd: 5000, minPriceDeviation: 0.1 }),
    );
    const events: unknown[] = [];
    source.onSignal((event) => events.push(event));

    await source.start();
    await source.stop();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("gamma-api.polymarket.com/markets"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceType: "prediction_event",
      ticker: "pm:cond-1",
      payloadJson: expect.objectContaining({
        instrumentClass: "prediction_market",
        conditionId: "cond-1",
        outcomeTokenId: "yes-token-1",
      }),
    });
    expect(source.snapshot().lastPollResult).toMatchObject({
      detected: 2,
      passed: 1,
      dropped: 1,
    });
  });

  it("dedupes condition ids across polls", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(
      gammaMarkets([
        {
          conditionId: "cond-dedupe",
          question: "Election winner?",
          slug: "election",
          category: "politics",
          liquidity: 50_000,
          lastTradePrice: 0.8,
          tokens: [{ outcome: "Yes", token_id: "yes-token" }],
        },
      ]),
    );

    const source = new PredictionEventSignalSource(
      "pm-2",
      JSON.stringify({
        pollIntervalMinutes: 15,
        minLiquidityUsd: 1000,
        minPriceDeviation: 0.05,
      }),
    );
    const events: unknown[] = [];
    source.onSignal((event) => events.push(event));

    await source.start();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await source.stop();

    expect(events).toHaveLength(1);
    expect(source.snapshot().lastPollResult?.passed).toBe(0);
  });

  it("returns synthetic event from test() without network", async () => {
    const source = new PredictionEventSignalSource("pm-3", "{}");
    const events: unknown[] = [];
    source.onSignal((event) => events.push(event));

    const result = await source.test();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ passed: 1, detected: 1 });
    expect(events[0]).toMatchObject({
      companyName: "Synthetic prediction market event (test)",
      payloadJson: expect.objectContaining({ synthetic: true }),
    });
  });
});
