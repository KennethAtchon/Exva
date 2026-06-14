import { beforeAll, describe, expect, it, vi } from "vitest";
import { ensurePipelineBootRegistered } from "../__tests__/pipeline-test-boot";
import {
  assertValidPipelineDefinitionCatalog,
  resolveEffectivePipelineConfig,
} from "../effective-ai-phase-config";
import { AIPhaseConfigResolver } from "../ai-phase-config-resolver";

describe("effective-ai-phase-config", () => {
  beforeAll(() => {
    ensurePipelineBootRegistered();
  });

  it("validates the full pipeline definition catalog at boot", () => {
    expect(() => assertValidPipelineDefinitionCatalog()).not.toThrow();
  });

  it("resolves effective config with workers and engines for each stage", () => {
    const resolver = new AIPhaseConfigResolver({
      getByPhase: vi.fn().mockReturnValue(null),
      getWorker: vi.fn().mockReturnValue(null),
    } as never);

    const config = resolveEffectivePipelineConfig({
      sessionId: "s1",
      pipelineId: "default-trade-cycle",
      phaseConfigResolver: resolver,
      strategyContext: {
        researchPosture: { processingMode: "catalyst" },
      } as never,
    });

    expect(config.pipelineId).toBe("default-trade-cycle");
    expect(config.stages.length).toBeGreaterThan(0);
    expect(config.workers.length).toBeGreaterThan(0);
    expect(config.planStages?.length).toBeGreaterThan(0);
    expect(config.sourceMap.some((entry) => entry.source === "default")).toBe(
      true,
    );
  });
});
