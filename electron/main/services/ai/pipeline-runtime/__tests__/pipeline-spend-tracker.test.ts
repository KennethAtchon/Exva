import { describe, expect, it } from "vitest";
import { PipelineSpendTracker } from "../execution/pipeline-spend-tracker";

describe("PipelineSpendTracker", () => {
  it("allows spend below phase cap", () => {
    const tracker = new PipelineSpendTracker({
      phaseSpendCapUsd: 0.1,
      pipelineSpendCapUsd: null,
      sessionSpendCapUsd: null,
      sessionSpentBeforeRunUsd: 0,
    });
    tracker.record(0.05);
    expect(tracker.canContinue()).toBe(true);
  });

  it("blocks when phase cap exceeded", () => {
    const tracker = new PipelineSpendTracker({
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
    const tracker = new PipelineSpendTracker({
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
    const tracker = new PipelineSpendTracker({
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
});
