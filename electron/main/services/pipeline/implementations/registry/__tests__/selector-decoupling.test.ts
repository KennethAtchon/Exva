import { beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceSession } from "@/lib/types";
import { registerDefaultInstrumentAnalyses } from "../register-analyses";
import { requirePipelineDescriptor } from "../pipeline-descriptor-store";
import { SELECTOR_PHASE } from "../../../definitions/selector.phase";
import { pipelineResearches } from "../../../../session/session-trade-state";
import { resolvePipelineIdForExperience } from "../../../../../experiences";

/** Minimal session — pipelineResearches only reads experienceId. */
function sessionFor(experienceId: string): WorkspaceSession {
  return { experienceId } as WorkspaceSession;
}

/** The selector's discovery stage only reads ctx.pipelineId + ctx.input. */
function discoveryWorkerIds(
  pipelineId: string,
  signalTrigger: unknown,
): string[] {
  const discovery = SELECTOR_PHASE.stages[0];
  const ctx = { pipelineId, input: { signalTrigger } } as never;
  return discovery.resolveWorkers(ctx, undefined as never).map((w) => w.id);
}

describe("selector-as-ordinary-phase decoupling", () => {
  beforeAll(() => {
    registerDefaultInstrumentAnalyses();
  });

  describe("pipelineResearches (the single derived predicate)", () => {
    it("is true only for pipelines that declare selector workers", () => {
      // prediction-event-cycle declares phaseWorkers.selector.
      expect(pipelineResearches(sessionFor("prediction-event-edge"))).toBe(
        true,
      );
      // edgar + the deterministic rules pipelines declare none.
      expect(pipelineResearches(sessionFor("edgar-catalyst"))).toBe(false);
      expect(pipelineResearches(sessionFor("rules-mean-reversion"))).toBe(
        false,
      );
      expect(pipelineResearches(sessionFor("rules-trend-following"))).toBe(
        false,
      );
      expect(pipelineResearches(sessionFor("rules-breakout"))).toBe(false);
    });
  });

  describe("selector worker resolution (invariant 1)", () => {
    it("reads phaseWorkers.selector from the session's pipeline, ignoring signalTrigger", () => {
      // default-trade-cycle researches: web-scout regardless of trigger.
      expect(discoveryWorkerIds("default-trade-cycle", undefined)).toEqual([
        "web-scout",
      ]);
      expect(
        discoveryWorkerIds("default-trade-cycle", { sourceType: "mock" }),
      ).toEqual(["web-scout"]);

      // mean-reversion has no selector workers: empty, even with a trigger that
      // the old source-type router would have mapped to the web-scout.
      expect(
        discoveryWorkerIds("rules-mean-reversion-cycle", undefined),
      ).toEqual([]);
      expect(
        discoveryWorkerIds("rules-mean-reversion-cycle", {
          sourceType: "edgar_8k",
        }),
      ).toEqual([]);
    });
  });

  describe("pipeline-id resolution from experience (invariant 2)", () => {
    it("resolves a session's pipeline from its experience, never the default fallback", () => {
      expect(resolvePipelineIdForExperience("rules-mean-reversion")).toBe(
        "rules-mean-reversion-cycle",
      );
    });

    it("disambiguates the shared `timer` source that source-type routing could not", () => {
      // All three rules experiences emit `timer`; only experience id tells them
      // apart. Source-type routing returned whichever registered first.
      expect(resolvePipelineIdForExperience("rules-mean-reversion")).toBe(
        "rules-mean-reversion-cycle",
      );
      expect(resolvePipelineIdForExperience("rules-trend-following")).toBe(
        "rules-trend-following-cycle",
      );
      expect(resolvePipelineIdForExperience("rules-breakout")).toBe(
        "rules-breakout-cycle",
      );
    });
  });

  describe("empty discovery stage (invariant 3)", () => {
    it("a non-researching pipeline resolves zero discovery workers", () => {
      // The phase interpreter skips a stage with no workers, so a trigger-less
      // cycle on such a pipeline discovers nothing — correct by construction.
      expect(
        requirePipelineDescriptor("edgar-8k-cycle").phaseWorkers.selector,
      ).toBeUndefined();
      expect(discoveryWorkerIds("edgar-8k-cycle", undefined)).toEqual([]);
    });
  });
});
