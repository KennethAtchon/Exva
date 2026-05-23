import { describe, expect, it } from "vitest";
import { AISpendTracker } from "../execution/ai-spend-tracker";

describe("AISpendTracker", () => {
  it("allows spend below phase cap", () => {
    const tracker = new AISpendTracker({
      phaseSpendCapUsd: 0.1,
      pipelineSpendCapUsd: null,
      sessionSpendCapUsd: null,
      sessionSpentBeforeRunUsd: 0,
    });
    tracker.record(0.05);
    expect(tracker.canContinue()).toBe(true);
  });

  it("blocks when phase cap exceeded", () => {
    const tracker = new AISpendTracker({
      phaseSpendCapUsd: 0.1,
      pipelineSpendCapUsd: null,
      sessionSpendCapUsd: null,
      sessionSpentBeforeRunUsd: 0,
    });
    tracker.record(0.11);
    expect(tracker.canContinue()).toBe(false);
    expect(tracker.abortLogMessage()).toMatch(/aborting further workers/);
    expect(tracker.check()?.kind).toBe("phase");
  });

  it("blocks when session cap exceeded including prior spend", () => {
    const tracker = new AISpendTracker({
      phaseSpendCapUsd: 1,
      pipelineSpendCapUsd: null,
      sessionSpendCapUsd: 0.5,
      sessionSpentBeforeRunUsd: 0.45,
    });
    tracker.record(0.06);
    expect(tracker.canContinue()).toBe(false);
    expect(tracker.check()?.kind).toBe("session");
  });

  it("blocks when pipeline run cap exceeded across phases", () => {
    const tracker = new AISpendTracker({
      phaseSpendCapUsd: 1,
      pipelineSpendCapUsd: 0.5,
      sessionSpendCapUsd: null,
      sessionSpentBeforeRunUsd: 0,
      pipelineSpentBeforePhaseUsd: 0.48,
    });
    tracker.record(0.03);
    expect(tracker.canContinue()).toBe(false);
    expect(tracker.check()?.kind).toBe("pipeline");
  });

  it("warn-only mode keeps workers running after cap exceeded", () => {
    const tracker = new AISpendTracker({
      phaseSpendCapUsd: 0.1,
      pipelineSpendCapUsd: null,
      sessionSpendCapUsd: null,
      sessionSpentBeforeRunUsd: 0,
      warnOnly: true,
    });
    tracker.record(0.2);
    expect(tracker.check()?.kind).toBe("phase");
    expect(tracker.canContinue()).toBe(true);
    expect(tracker.abortLogMessage()).toMatch(/aborting further workers/);
  });
});
