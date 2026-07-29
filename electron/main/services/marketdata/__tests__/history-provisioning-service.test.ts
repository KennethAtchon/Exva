import { describe, expect, it, vi } from "vitest";
import { HistoryProvisioningService } from "../history-provisioning-service";
import type { HistoricalBackfillInput } from "../historical-backfill-service";

describe("HistoryProvisioningService", () => {
  it("automatically fetches enough equity history for warmup and context", async () => {
    const bars = Array.from({ length: 301 }, (_, index) => ({
      ts: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    }));
    const getBars = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(bars);
    const backfill = vi.fn(async (input: HistoricalBackfillInput) => ({
      chunks: input.symbol === "SPY" ? 1 : 0,
      barsWritten: 301,
    }));
    const now = new Date("2026-07-29T12:00:00.000Z");
    const service = new HistoryProvisioningService({
      marketData: { getBars },
      backfill: { backfill },
      now: () => now,
    } as never);

    await expect(
      service.ensure({
        symbol: "SPY",
        instrumentClass: "stock",
        timeframe: "1h",
        contract: {
          minEvaluableBars: 50,
          preferredContextBars: 250,
          warmupBars: 300,
        },
        brokerAccountId: "alpaca",
      }),
    ).resolves.toMatchObject({ kind: "satisfied", storedBars: 301 });

    expect(getBars).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ barCount: 301 }),
    );
    expect(getBars).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ barCount: 301 }),
    );
    const request = backfill.mock.calls.at(0)?.[0];
    expect(request).toBeDefined();
    if (!request) throw new Error("Expected an automatic backfill request");
    expect(now.getTime() - new Date(request.startIso).getTime()).toBe(
      301 * 60 * 60_000 * 6,
    );
  });

  it("shares one backfill across concurrent requests for the same lane", async () => {
    const getBars = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        Array.from({ length: 250 }, (_, index) => ({
          ts: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
        })),
      );
    const backfill = vi.fn(async (input: HistoricalBackfillInput) => ({
      chunks: input.symbol === "QQQ" ? 1 : 0,
      barsWritten: 250,
    }));
    const service = new HistoryProvisioningService({
      marketData: { getBars },
      backfill: { backfill },
    } as never);
    const input = {
      symbol: "QQQ",
      instrumentClass: "stock" as const,
      timeframe: "1h" as const,
      contract: {
        minEvaluableBars: 50,
        preferredContextBars: 250,
        warmupBars: 21,
      },
      brokerAccountId: "alpaca",
    };

    const first = service.ensure(input);
    const second = service.ensure(input);

    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(backfill).toHaveBeenCalledTimes(1);
  });
});
