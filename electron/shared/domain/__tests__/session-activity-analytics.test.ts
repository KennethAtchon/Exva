import { describe, expect, it } from "vitest";
import { computeSessionActivityAnalytics } from "../session-activity-analytics";
import type { SessionActivitySnapshot } from "../session-activity";

function snap(
  updatedAt: string,
  conditions: SessionActivitySnapshot["conditions"],
): SessionActivitySnapshot {
  return {
    sessionId: "s1",
    activity: "test",
    conditions,
    updatedAt,
  };
}

describe("computeSessionActivityAnalytics", () => {
  it("aggregates frequency, severity, and error clear duration", () => {
    // Newest-first (repo order).
    const transitions = [
      snap("2026-07-20T12:00:00.000Z", []),
      snap("2026-07-20T11:30:00.000Z", [
        {
          kind: "data_feed_failing",
          severity: "error",
          message: "bars failed",
          since: "2026-07-20T11:00:00.000Z",
          count: 3,
          evidenceEventId: "e1",
        },
      ]),
      snap("2026-07-20T11:00:00.000Z", [
        {
          kind: "data_feed_failing",
          severity: "error",
          message: "bars failed",
          since: "2026-07-20T11:00:00.000Z",
          count: 1,
          evidenceEventId: "e1",
        },
        {
          kind: "waiting_scan_tick",
          severity: "info",
          message: "waiting",
          since: "2026-07-20T11:00:00.000Z",
          count: 1,
          evidenceEventId: "e2",
        },
      ]),
    ];

    const analytics = computeSessionActivityAnalytics(transitions);
    expect(analytics.transitionCount).toBe(3);
    expect(analytics.conditionFrequency.data_feed_failing).toBe(2);
    expect(analytics.conditionFrequency.waiting_scan_tick).toBe(1);
    expect(analytics.severityCounts.error).toBe(2);
    expect(analytics.errorClears).toBe(1);
    expect(analytics.avgErrorDurationMs).toBe(60 * 60 * 1000);
  });
});
