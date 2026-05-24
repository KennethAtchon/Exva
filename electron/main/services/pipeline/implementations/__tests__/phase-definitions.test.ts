import { describe, expect, it } from "vitest";
import { registerAllPhases } from "../../definitions";
import { getAIPhase } from "../../phases/registry";

describe("phase definitions", () => {
  it("registers all five executable phase plans", () => {
    registerAllPhases();

    for (const phase of [
      "selector",
      "technical",
      "fundamental",
      "review",
      "decision",
    ] as const) {
      const plan = getAIPhase(phase);
      expect(plan?.phase).toBe(phase);
      if (phase === "selector") {
        expect(plan?.finalizeEngineIds).toEqual([
          "selector-risk-filter",
          "selector-submission-builder",
        ]);
      } else {
        expect(plan?.persistAggregate).toBe(false);
        expect(plan?.stages.map((stage) => stage.id)).toEqual(["workers"]);
      }
    }
  });
});
