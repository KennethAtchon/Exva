import { describe, expect, it } from "vitest";
import { ALL_PIPELINES } from "../pipelines";

describe("pipelines registration", () => {
  it("declares all six shipped pipeline descriptors", () => {
    expect(ALL_PIPELINES).toHaveLength(6);
    expect(ALL_PIPELINES.map((pipeline) => pipeline.id)).toEqual([
      "default-trade-cycle",
      "edgar-8k-cycle",
      "rules-mean-reversion-cycle",
      "rules-trend-following-cycle",
      "rules-breakout-cycle",
      "prediction-event-cycle",
    ]);
  });

  it("maps signal sources to the intended pipelines in descriptor metadata", () => {
    const byId = Object.fromEntries(
      ALL_PIPELINES.map((pipeline) => [pipeline.id, pipeline]),
    );

    expect(byId["default-trade-cycle"]?.signalSources).toEqual([
      "web_search",
      "manual",
    ]);
    expect(byId["edgar-8k-cycle"]?.signalSources).toEqual(["edgar_8k", "mock"]);
    expect(byId["prediction-event-cycle"]?.signalSources).toEqual([
      "prediction_event",
    ]);
    expect(byId["rules-mean-reversion-cycle"]?.signalSources).toEqual([
      "timer",
    ]);
    expect(byId["rules-trend-following-cycle"]?.signalSources).toEqual([
      "timer",
    ]);
    expect(byId["rules-breakout-cycle"]?.signalSources).toEqual(["timer"]);
  });

  it("marks exactly one pipeline as default", () => {
    const defaults = ALL_PIPELINES.filter((pipeline) => pipeline.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe("default-trade-cycle");
  });

  it("uses event selector workers for the prediction-event pipeline", () => {
    const prediction = ALL_PIPELINES.find(
      (pipeline) => pipeline.id === "prediction-event-cycle",
    );
    expect(prediction?.phaseWorkers.selector?.length).toBeGreaterThan(0);
  });

  it("declares selector workers only for pipelines that research", () => {
    const byId = Object.fromEntries(
      ALL_PIPELINES.map((pipeline) => [pipeline.id, pipeline]),
    );
    // default + prediction-event research their own universe.
    expect(
      byId["default-trade-cycle"]?.phaseWorkers.selector?.length,
    ).toBeGreaterThan(0);
    // signal-fed pipelines declare no selector workers.
    for (const id of [
      "edgar-8k-cycle",
      "rules-mean-reversion-cycle",
      "rules-trend-following-cycle",
      "rules-breakout-cycle",
    ]) {
      expect(byId[id]?.phaseWorkers.selector ?? []).toEqual([]);
    }
  });

  it("uses rules-only decision phases for deterministic pipelines", () => {
    for (const id of [
      "rules-mean-reversion-cycle",
      "rules-trend-following-cycle",
      "rules-breakout-cycle",
    ]) {
      const pipeline = ALL_PIPELINES.find((entry) => entry.id === id);
      expect(pipeline?.phases).toEqual(["decision"]);
      expect(pipeline?.phaseWorkers.decision).toEqual([]);
    }
  });
});
