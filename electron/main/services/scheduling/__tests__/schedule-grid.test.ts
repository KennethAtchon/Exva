import { describe, expect, it } from "vitest";
import { cadenceToMs } from "@electron/shared/domain/experience-inputs/cadence";
import {
  delayUntilNextGridMs,
  expectedEligibleMinutes,
  marketOpenAt,
  nextGridFireAt,
} from "../schedule-grid";

describe("schedule-grid", () => {
  it("computes expected eligible minutes for a weekday", () => {
    expect(expectedEligibleMinutes("2026-07-29")).toBe(390);
    expect(expectedEligibleMinutes("2026-07-26")).toBe(0);
  });

  it("returns next grid slot after market open", () => {
    const dayKey = "2026-07-29";
    const open = marketOpenAt(dayKey);
    const justAfterOpen = new Date(open.getTime() + 60_000);
    const next = nextGridFireAt({
      now: justAfterOpen,
      cadence: { kind: "interval", every: 15, unit: "minute", jitterPct: 0.05 },
      analysisTimeframe: "15m",
      marketCalendarId: "nyse-regular",
    });
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(justAfterOpen.getTime());
  });

  it("aligns delay to cadence minimum when market closed", () => {
    const saturday = new Date("2026-07-26T14:00:00.000Z");
    const cadence = {
      kind: "interval" as const,
      every: 15,
      unit: "minute" as const,
      jitterPct: 0.05,
    };
    expect(delayUntilNextGridMs({
      now: saturday,
      cadence,
      analysisTimeframe: "15m",
      marketCalendarId: "nyse-regular",
    })).toBe(cadenceToMs(cadence));
  });
});
