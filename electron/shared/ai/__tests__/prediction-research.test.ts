import { describe, expect, it } from "vitest";
import {
  decodeForecastSummary,
  decodeRedTeamSummary,
  encodeForecastSummary,
  encodeRedTeamSummary,
  predictionForecastSchema,
  predictionRedTeamSchema,
} from "../prediction-research";

describe("prediction-research summaries", () => {
  it("round-trips a forecast through rawSummary", () => {
    const forecast = predictionForecastSchema.parse({
      pHat: 0.62,
      uncertaintyBps: 900,
      informationFreshness: "fresh",
      keyDrivers: ["recent polling", "endorsement"],
      reasoning: "leans yes",
    });
    const decoded = decodeForecastSummary(encodeForecastSummary(forecast));
    expect(decoded?.pHat).toBe(0.62);
    expect(decoded?.uncertaintyBps).toBe(900);
    expect(decoded?.informationFreshness).toBe("fresh");
  });

  it("round-trips a red-team result", () => {
    const rt = predictionRedTeamSchema.parse({
      pHat: 0.5,
      uncertaintyBps: 1200,
      alreadyPricedIn: true,
      reasoning: "news already moved the price",
    });
    const decoded = decodeRedTeamSummary(encodeRedTeamSummary(rt));
    expect(decoded?.alreadyPricedIn).toBe(true);
    expect(decoded?.pHat).toBe(0.5);
  });

  it("does not cross-decode the two kinds", () => {
    const forecast = encodeForecastSummary(
      predictionForecastSchema.parse({ pHat: 0.6 }),
    );
    // a forecast summary is not a red-team summary
    expect(decodeRedTeamSummary(forecast)).toBeNull();
    expect(decodeForecastSummary("not json")).toBeNull();
    expect(decodeForecastSummary(null)).toBeNull();
  });
});
