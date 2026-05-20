import { describe, expect, it, vi } from "vitest";
import { MarketHoursService } from "../market-hours-service";
import * as runSelectorModule from "../selector/run-selector";

describe("runSelector", () => {
  it("filters non-tradable instruments and keeps tradable ones", async () => {
    vi.spyOn(MarketHoursService.prototype, "filterTradable").mockImplementation(
      (rows) => rows.filter((row) => row.symbol === "BTC-USD"),
    );

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
      },
      emitEvent: vi.fn(),
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
    vi.spyOn(MarketHoursService.prototype, "filterTradable").mockReturnValue(
      [],
    );

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
      },
      emitEvent: vi.fn(),
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
