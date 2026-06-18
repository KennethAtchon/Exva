import { beforeAll, describe, expect, it, vi } from "vitest";
import { MarketHoursService } from "../market-hours-service";
import { registerDefaultInstrumentAnalyses } from "../../../pipeline/implementations/registry/register-analyses";
import * as runSelectorModule from "../selector/run-selector";

// Each resolved instrument is stamped with the session's pipeline, derived from
// its experience — so the selector needs a registered experience.
const SESSION = { id: "session-1", experienceId: "edgar-catalyst" };

describe("runSelector", () => {
  beforeAll(() => {
    registerDefaultInstrumentAnalyses();
  });

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
      SESSION as never,
      { max_concurrent_trades: 5 } as never,
      { cycleId: "cycle-1" },
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
        SESSION as never,
        { max_concurrent_trades: 5 } as never,
        { cycleId: "cycle-1" },
      ),
    ).resolves.toEqual([]);
  });

  it("passes signal-trigger context into the selector pipeline", async () => {
    const runPlan = vi.fn(async () => ({
      source: "phase",
      output: { instruments: [{ symbol: "AAPL", instrumentClass: "stock" }] },
    }));
    const ctx = {
      sessionId: "session-1",
      deps: {
        ai: { runPlan },
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

    await runSelectorModule.runSelector(
      ctx as never,
      SESSION as never,
      { max_concurrent_trades: 5 } as never,
      {
        cycleId: "cycle-1",
        signalTrigger: {
          deliveryId: "delivery-1",
          signalId: "signal-1",
          sourceType: "edgar_8k",
          ticker: "AAPL",
          companyName: "Apple Inc.",
          documentUrl: "https://example.com/8k",
          accessionNumber: "0000000000-00-000000",
          payloadJson: { summary: "8-K item" },
        },
      },
    );

    expect(runPlan).toHaveBeenCalledWith(
      "selector",
      expect.objectContaining({
        input: expect.objectContaining({
          signalTrigger: expect.objectContaining({
            sourceType: "edgar_8k",
            ticker: "AAPL",
          }),
        }),
      }),
    );
  });
});
