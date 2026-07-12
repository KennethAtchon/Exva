import { describe, expect, it, vi } from "vitest";
import type {
  PeriodAutopsyPreview,
  PeriodAutopsyRecord,
} from "@electron/shared/domain/autopsy";
import {
  priorUtcCalendarDayWindow,
  runPeriodAutopsyNightly,
} from "./period-autopsy-nightly";

function previewOf(
  partial: Partial<PeriodAutopsyPreview>,
): PeriodAutopsyPreview {
  return {
    tradeCount: 0,
    estimatedPromptTokens: 0,
    estimatedCostUsd: 0,
    lastAutopsyAt: null,
    lastAutopsyTradeCount: 0,
    ...partial,
  };
}

describe("period-autopsy-nightly", () => {
  it("builds prior UTC calendar day window", () => {
    const { windowStart, windowEnd } = priorUtcCalendarDayWindow(
      new Date("2026-07-12T15:30:00.000Z"),
    );
    expect(windowStart).toBe("2026-07-11T00:00:00.000Z");
    expect(windowEnd).toBe("2026-07-12T00:00:00.000Z");
  });

  it("returns early when preview has zero trades", async () => {
    const preview = vi.fn(() => previewOf({ tradeCount: 0 }));
    const run = vi.fn();

    const result = await runPeriodAutopsyNightly({
      preview,
      run,
      optInRun: true,
      now: () => new Date("2026-07-12T12:00:00.000Z"),
    });

    expect(result.ran).toBe(false);
    expect(result.summary).toContain("0 trades");
    expect(run).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "global",
        windowStart: "2026-07-11T00:00:00.000Z",
        windowEnd: "2026-07-12T00:00:00.000Z",
        filters: expect.objectContaining({ outcome: "all" }),
      }),
    );
  });

  it("skips when estimated cost exceeds $5 without soft flag", async () => {
    const preview = vi.fn(() =>
      previewOf({ tradeCount: 12, estimatedCostUsd: 6.5 }),
    );
    const run = vi.fn();

    const result = await runPeriodAutopsyNightly({
      preview,
      run,
      optInRun: true,
    });

    expect(result.ran).toBe(false);
    expect(result.summary).toContain("skip high cost");
    expect(run).not.toHaveBeenCalled();
  });

  it("preview-only by default even when cheap", async () => {
    const preview = vi.fn(() =>
      previewOf({ tradeCount: 4, estimatedCostUsd: 0.4 }),
    );
    const run = vi.fn();

    const result = await runPeriodAutopsyNightly({ preview, run });

    expect(result.ran).toBe(false);
    expect(result.summary).toContain("preview-only");
    expect(run).not.toHaveBeenCalled();
  });

  it("runs when opt-in and cost <= $1", async () => {
    const preview = vi.fn(() =>
      previewOf({ tradeCount: 3, estimatedCostUsd: 0.75 }),
    );
    const record = {
      id: "period-1",
      tradeCount: 3,
      totalCostUsd: 0.8,
    } as PeriodAutopsyRecord;
    const run = vi.fn(async () => record);

    const result = await runPeriodAutopsyNightly({
      preview,
      run,
      optInRun: true,
    });

    expect(result.ran).toBe(true);
    expect(result.record).toBe(record);
    expect(result.summary).toContain("ran 3 trades");
    expect(result.summary).toContain("period-1");
    expect(run).toHaveBeenCalledOnce();
  });
});
