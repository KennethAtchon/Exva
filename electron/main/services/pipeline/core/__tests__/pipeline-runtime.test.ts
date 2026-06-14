import { beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import { ensurePipelineBootRegistered } from "../../__tests__/pipeline-test-boot";
import { PipelineRuntime } from "../pipeline-runtime";
import { AIPhaseConfigResolver } from "../../ai-phase-config-resolver";

describe("PipelineRuntime", () => {
  beforeAll(() => {
    ensurePipelineBootRegistered();
  });

  function runtime(strategyContextService: unknown) {
    return new PipelineRuntime({
      providerRegistry: {} as never,
      phaseConfigResolver: new AIPhaseConfigResolver({
        getByPhase: vi.fn().mockReturnValue(null),
        getWorker: vi.fn().mockReturnValue(null),
      } as never),
      strategyContextService: strategyContextService as never,
      sessionRepo: {
        get: vi.fn().mockReturnValue({ experienceId: null }),
        requireById: vi.fn().mockReturnValue({
          id: "s1",
          instrumentClasses: ["stock"],
        }),
      } as never,
      workspacePrefsRepo: {} as never,
      apiCallLogRepo: {} as never,
      agentRunsRepo: { dailyAiSpendUsd: vi.fn().mockReturnValue(0) } as never,
      searchRegistry: {} as never,
    });
  }

  it("resolves effective config when strategy context is available", () => {
    const strategyContext = {
      researchPosture: { processingMode: "catalyst" },
      riskConfig: { maxAiSpendUsd: 10, maxDataSpendUsd: 5 },
      timeframe: { holdingStyle: "multi_day_swing" },
    };
    const svc = { get: vi.fn().mockReturnValue(strategyContext) };
    const config = runtime(svc).resolveEffectiveConfig("s1");

    expect(config.sessionId).toBe("s1");
    expect(config.stages.some((stage) => stage.id === "selector")).toBe(true);
    expect(config.workers.length).toBeGreaterThan(0);
  });

  it("throws when cycle plan services are missing", async () => {
    const svc = {
      get: vi.fn().mockReturnValue({
        researchPosture: { processingMode: "catalyst" },
        riskConfig: { maxAiSpendUsd: 10 },
        timeframe: { holdingStyle: "multi_day_swing" },
      }),
    };
    await expect(
      runtime(svc).runCycle("default-trade-cycle", {
        sessionId: "s1",
        cycleId: "c1",
        instrument: { symbol: "AAPL", instrumentClass: "stock" },
        sessionConfig: {} as never,
        instrumentClasses: ["stock"],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("throws when strategy context service is not configured", () => {
    const runtime = new PipelineRuntime({
      providerRegistry: {} as never,
      phaseConfigResolver: new AIPhaseConfigResolver({
        getByPhase: vi.fn(),
        getWorker: vi.fn(),
      } as never),
      strategyContextService: null,
      sessionRepo: { get: vi.fn(), requireById: vi.fn() } as never,
      workspacePrefsRepo: {} as never,
      apiCallLogRepo: {} as never,
      agentRunsRepo: { dailyAiSpendUsd: vi.fn().mockReturnValue(0) } as never,
      searchRegistry: {} as never,
    });

    expect(() => runtime.resolveEffectiveConfig("s1")).toThrow(
      /Strategy context service is not configured/,
    );
  });
});
