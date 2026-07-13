import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectivePipelineConfig } from "@electron/shared/ai/effective-ai-phase-config";

const runAIPhaseMock = vi.fn();
const runCycleMock = vi.fn();
const runPlanMock = vi.fn();
const resolveEffectiveConfigMock = vi.fn();
const assertValidEffectiveConfigMock = vi.fn();
const setPlanServicesMock = vi.fn();
const setInstrumentAnalysisServicesMock = vi.fn();
const setStrategyContextServiceMock = vi.fn();
const mergeCyclePlanServicesMock = vi.fn();

vi.mock("../../pipeline/core/pipeline-runtime", () => ({
  PipelineRuntime: vi.fn().mockImplementation(() => ({
    runAIPhase: runAIPhaseMock,
    runCycle: runCycleMock,
    runPlan: runPlanMock,
    resolveEffectiveConfig: resolveEffectiveConfigMock,
    assertValidEffectiveConfig: assertValidEffectiveConfigMock,
    setPlanServices: setPlanServicesMock,
    setInstrumentAnalysisServices: setInstrumentAnalysisServicesMock,
    setStrategyContextService: setStrategyContextServiceMock,
    mergeCyclePlanServices: mergeCyclePlanServicesMock,
  })),
}));

vi.mock("../../pipeline/ai-phase-config-resolver", () => ({
  AIPhaseConfigResolver: vi.fn(),
}));

import { LLMRuntime } from "../runtime";

function buildRuntime(overrides?: {
  brokerRouting?: object;
  strategyContextService?: object;
  planServices?: object;
  cyclePlanServices?: object;
}) {
  const brokerRouting = overrides?.brokerRouting ?? { route: vi.fn() };
  const strategyContextService = overrides?.strategyContextService ?? {
    load: vi.fn(),
  };
  const planServices = overrides?.planServices ?? {
    brokerRouting,
  };
  const cyclePlanServices = overrides?.cyclePlanServices ?? {
    brokerRouting,
  };

  return new LLMRuntime(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    brokerRouting as never,
    undefined,
    strategyContextService as never,
    planServices as never,
    cyclePlanServices as never,
  );
}

describe("LLMRuntime", () => {
  beforeEach(() => {
    runAIPhaseMock.mockReset();
    runCycleMock.mockReset();
    runPlanMock.mockReset();
    resolveEffectiveConfigMock.mockReset();
    assertValidEffectiveConfigMock.mockReset();
    setPlanServicesMock.mockReset();
    setInstrumentAnalysisServicesMock.mockReset();
    setStrategyContextServiceMock.mockReset();
    mergeCyclePlanServicesMock.mockReset();
  });

  it("delegates config resolution to the pipeline runtime", () => {
    const config = { phases: {} } as unknown as EffectivePipelineConfig;
    resolveEffectiveConfigMock.mockReturnValue(config);
    assertValidEffectiveConfigMock.mockReturnValue(config);
    const runtime = buildRuntime();

    expect(runtime.resolveEffectivePipelineConfig("session-1", "pipe-1")).toBe(
      config,
    );
    expect(runtime.assertValidEffectivePipelineConfig("session-1")).toBe(
      config,
    );
    expect(resolveEffectiveConfigMock).toHaveBeenCalledWith(
      "session-1",
      "pipe-1",
    );
    expect(assertValidEffectiveConfigMock).toHaveBeenCalledWith(
      "session-1",
      undefined,
    );
  });

  it("delegates runAIPhase to the pipeline runtime", async () => {
    runAIPhaseMock.mockResolvedValue({ output: { ok: true } });
    const runtime = buildRuntime();

    const result = await runtime.runAIPhase(
      "selector",
      "session-1",
      "cycle-1",
      {
        symbol: "AAPL",
      },
    );

    expect(result).toEqual({ output: { ok: true } });
    expect(runAIPhaseMock).toHaveBeenCalledWith({
      phase: "selector",
      sessionId: "session-1",
      input: { symbol: "AAPL" },
      cycleId: "cycle-1",
    });
  });

  it("requires a session id for runAIPhase", async () => {
    const runtime = buildRuntime();

    await expect(
      runtime.runAIPhase("selector", "", "cycle-1"),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(runAIPhaseMock).not.toHaveBeenCalled();
  });

  it("delegates runCycle and runPlan to the pipeline runtime", async () => {
    runCycleMock.mockResolvedValue({ status: "complete" });
    runPlanMock.mockResolvedValue({ status: "planned" });
    const runtime = buildRuntime();
    const cycleOpts = {
      sessionId: "session-1",
      cycleId: "cycle-1",
      instrument: { symbol: "AAPL", instrumentClass: "stock" as const },
      instrumentClasses: ["stock" as const],
    };

    await expect(runtime.runCycle("cycle-plan-1", cycleOpts)).resolves.toEqual({
      status: "complete",
    });
    expect(runCycleMock).toHaveBeenCalledWith("cycle-plan-1", cycleOpts);

    await expect(
      runtime.runPlan("plan-1", {
        sessionId: "session-1",
        cycleId: "cycle-1",
      }),
    ).resolves.toEqual({ status: "planned" });
    expect(runPlanMock).toHaveBeenCalledWith("plan-1", {
      sessionId: "session-1",
      cycleId: "cycle-1",
    });
  });

  it("requires a session id for runCycle and runPlan", async () => {
    const runtime = buildRuntime();

    await expect(
      runtime.runCycle("cycle-plan-1", {
        sessionId: "",
        cycleId: "cycle-1",
        instrument: { symbol: "AAPL", instrumentClass: "stock" },
        instrumentClasses: ["stock"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await expect(
      runtime.runPlan("plan-1", { sessionId: "", cycleId: "cycle-1" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("forwards strategy context and experience allocator updates", () => {
    const strategyContextService = { load: vi.fn() };
    const experienceCapitalAllocator = { allocate: vi.fn() };
    const runtime = buildRuntime({ strategyContextService });

    runtime.setStrategyContextService(strategyContextService as never);
    runtime.setExperienceCapitalAllocator(experienceCapitalAllocator as never);

    expect(setStrategyContextServiceMock).toHaveBeenCalledWith(
      strategyContextService,
    );
    expect(mergeCyclePlanServicesMock).toHaveBeenCalledWith({
      experienceCapitalAllocator,
    });
  });

  it("wires broker-aware plan services when dependencies are present", () => {
    buildRuntime();

    expect(setPlanServicesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        brokerRouting: expect.any(Object),
        strategyContextService: expect.any(Object),
      }),
    );
    expect(setInstrumentAnalysisServicesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        brokerRouting: expect.any(Object),
        strategyContextService: expect.any(Object),
      }),
    );
  });
});
