import { describe, expect, it } from "vitest";
import { registerAllPhases } from "../../definitions";
import { getAIPhase } from "../../phases/registry";
import { resolvePhaseWorkers } from "../../definitions/phase-catalog";
import { ensurePipelineBootRegistered } from "../../__tests__/pipeline-test-boot";
import { DEFAULT_PIPELINE_ID } from "../../pipeline-constants";

const PROCESSING_MODES = ["catalyst", "contract"] as const;
const ALL_PHASE_IDS = [
  "selector",
  "technical",
  "fundamental",
  "review",
  "decision",
] as const;

describe("phase definitions", () => {
  it("registers all five executable phase plans", () => {
    registerAllPhases();

    for (const phase of ALL_PHASE_IDS) {
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

  it("all phases declare outputSchemaName", () => {
    registerAllPhases();

    for (const phase of ALL_PHASE_IDS) {
      const plan = getAIPhase(phase);
      expect(
        plan?.outputSchemaName,
        `${phase} missing outputSchemaName`,
      ).toBeTruthy();
    }
  });

  /**
   * Cross-validates that the phase catalog and the AIPhase definitions agree on
   * which workers each phase runs for each processing mode.
   *
   * If this test fails, resolvePhaseWorkers() in phase-catalog.ts has drifted
   * from the phase definition's stages[].resolveWorkers() for that mode.
   */
  it("catalog workers match AIPhase stage workers for every phase and mode", () => {
    ensurePipelineBootRegistered();
    registerAllPhases();

    for (const phase of ALL_PHASE_IDS) {
      const plan = getAIPhase(phase);
      if (!plan) throw new Error(`Phase '${phase}' not registered`);

      // Build a minimal context that satisfies the processingMode access pattern
      // used by resolveWorkers on all current phase stage definitions.
      for (const mode of PROCESSING_MODES) {
        const minimalCtx = {
          strategyContext: { researchPosture: { processingMode: mode } },
          pipelineId: DEFAULT_PIPELINE_ID,
          input: {},
        } as import("../../phases/types").AIPhaseContext;

        // Workers resolved by the AIPhase runtime path
        const phaseWorkerIds =
          plan.stages[0]
            ?.resolveWorkers(minimalCtx, {} as never)
            .map((w) => w.id) ?? [];

        // Workers resolved by the catalog path (used by effective config / renderer)
        const catalogWorkerIds = resolvePhaseWorkers(
          phase,
          DEFAULT_PIPELINE_ID,
        ).map((w) => w.id);

        expect(
          catalogWorkerIds,
          `${phase}/${mode} catalog vs AIPhase mismatch`,
        ).toEqual(phaseWorkerIds);
      }
    }
  });
});
