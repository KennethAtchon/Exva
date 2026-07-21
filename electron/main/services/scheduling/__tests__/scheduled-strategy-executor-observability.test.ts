import { describe, expect, it } from "vitest";
import {
  isAllInstrumentsUnevaluable,
  summarizeScanExecution,
  type ScheduledExecutionResult,
} from "../scheduled-strategy-executor";

describe("scheduled scan observability helpers", () => {
  it("treats insufficient bars / fetch failures as unevaluable", () => {
    const result: ScheduledExecutionResult = {
      signals: [],
      instruments: [
        {
          symbol: "SPY",
          kind: "insufficient_bars",
          barsActual: 8,
          barsRequired: 20,
        },
        {
          symbol: "QQQ",
          kind: "insufficient_bars",
          barsActual: 8,
          barsRequired: 20,
        },
      ],
    };
    expect(isAllInstrumentsUnevaluable(result)).toBe(true);
    expect(summarizeScanExecution(result)).toMatchObject({
      signalCount: 0,
      counts: { insufficient_bars: 2 },
    });
  });

  it("treats a quiet no_setup evaluation as healthy/evaluable", () => {
    const result: ScheduledExecutionResult = {
      signals: [],
      instruments: [
        {
          symbol: "SPY",
          kind: "no_setup",
          barsActual: 21,
          barsRequired: 20,
        },
      ],
    };
    expect(isAllInstrumentsUnevaluable(result)).toBe(false);
  });
});
