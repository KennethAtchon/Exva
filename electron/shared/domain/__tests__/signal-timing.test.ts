import { describe, expect, it } from "vitest";
import {
  formatSignalSourceTimingSubtitle,
  formatSignalTimingLabel,
  resolveOhlcvTimeframe,
  scheduleDisplayName,
  signalDisplayName,
  summarizeSignalTiming,
} from "../signal-timing";
import type {
  ScheduledScanDescriptor,
  SignalDescriptor,
} from "../signal-descriptor";

const meanReversionSpy: ScheduledScanDescriptor = {
  id: "spy-15m-meanrev",
  instrumentClass: "stock",
  symbol: "SPY",
  cadence: "15m",
  defaultAnalysisTimeframe: "1h",
  enabledByDefault: true,
  mockFixtures: {
    defaultScenario: "clean_breakout",
    scriptedWorkerOutputs: {},
  },
};

const breakoutBtc: ScheduledScanDescriptor = {
  id: "btc-1h-breakout",
  instrumentClass: "crypto",
  symbol: "BTC-USD",
  cadence: "1h",
  defaultAnalysisTimeframe: "4h",
  enabledByDefault: true,
  mockFixtures: {
    defaultScenario: "clean_breakout",
    scriptedWorkerOutputs: {},
  },
};

const legacyTimerDescriptor: SignalDescriptor = {
  id: "legacy-timer",
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

describe("signal timing labels", () => {
  it("shows poll cadence separately from the bar timeframe traded on", () => {
    expect(scheduleDisplayName(meanReversionSpy)).toBe(
      "SPY · polls every 15m · trades on 1h bars",
    );
    expect(
      summarizeSignalTiming({
        sourceType: "timer",
        pollCadence: meanReversionSpy.cadence,
        analysisTimeframe: meanReversionSpy.defaultAnalysisTimeframe,
      }),
    ).toEqual({
      pollLabel: "polls every 15m",
      tradingTimeframeLabel: "trades on 1h bars",
    });
  });

  it("allows poll cadence and trading timeframe to differ", () => {
    expect(
      formatSignalTimingLabel({
        sourceType: "timer",
        symbol: "SPY",
        pollCadence: "30m",
        analysisTimeframe: "15m",
      }),
    ).toBe("SPY · polls every 30m · trades on 15m bars");
  });

  it("shows matching poll and trading labels when both are 4h", () => {
    expect(
      formatSignalTimingLabel({
        sourceType: "timer",
        symbol: "GC",
        pollCadence: "4h",
        analysisTimeframe: "4h",
      }),
    ).toBe("GC · polls every 4h · trades on 4h bars");
  });

  it("describes breakout poll cadence separately from trading timeframe", () => {
    expect(scheduleDisplayName(breakoutBtc)).toBe(
      "BTC-USD · polls every 1h · trades on 4h bars",
    );
  });

  it("still formats legacy timer SignalDescriptors for dual-read", () => {
    expect(signalDisplayName(legacyTimerDescriptor)).toBe(
      "SPY · polls every 15m · trades on 1h bars",
    );
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
