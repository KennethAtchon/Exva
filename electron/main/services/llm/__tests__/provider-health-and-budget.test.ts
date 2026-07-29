import { describe, expect, it } from "vitest";
import { ProviderHealthTracker } from "../provider-health-tracker";
import { AiBudgetGuard } from "../ai-budget-guard";

describe("ProviderHealthTracker", () => {
  it("opens the circuit after sustained failure rate", () => {
    let now = Date.parse("2026-07-27T15:00:00.000Z");
    const tracker = new ProviderHealthTracker({
      now: () => new Date(now),
      minAttemptsForRate: 6,
      failureRateOpen: 0.5,
    });

    for (let i = 0; i < 6; i += 1) {
      tracker.recordFailure("openai", "gpt-4o", {
        code: "timeout",
        message: "timed out",
      });
    }
    expect(tracker.get("openai", "gpt-4o").state).toBe("open");
    expect(tracker.isAvailable("openai", "gpt-4o")).toBe(false);

    now += 5 * 60_000 + 1;
    expect(tracker.isAvailable("openai", "gpt-4o")).toBe(true);
    expect(tracker.get("openai", "gpt-4o").state).toBe("half_open");

    tracker.recordSuccess("openai", "gpt-4o");
    expect(tracker.get("openai", "gpt-4o").state).toBe("closed");
  });
});

describe("AiBudgetGuard", () => {
  it("denies when cycle budget would be exceeded", () => {
    const guard = new AiBudgetGuard({
      maxCycleUsd: 0.1,
      maxSessionUsd: 10,
      maxWorkspaceDayUsd: 50,
    });
    const decision = guard.check({
      cycleId: "c1",
      sessionId: "s1",
      workspaceDayKey: "2026-07-27",
      estimatedCostUsd: 0.2,
    });
    expect(decision.kind).toBe("deny");
    if (decision.kind === "deny") {
      expect(decision.reasonCode).toBe("cycle_budget_exhausted");
    }
  });

  it("allows and records spend under the cap", () => {
    const guard = new AiBudgetGuard({
      maxCycleUsd: 1,
      maxSessionUsd: 10,
      maxWorkspaceDayUsd: 50,
    });
    const decision = guard.check({
      cycleId: "c1",
      sessionId: "s1",
      workspaceDayKey: "2026-07-27",
      estimatedCostUsd: 0.25,
    });
    expect(decision.kind).toBe("allow");
    guard.record({
      cycleId: "c1",
      sessionId: "s1",
      workspaceDayKey: "2026-07-27",
      costUsd: 0.25,
    });
    expect(
      guard.snapshot({
        cycleId: "c1",
        sessionId: "s1",
        workspaceDayKey: "2026-07-27",
      }).cycleSpendUsd,
    ).toBe(0.25);
  });
});
