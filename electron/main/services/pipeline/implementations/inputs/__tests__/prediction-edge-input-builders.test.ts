import { describe, expect, it } from "vitest";
import { predictionEdgeInputBuilder } from "../prediction-edge-input-builders";
import {
  encodeForecastSummary,
  encodeRedTeamSummary,
  predictionForecastSchema,
  predictionRedTeamSchema,
} from "@electron/shared/ai/prediction-research";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";

function ctxWith(metadata: Record<string, unknown>) {
  return {
    sessionId: "s1",
    cycleId: "c1",
    session: { experienceId: "prediction-event-edge" },
    instrument: {
      symbol: "pm:cond-1",
      instrumentClass: "prediction_market",
      instrumentMetadataJson: JSON.stringify(metadata),
    },
  } as never;
}

function stateWith(
  forecast: Record<string, unknown> | null,
  redTeam: Record<string, unknown> | null,
) {
  return {
    fundamental: forecast
      ? {
          output: {
            rawSummary: encodeForecastSummary(
              predictionForecastSchema.parse(forecast),
            ),
          },
        }
      : undefined,
    review: redTeam
      ? {
          output: {
            rawSummary: encodeRedTeamSummary(
              predictionRedTeamSchema.parse(redTeam),
            ),
          },
        }
      : undefined,
  } as never;
}

function run(
  metadata: Record<string, unknown>,
  forecast: Record<string, unknown> | null,
  redTeam: Record<string, unknown> | null,
): TradeSignal {
  const result = predictionEdgeInputBuilder.build({
    planCtx: ctxWith(metadata),
    state: stateWith(forecast, redTeam),
  }) as { task: TradeSignal };
  return result.task;
}

describe("prediction-edge decision engine", () => {
  it("buys when the combined forecast clears the market mid net of costs", () => {
    const signal = run(
      { marketMid: 0.5 },
      { pHat: 0.7, uncertaintyBps: 600 },
      { pHat: 0.68, uncertaintyBps: 600 },
    );
    expect(signal.action).toBe("buy");
    expect(signal.executionStrategy).toBe("prediction_market");
    expect(signal.reasoning).toMatch(/net edge/i);
  });

  it("sells (NO) when the forecast is below the market mid", () => {
    const signal = run(
      { marketMid: 0.6 },
      { pHat: 0.3, uncertaintyBps: 600 },
      { pHat: 0.32, uncertaintyBps: 600 },
    );
    expect(signal.action).toBe("sell");
  });

  it("skips a thin edge that does not survive costs", () => {
    const signal = run(
      { marketMid: 0.5 },
      { pHat: 0.52, uncertaintyBps: 600 },
      { pHat: 0.52, uncertaintyBps: 600 },
    );
    expect(signal.action).toBe("skip");
  });

  it("skips when forecaster and red team disagree sharply (band too wide)", () => {
    const signal = run(
      { marketMid: 0.5 },
      { pHat: 0.85, uncertaintyBps: 500 },
      { pHat: 0.4, uncertaintyBps: 500 },
    );
    // disagreement 4500bps widens band past the 2500 cap
    expect(signal.action).toBe("skip");
    expect(signal.reasoning).toMatch(/uncertainty/i);
  });

  it("skips stale information (already priced in)", () => {
    const signal = run(
      { marketMid: 0.5 },
      { pHat: 0.8, uncertaintyBps: 400, informationFreshness: "stale" },
      { pHat: 0.8, uncertaintyBps: 400 },
    );
    expect(signal.action).toBe("skip");
    expect(signal.reasoning).toMatch(/priced in|stale/i);
  });

  it("skips when the red team judges the catalyst already priced in", () => {
    const signal = run(
      { marketMid: 0.5 },
      { pHat: 0.8, uncertaintyBps: 400 },
      { pHat: 0.8, uncertaintyBps: 400, alreadyPricedIn: true },
    );
    expect(signal.action).toBe("skip");
  });

  it("skips when no market mid is available", () => {
    const signal = run({}, { pHat: 0.8, uncertaintyBps: 400 }, null);
    expect(signal.action).toBe("skip");
    expect(signal.reasoning).toMatch(/mid/i);
  });

  it("skips when there is no forecaster output at all", () => {
    const signal = run({ marketMid: 0.5 }, null, null);
    expect(signal.action).toBe("skip");
  });
});
