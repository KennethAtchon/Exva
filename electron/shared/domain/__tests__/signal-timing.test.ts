import { describe, expect, it } from "vitest";
import {
  formatSignalSourceTimingSubtitle,
  formatSignalTimingLabel,
  resolveOhlcvTimeframe,
  summarizeSignalTiming,
} from "../signal-timing";

describe("signal timing labels", () => {
  it("shows poll cadence separately from the bar timeframe traded on", () => {
    expect(
      summarizeSignalTiming({
        sourceType: "prediction_event",
        pollCadence: "15m",
        analysisTimeframe: "1h",
      }),
    ).toEqual({
      pollLabel: "on dislocation, polls every 15m",
      tradingTimeframeLabel: "1h context (odds, not OHLCV)",
    });
  });

  it("allows poll cadence and trading timeframe to differ", () => {
    expect(
      formatSignalTimingLabel({
        sourceType: "prediction_event",
        symbol: "SPY",
        pollCadence: "30m",
        analysisTimeframe: "15m",
      }),
    ).toBe("SPY · on dislocation, polls every 30m · 15m context (odds, not OHLCV)");
  });

  it("formats event-driven sources with accurate poll and trading labels", () => {
    expect(
      formatSignalTimingLabel({
        sourceType: "edgar_8k",
        symbol: null,
        pollCadence: null,
        analysisTimeframe: "1d",
      }),
    ).toBe(
      "EDGAR 8-K · on 8-K filing (~5m market / ~30m off-hours poll) · trades on 1d bars",
    );

    expect(
      formatSignalSourceTimingSubtitle({
        type: "prediction_event",
        pollCadence: "15m",
        analysisTimeframe: "1h",
      }),
    ).toBe(
      "Poll: on dislocation, polls every 15m · 1h context (odds, not OHLCV)",
    );
  });

  it("resolves OHLCV timeframe from analysisTimeframe metadata, not poll cadence", () => {
    expect(
      resolveOhlcvTimeframe({
        pollCadence: "30m",
        analysisTimeframe: "15m",
      }),
    ).toBe("15m");
    expect(
      resolveOhlcvTimeframe({
        pollCadence: "15m",
        analysisTimeframe: "1h",
      }),
    ).toBe("1h");
  });
});
