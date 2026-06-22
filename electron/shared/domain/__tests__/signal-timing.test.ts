import { describe, expect, it } from "vitest";
import {
  formatSignalSourceTimingSubtitle,
  formatSignalTimingLabel,
  resolveOhlcvTimeframe,
  signalDisplayName,
  summarizeSignalTiming,
} from "../signal-timing";
import type { SignalDescriptor } from "../signal-descriptor";

const meanReversionSpy: SignalDescriptor = {
  id: "spy-15m-meanrev",
  sourceType: "timer",
  instrumentClass: "stock",
  symbol: "SPY",
  pollCadence: "15m",
  defaultAnalysisTimeframe: "1h",
  enabledByDefault: true,
  mockFixtures: {
    defaultScenario: "clean_breakout",
    scriptedWorkerOutputs: {},
  },
};

const breakoutBtc: SignalDescriptor = {
  id: "btc-1h-breakout",
  sourceType: "timer",
  instrumentClass: "crypto",
  symbol: "BTC-USD",
  pollCadence: "1h",
  defaultAnalysisTimeframe: "4h",
  enabledByDefault: true,
  mockFixtures: {
    defaultScenario: "clean_breakout",
    scriptedWorkerOutputs: {},
  },
};

describe("signal timing labels", () => {
  it("shows distinct trade cadence and OHLCV timeframe for mean reversion", () => {
    expect(signalDisplayName(meanReversionSpy)).toBe(
      "SPY · checks every 15m · OHLCV 1h",
    );
    expect(summarizeSignalTiming(meanReversionSpy)).toEqual({
      tradeCadence: "checks every 15m",
      ohlcvTimeframe: "OHLCV 1h",
    });
  });

  it("shows matching trade and OHLCV labels when cadences align", () => {
    expect(
      formatSignalTimingLabel({
        sourceType: "timer",
        symbol: "GC",
        pollCadence: "4h",
        analysisTimeframe: "4h",
      }),
    ).toBe("GC · checks every 4h · OHLCV 4h");
  });

  it("describes breakout trade cadence separately from OHLCV bars", () => {
    expect(signalDisplayName(breakoutBtc)).toBe(
      "BTC-USD · checks every 1h · OHLCV 4h",
    );
  });

  it("formats event-driven sources with accurate trade and analysis labels", () => {
    expect(
      formatSignalTimingLabel({
        sourceType: "edgar_8k",
        symbol: null,
        pollCadence: null,
        analysisTimeframe: "1d",
      }),
    ).toBe(
      "EDGAR 8-K · on 8-K filing (polls ~5m market / ~30m off-hours) · OHLCV 1d",
    );

    expect(
      formatSignalSourceTimingSubtitle({
        type: "prediction_event",
        pollCadence: "15m",
        analysisTimeframe: "1h",
      }),
    ).toBe(
      "Trade: on dislocation (checks every 15m) · Analyze: context 1h (odds, not OHLCV)",
    );
  });

  it("resolves OHLCV timeframe from analysisTimeframe metadata, not poll cadence", () => {
    expect(
      resolveOhlcvTimeframe({
        pollCadence: "15m",
        analysisTimeframe: "1h",
      }),
    ).toBe("1h");
    expect(
      resolveOhlcvTimeframe({
        cadence: "15m",
        analysisTimeframe: "4h",
      }),
    ).toBe("4h");
  });
});
