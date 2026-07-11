import { describe, expect, it, vi } from "vitest";
import { fetchPredictionMarketCandidates } from "./prediction-market-candidate-engine";

describe("fetchPredictionMarketCandidates", () => {
  it("maps discovery adapter rows into scored YES/NO candidates", async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const brokerRouting = {
      resolveAdapter: vi.fn(async () => ({
        adapter: {
          fetchMarketCandidates: vi.fn(async () => [
            {
              conditionId: "cond-abc",
              question: "Will CPI beat expectations?",
              slug: "cpi-beat",
              category: "macro",
              endDate: future,
              liquidity: 20_000,
              tokens: [
                { outcome: "Yes", token_id: "yes-1" },
                { outcome: "No", token_id: "no-1" },
              ],
            },
          ]),
        },
      })),
    };

    const rows = await fetchPredictionMarketCandidates(
      "session-1",
      brokerRouting as never,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      symbol: "pm:cond-abc",
      instrumentClass: "prediction_market",
      predictionOutcome: "YES",
      instrumentDisplayName: "Will CPI beat expectations?",
    });
    expect(JSON.parse(rows[0]?.instrumentMetadataJson ?? "{}")).toMatchObject({
      conditionId: "cond-abc",
      yesOutcomeTokenId: "yes-1",
      noOutcomeTokenId: "no-1",
    });
  });

  it("returns an empty list when discovery is unavailable", async () => {
    const rows = await fetchPredictionMarketCandidates("session-2", {
      resolveAdapter: vi.fn(async () => {
        throw new Error("no broker");
      }),
    } as never);

    expect(rows).toEqual([]);
  });
});
