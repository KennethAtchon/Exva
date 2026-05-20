import { describe, expect, it } from "vitest";
import { registerDefaultCyclePlans } from "../register-default-cycles";
import { getCyclePlan, listCyclePlanIds } from "../cycle-plan-registry";

describe("default-trade-cycle plan", () => {
  it("registers the default trade cycle with configured stages", () => {
    registerDefaultCyclePlans();

    expect(listCyclePlanIds()).toContain("default-trade-cycle");
    const plan = getCyclePlan("default-trade-cycle");
    expect(plan?.inspect.stageIds).toEqual([
      "candidate_validation",
      "technical",
      "fundamental",
      "review",
      "decision",
      "risk_gate",
    ]);
    expect(plan?.inspect.phaseStages).toEqual(["technical", "fundamental", "review", "decision"]);
    expect(plan?.inspect.engineStages).toEqual([
      "candidate-validator",
      "execution-profile-engine",
      "risk-gate",
      "broker-allocation",
    ]);
  });
});
