import { describe, expect, it } from "vitest";
import { DEFAULT_TRADE_CYCLE } from "../../trade/default-analysis";
import {
  assertPipelinePlanMatchesPhases,
  registerPipelineDescriptor,
  requirePipelineDescriptor,
  validatePipelineDescriptor,
  type PipelineDescriptor,
} from "../pipeline-descriptor-store";
import { PIPELINE_WORKER_SETS } from "../../../worker-registry";

const FOUR_PHASES = ["technical", "fundamental", "review", "decision"] as const;

function descriptor(
  overrides: Partial<PipelineDescriptor> = {},
): PipelineDescriptor {
  const id = overrides.id ?? `test-${crypto.randomUUID()}`;
  return {
    id,
    displayName: "Test pipeline",
    automation: "ai",
    phases: [...FOUR_PHASES],
    signalSources: [],
    // The store requires plan.id === descriptor.id, so it must track any
    // id override rather than minting an independent one.
    plan: { ...DEFAULT_TRADE_CYCLE, id },
    phaseWorkers: PIPELINE_WORKER_SETS.defaultTrade,
    ...overrides,
  };
}

describe("pipeline-descriptor-store", () => {
  it("validates that declared phases match the plan inspect metadata", () => {
    expect(() =>
      assertPipelinePlanMatchesPhases(
        descriptor({ phases: ["technical", "fundamental"] }),
      ),
    ).toThrow(/declares phases/);
  });

  it("rejects unknown phases before registration", () => {
    expect(() =>
      validatePipelineDescriptor(
        descriptor({
          // @ts-expect-error intentionally invalid phase
          phases: ["not-a-phase"],
        }),
      ),
    ).toThrow(/unknown phase/);
  });

  it("rejects duplicate pipeline ids", () => {
    const first = descriptor({ id: "unique-pipeline-test" });
    registerPipelineDescriptor(first);
    expect(() => registerPipelineDescriptor(first)).toThrow(
      /already registered/,
    );
  });

  it("resolves a registered descriptor by id", () => {
    const id = `lookup-${crypto.randomUUID()}`;
    const entry = descriptor({ id });
    registerPipelineDescriptor(entry);
    expect(requirePipelineDescriptor(id).displayName).toBe("Test pipeline");
  });
});
