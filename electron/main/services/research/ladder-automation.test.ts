import { describe, expect, it } from "vitest";
import {
  approveLadderUpgrade,
  defaultLadderState,
  tickLadderAutomation,
  type LadderAutomationDeps,
  type LadderState,
} from "./ladder-automation";
import type { PromotionDecisionResult } from "./promotion-gate";

function makeDeps(
  initial: LadderState,
  decision: PromotionDecisionResult,
): LadderAutomationDeps & { store: Map<string, LadderState>; notes: string[] } {
  const store = new Map<string, LadderState>([[initial.experienceId, initial]]);
  const notes: string[] = [];
  return {
    store,
    notes,
    getState: (id) => store.get(id) ?? null,
    setState: (s) => store.set(s.experienceId, s),
    evaluateEligibility: () => decision,
    notify: (title, body) => notes.push(`${title}|${body}`),
  };
}

const passDecision: PromotionDecisionResult = {
  promote: true,
  failedCriteria: [],
  evidence: {
    sampleSize: 50,
    netExpectancyCi: { point: 10, lower: 5, upper: 15 },
    sharpe: { sharpe: 1, lower: 0.5 },
    maxDrawdownPct: 5,
    brierScore: 0.1,
    foldsPassed: 3,
    foldsRequired: 3,
  },
};

const failDecision: PromotionDecisionResult = {
  ...passDecision,
  promote: false,
  failedCriteria: ["lower_95ci_net_expectancy"],
};

describe("ladder-automation", () => {
  it("sets pendingUpgradeTo when gate promotes", () => {
    const state = defaultLadderState("rules-mean-reversion");
    const deps = makeDeps(state, passDecision);
    const next = tickLadderAutomation(deps, "rules-mean-reversion");
    expect(next.pendingUpgradeTo).toBe("live_small");
    expect(deps.notes[0]).toContain("promotion ready");
  });

  it("approveLadderUpgrade applies pending rung", () => {
    const state: LadderState = {
      ...defaultLadderState("exp"),
      pendingUpgradeTo: "live_small",
    };
    const deps = makeDeps(state, passDecision);
    const upgraded = approveLadderUpgrade(deps, "exp");
    expect(upgraded?.rung).toBe("live_small");
    expect(upgraded?.pendingUpgradeTo).toBeNull();
  });

  it("auto-demotes live_small when gate fails", () => {
    const state: LadderState = {
      ...defaultLadderState("exp"),
      rung: "live_small",
      capitalBoundUsd: 2500,
    };
    const deps = makeDeps(state, failDecision);
    const next = tickLadderAutomation(deps, "exp");
    expect(next.rung).toBe("paper");
    expect(deps.notes[0]).toContain("demotion");
  });
});
