import { beforeAll, describe, expect, it } from "vitest";
import { registerDefaultInstrumentAnalyses } from "../registry/register-analyses";
import {
  registerPipeline,
  requiredSignalPhasesForPipeline,
  validatePipelineRegistry,
  type PipelineDescriptor,
} from "../registry/pipeline-router";
import { PIPELINE_WORKER_SETS } from "../../worker-registry";
import { DEFAULT_TRADE_CYCLE } from "../trade/default-analysis";
import type {
  InstrumentAnalysis,
  InstrumentAnalysisState,
} from "../../analysis/types";

const FOUR_PHASES = ["technical", "fundamental", "review", "decision"] as const;

/** A distinct plan id so registerInstrumentAnalysis does not reject a duplicate. */
function clonePlan(id: string): InstrumentAnalysis<InstrumentAnalysisState> {
  return { ...DEFAULT_TRADE_CYCLE, id };
}

describe("pipeline router", () => {
  beforeAll(() => {
    registerDefaultInstrumentAnalyses();
  });

  it("requires all four signal phases for both shipped pipelines", () => {
    // Both shipped pipelines run the full signal set; edgar differs only by
    // dropping the candidate_validation engine stage, not a phase.
    expect(requiredSignalPhasesForPipeline("default-trade-cycle")).toEqual([
      ...FOUR_PHASES,
    ]);
    expect(requiredSignalPhasesForPipeline("edgar-8k-cycle")).toEqual([
      "fundamental",
      "review",
      "decision",
    ]);
  });

  it("rejects a duplicate pipeline id", () => {
    expect(() =>
      registerPipeline({
        id: "default-trade-cycle",
        displayName: "dup",
        automation: "ai",
        phases: [...FOUR_PHASES],
        signalSources: [],
        plan: DEFAULT_TRADE_CYCLE,
        phaseWorkers: PIPELINE_WORKER_SETS.defaultTrade,
      } satisfies PipelineDescriptor),
    ).toThrow(/already registered/);
  });

  it("rejects a phase outside the shared pool", () => {
    expect(() =>
      registerPipeline({
        id: "bad-phase",
        displayName: "bad",
        automation: "ai",
        // @ts-expect-error intentionally invalid phase
        phases: ["not-a-phase"],
        signalSources: [],
        plan: clonePlan("bad-phase"),
        phaseWorkers: {},
      }),
    ).toThrow(/unknown phase/);
  });

  it("rejects a descriptor whose plan uses a different ID", () => {
    expect(() =>
      registerPipeline({
        id: "descriptor-id",
        displayName: "mismatched plan ID",
        automation: "ai",
        phases: [...FOUR_PHASES],
        signalSources: [],
        plan: clonePlan("plan-id"),
        phaseWorkers: PIPELINE_WORKER_SETS.defaultTrade,
      } satisfies PipelineDescriptor),
    ).toThrow(/must use a plan with the same id/);
  });

  it("rejects a descriptor whose declared phases differ from its plan", () => {
    expect(() =>
      registerPipeline({
        id: "mismatch",
        displayName: "mismatch",
        automation: "ai",
        phases: ["technical"],
        signalSources: [],
        plan: clonePlan("mismatch"), // plan runs all four
        phaseWorkers: PIPELINE_WORKER_SETS.defaultTrade,
      } satisfies PipelineDescriptor),
    ).toThrow(/declares phases/);
  });

  // Mutates the singleton registry — keep last.
  it("rejects two pipelines claiming the same signal source at boot", () => {
    registerPipeline({
      id: "conflict",
      displayName: "conflict",
      automation: "ai",
      phases: [...FOUR_PHASES],
      signalSources: ["manual"], // already claimed by default-trade-cycle
      plan: clonePlan("conflict"),
      phaseWorkers: PIPELINE_WORKER_SETS.defaultTrade,
    });
    expect(() => validatePipelineRegistry()).toThrow(/claimed by both/);
  });
});
