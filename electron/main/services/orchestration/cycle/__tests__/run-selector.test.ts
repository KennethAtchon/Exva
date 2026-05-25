import { describe, expect, it, vi } from "vitest";
import { MarketHoursService } from "../market-hours-service";
import * as runSelectorModule from "../selector/run-selector";

describe("runSelector", () => {
  it("filters non-tradable instruments and keeps tradable ones", async () => {
    vi.spyOn(
      MarketHoursService.prototype,
      "partitionByTradability",
    ).mockImplementation((rows) => ({
      tradable: rows.filter((row) => row.symbol === "BTC-USD"),
      excluded: rows
        .filter((row) => row.symbol !== "BTC-USD")
        .map((row) => ({
          symbol: row.symbol,
          instrumentClass: row.instrumentClass,
          reason: "closed",
        })),
    }));

    const ctx = {
      sessionId: "session-1",
      deps: {
        ai: {
          runPlan: async () => ({
            source: "ai_picker",
            output: {
              instruments: [
                { symbol: "AAPL", instrumentClass: "stock" },
                { symbol: "BTC-USD", instrumentClass: "crypto" },
              ],
            },
          }),
        },
        bus: { emit: vi.fn() },
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      },
      emitEvent: vi.fn(),
      getFailureHistory: vi.fn(() => []),
      getNearestRetryAt: vi.fn(() => null),
      getFailureHistoryForInstrument: vi.fn(() => []),
    };

    const out = await runSelectorModule.runSelector(
      ctx as never,
      {} as never,
      { max_concurrent_trades: 5 } as never,
      "cycle-1",
    );

    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe("BTC-USD");
  });

  it("returns empty list when no instruments are tradable", async () => {
    vi.spyOn(
      MarketHoursService.prototype,
      "partitionByTradability",
    ).mockReturnValue({ tradable: [], excluded: [] });

    const ctx = {
      sessionId: "session-1",
      deps: {
        ai: {
          runPlan: async () => ({
            source: "manual_shortlist",
            output: { instruments: [] },
          }),
        },
        bus: { emit: vi.fn() },
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      },
      emitEvent: vi.fn(),
      getFailureHistory: vi.fn(() => []),
      getNearestRetryAt: vi.fn(() => null),
      getFailureHistoryForInstrument: vi.fn(() => []),
    };

    await expect(
      runSelectorModule.runSelector(
        ctx as never,
        {} as never,
        { max_concurrent_trades: 5 } as never,
        "cycle-1",
      ),
    ).resolves.toEqual([]);
  });
});
