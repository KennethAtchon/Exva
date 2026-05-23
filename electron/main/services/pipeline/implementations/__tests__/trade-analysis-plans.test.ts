import { describe, expect, it } from "vitest";
import { registerDefaultPhasePlans } from "../registry/phase-plans";
import { getPhasePlan } from "../../phases/registry";

describe("trade analysis phase plans", () => {
  it("registers technical through decision phase plans", () => {
    registerDefaultPhasePlans();

    for (const phase of [
      "technical",
      "fundamental",
      "review",
      "decision",
    ] as const) {
      const plan = getPhasePlan(phase);
      expect(plan?.phase).toBe(phase);
      expect(plan?.persistAggregate).toBe(false);
      expect(plan?.inspect.stageIds).toEqual(["workers"]);
    }
  });
});
