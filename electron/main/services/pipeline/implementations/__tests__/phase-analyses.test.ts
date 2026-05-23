import { describe, expect, it } from "vitest";
import { registerDefaultAIPhases } from "../registry/register-phases";
import { getAIPhase } from "../../phases/registry";

describe("trade analysis phase plans", () => {
  it("registers technical through decision phase plans", () => {
    registerDefaultAIPhases();

    for (const phase of [
      "technical",
      "fundamental",
      "review",
      "decision",
    ] as const) {
      const plan = getAIPhase(phase);
      expect(plan?.phase).toBe(phase);
      expect(plan?.persistAggregate).toBe(false);
      expect(plan?.inspect.stageIds).toEqual(["workers"]);
    }
  });
});
