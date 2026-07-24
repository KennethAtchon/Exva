import { describe, expect, it, vi } from "vitest";
import { HistoricalBackfillService } from "../historical-backfill-service";

describe("HistoricalBackfillService", () => {
  it("re-fetches every requested monthly chunk and emits progress on idempotent reruns", async () => {
    const getOhlcvRange = vi.fn(async (_symbol, _timeframe, window) => [
      {
        ts: window.startIso,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
      },
    ]);
    const writeBars = vi.fn();
    const emit = vi.fn();
    const service = new HistoricalBackfillService({
      marketData: { writeBars } as never,
      eventBus: { emit } as never,
      resolveAdapter: async () => ({ brokerType: "alpaca", getOhlcvRange }),
      normalizeWireSymbol: ({ symbol }) => symbol,
      sleep: async () => undefined,
    });
    const input = {
      symbol: "SPY",
      instrumentClass: "stock" as const,
      timeframe: "1h" as const,
      startIso: "2026-01-01T00:00:00.000Z",
      endIso: "2026-03-01T00:00:00.000Z",
    };

    await service.backfill(input);
    await service.backfill(input);

    expect(getOhlcvRange).toHaveBeenCalledTimes(4);
    expect(writeBars).toHaveBeenCalledTimes(4);
    expect(emit).toHaveBeenLastCalledWith(
      "backfill_progress",
      expect.objectContaining({ done: true, barsWritten: 1 }),
    );
  });
});
