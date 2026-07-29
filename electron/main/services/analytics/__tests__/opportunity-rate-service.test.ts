import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import {
  mapInstrumentKindToOpportunity,
  OpportunityRateService,
  type ScanEvaluationRecord,
} from "../opportunity-rate-service";

function record(
  overrides: Partial<ScanEvaluationRecord> = {},
): ScanEvaluationRecord {
  return {
    sessionId: "sess-1",
    groupKey: "grp-1",
    strategyId: "mean-reversion",
    symbol: "SPY",
    timeframe: "1h",
    evaluatedAt: "2026-07-29T14:00:00.000Z",
    barWindowHash: "bar-a",
    storedBars: 400,
    minEvaluableBars: 50,
    outcome: "no_setup",
    ...overrides,
  };
}

describe("OpportunityRateService helpers", () => {
  it("maps executor kinds to opportunity outcomes", () => {
    expect(mapInstrumentKindToOpportunity("signal")).toBe("setup");
    expect(mapInstrumentKindToOpportunity("insufficient_bars")).toBe(
      "insufficient_history",
    );
    expect(mapInstrumentKindToOpportunity("input_stale")).toBe("stale");
    expect(mapInstrumentKindToOpportunity("no_setup")).toBe("no_setup");
    expect(mapInstrumentKindToOpportunity("bars_failed")).toBe("error");
  });
});

describe("OpportunityRateService.summarize", () => {
  it("counts a re-look at the same bar window as a repeat, not a fresh chance", () => {
    const db = createTestDb();
    const service = new OpportunityRateService(db);

    service.record([
      record({ barWindowHash: "bar-a" }),
      // Same window, later scan tick — the strategy got no new information.
      record({
        barWindowHash: "bar-a",
        evaluatedAt: "2026-07-29T14:15:00.000Z",
      }),
      record({
        barWindowHash: "bar-b",
        evaluatedAt: "2026-07-29T15:00:00.000Z",
        outcome: "setup",
      }),
    ]);

    const summary = service.summarize("sess-1", "2026-07-29");

    expect(summary.total).toBe(3);
    expect(summary.eligibleEvaluations).toBe(2);
    expect(summary.repeatEvaluations).toBe(1);
    expect(summary.setups).toBe(1);
    expect(summary.setupRate).toBe(0.5);
  });

  it("separates a starved lane from a selective one", () => {
    const db = createTestDb();
    const service = new OpportunityRateService(db);

    service.record([
      record({
        outcome: "insufficient_history",
        barWindowHash: "bar-a",
        storedBars: 21,
      }),
      record({
        outcome: "insufficient_history",
        barWindowHash: "bar-b",
        evaluatedAt: "2026-07-29T15:00:00.000Z",
        storedBars: 21,
      }),
    ]);

    const summary = service.summarize("sess-1", "2026-07-29");

    expect(summary.eligibleEvaluations).toBe(0);
    expect(summary.setupRate).toBe(0);
    expect(summary.blockedByHistory).toBe(2);
    expect(summary.blockedByHistoryRate).toBe(1);
  });

  it("scopes to the requested session and day", () => {
    const db = createTestDb();
    const service = new OpportunityRateService(db);

    service.record([
      record({ barWindowHash: "bar-a" }),
      record({ sessionId: "sess-2", barWindowHash: "bar-a" }),
      record({
        barWindowHash: "bar-c",
        evaluatedAt: "2026-07-28T14:00:00.000Z",
      }),
    ]);

    expect(service.summarize("sess-1", "2026-07-29").total).toBe(1);
    expect(service.summarize("sess-2", "2026-07-29").total).toBe(1);
    expect(service.summarize("sess-1", "2026-07-28").total).toBe(1);
  });
});
