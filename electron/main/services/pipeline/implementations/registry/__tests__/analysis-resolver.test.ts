import { beforeAll, describe, expect, it } from "vitest";
import { ensurePipelineBootRegistered } from "../../../__tests__/pipeline-test-boot";
import {
  requireAnalysis,
  resolveEffectivePlanStages,
} from "../analysis-resolver";

describe("analysis-resolver", () => {
  beforeAll(() => {
    ensurePipelineBootRegistered();
  });

  it("resolves the default trade cycle as a cycle plan", () => {
    const plan = requireAnalysis("default-trade-cycle");
    expect(plan.kind).toBe("cycle");
    expect(plan.id).toBe("default-trade-cycle");
  });

  it("resolves selector as a phase plan", () => {
    const plan = requireAnalysis("selector");
    expect(plan.kind).toBe("phase");
    expect(plan.id).toBe("selector");
  });

  it("throws for unknown plan ids", () => {
    expect(() => requireAnalysis("missing-plan")).toThrow(/not registered/);
  });

  it("derives effective plan stages for the default trade cycle", () => {
    const stages = resolveEffectivePlanStages("default-trade-cycle");
    expect(stages.length).toBeGreaterThan(0);
    expect(stages.some((stage) => stage.kind === "phase")).toBe(true);
    expect(stages.some((stage) => stage.kind === "engine-chain")).toBe(true);
  });
});
