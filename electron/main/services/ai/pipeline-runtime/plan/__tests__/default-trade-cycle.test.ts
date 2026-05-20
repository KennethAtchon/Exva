import { describe, expect, it } from "vitest";
import { registerDefaultCyclePlans } from "../register/cycle-plans";
import { getCyclePlan, listCyclePlanIds, registerCyclePlan } from "../cycle/registry";
import { DEFAULT_TRADE_CYCLE_STAGES } from "../plans/trade/default-cycle-stages";
import { listEngineInputBuilderIds } from "../engine/input-builder-registry";
import type { CyclePlan, TradeCyclePlanState } from "../cycle/types";
import { resolveEffectivePlanStages } from "../unified/registry";

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

  it("uses a declarative stage table for engine and phase stages", () => {
    expect(DEFAULT_TRADE_CYCLE_STAGES.map((stage) => stage.id)).toEqual([
      "candidate_validation",
      "technical",
      "fundamental",
      "review",
      "decision",
      "risk_gate",
    ]);
    expect(DEFAULT_TRADE_CYCLE_STAGES.find((stage) => stage.id === "candidate_validation")).toMatchObject({
      kind: "engine",
      failurePolicy: "warn",
    });
    expect(DEFAULT_TRADE_CYCLE_STAGES.find((stage) => stage.id === "risk_gate")).toMatchObject({
      kind: "engine-chain",
      failurePolicy: "reject_trade",
    });
  });

  it("registers trade engine input builders", () => {
    expect(listEngineInputBuilderIds()).toEqual(
      expect.arrayContaining(["candidate-validation", "execution-profile", "risk-gate", "broker-allocation"]),
    );
  });

  it("resolves effective stages for non-default cycle plans", () => {
    const planId = "test-non-default-cycle-plan";
    const customCyclePlan: CyclePlan<TradeCyclePlanState> = {
      id: planId,
      initialState: (_ctx, seed = {}) => ({ ...seed }),
      inspect: {
        stageIds: ["technical", "risk_gate"],
        phaseStages: ["technical"],
        engineStages: ["risk-gate", "broker-allocation"],
      },
      stages: [
        {
          id: "technical",
          executionStage: "technical",
          required: true,
          execute: async (_ctx, state) => state,
        },
        {
          id: "risk_gate",
          executionStage: "risk_gate",
          required: true,
          failurePolicy: "reject_trade",
          execute: async (_ctx, state) => state,
        },
      ],
    };

    registerCyclePlan(customCyclePlan);

    expect(resolveEffectivePlanStages(planId)).toEqual([
      {
        id: "technical",
        kind: "phase",
        executionStage: "technical",
        phase: "technical",
        required: true,
        failurePolicy: undefined,
      },
      {
        id: "risk_gate",
        kind: "engine-chain",
        executionStage: "risk_gate",
        required: true,
        failurePolicy: "reject_trade",
      },
    ]);
  });
});
