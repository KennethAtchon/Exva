import { describe, expect, it, vi } from "vitest";
import { fetchPredictionMarketCandidates } from "./prediction-market-candidate-engine";

describe("fetchPredictionMarketCandidates", () => {
  it("maps current Gamma clobTokenIds/outcomes/outcomePrices into YES/NO candidates", async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const longConditionId = `0x${"ab".repeat(32)}`;
    const brokerRouting = {
      resolveAdapter: vi.fn(async () => ({
        adapter: {
          fetchMarketCandidates: vi.fn(async () => [
            {
              conditionId: longConditionId,
              question: "Will CPI beat expectations?",
              slug: "cpi-beat",
              category: "macro",
              endDate: future,
              liquidity: 20_000,
              clobTokenIds: JSON.stringify(["yes-1", "no-1"]),
              outcomes: JSON.stringify(["Yes", "No"]),
              outcomePrices: JSON.stringify(["0.42", "0.58"]),
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
    expect(rows[0]?.symbol.length).toBeGreaterThan(20);
    expect(rows[0]).toMatchObject({
      symbol: `pm:${longConditionId}`,
      instrumentClass: "prediction_market",
      predictionOutcome: "YES",
      instrumentDisplayName: "Will CPI beat expectations?",
    });
    expect(JSON.parse(rows[0]?.instrumentMetadataJson ?? "{}")).toMatchObject({
      conditionId: longConditionId,
      outcomeTokenId: "yes-1",
      yesOutcomeTokenId: "yes-1",
      noOutcomeTokenId: "no-1",
      marketMid: 0.42,
    });
    expect(JSON.parse(rows[1]?.instrumentMetadataJson ?? "{}")).toMatchObject({
      marketMid: 0.42,
      outcomeTokenId: "no-1",
    });
    expect(rows[1]).toMatchObject({
      predictionOutcome: "NO",
    });
  });

  it("still accepts legacy tokens fixtures", async () => {
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
                { outcome: "Yes", token_id: "yes-1", price: "0.55" },
                { outcome: "No", token_id: "no-1", price: "0.45" },
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
  });

  it("rethrows when discovery routing fails", async () => {
    await expect(
      fetchPredictionMarketCandidates("session-2", {
        resolveAdapter: vi.fn(async () => {
          throw new Error("no broker");
        }),
      } as never),
    ).rejects.toThrow("no broker");
  });
});
