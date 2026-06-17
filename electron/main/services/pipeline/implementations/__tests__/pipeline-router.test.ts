import { beforeAll, describe, expect, it } from "vitest";
import { registerDefaultInstrumentAnalyses } from "../registry/register-analyses";
import {
  registerPipeline,
  requiredSignalPhasesForPipeline,
  resolvePipelineIdForSource,
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

  it("routes edgar_8k to the edgar pipeline (self-describing, no discovery)", () => {
    expect(resolvePipelineIdForSource("edgar_8k")).toBe("edgar-8k-cycle");
  });

  it("routes web_search and manual to the default pipeline", () => {
    expect(resolvePipelineIdForSource("web_search")).toBe(
      "default-trade-cycle",
    );
    expect(resolvePipelineIdForSource("manual")).toBe("default-trade-cycle");
  });

  it("routes prediction_event to the prediction pipeline", () => {
    expect(resolvePipelineIdForSource("prediction_event")).toBe(
      "prediction-event-cycle",
    );
  });

  it("falls back to the default pipeline when the source is undefined", () => {
    // Signal-less cycles (initial/trade-closed research) carry no source type.
    expect(resolvePipelineIdForSource(undefined)).toBe("default-trade-cycle");
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
        plan: clonePlan("dup-plan"),
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
        plan: clonePlan("bad-phase-plan"),
        phaseWorkers: {},
      }),
    ).toThrow(/unknown phase/);
  });

  it("rejects a descriptor whose declared phases differ from its plan", () => {
    expect(() =>
      registerPipeline({
        id: "mismatch",
        displayName: "mismatch",
        automation: "ai",
        phases: ["technical"],
        signalSources: [],
        plan: clonePlan("mismatch-plan"), // plan runs all four
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
      signalSources: ["web_search"], // already claimed by default-trade-cycle
      plan: clonePlan("conflict-plan"),
      phaseWorkers: PIPELINE_WORKER_SETS.defaultTrade,
    });
    expect(() => validatePipelineRegistry()).toThrow(/claimed by both/);
  });
});
