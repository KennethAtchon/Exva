import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TradingCycleContext } from "../trading-cycle-context";
import { registerDefaultInstrumentAnalyses } from "../../../pipeline/implementations/registry/register-analyses";
import {
  enqueueCycleTask,
  runOrchestratorStep,
  runPhaseCycle,
} from "../orchestrator-step";

beforeAll(() => {
  registerDefaultInstrumentAnalyses();
});

describe("enqueueCycleTask", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not enqueue when runtime is inactive", () => {
    const ctx = createContext({ runtimeActive: false });
    const execute = vi.fn(async () => undefined);

    enqueueCycleTask(ctx, "cycle-1", "Task failed", execute);

    expect(execute).not.toHaveBeenCalled();
  });

  it("enqueues task and emits error on failure", async () => {
    const ctx = createContext({ runtimeActive: true });
    const execute = vi.fn(async () => {
      throw new Error("boom");
    });

    enqueueCycleTask(ctx, "cycle-1", "Scheduled retry failed", execute);
    await ctx.queue.onIdle();

    expect(execute).toHaveBeenCalledOnce();
    expect(ctx.deps.eventsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "ERROR",
        message: "Scheduled retry failed: boom",
      }),
    );
  });
});

describe("runOrchestratorStep", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok when step succeeds", async () => {
    const ctx = createContext({ runtimeActive: true });
    const outcome = await runOrchestratorStep(ctx, {
      cycleId: "cycle-1",
      stage: "technical",
      run: async () => "value",
    });

    expect(outcome).toEqual({ status: "ok", value: "value" });
  });

  it("returns paused when pause is requested after step", async () => {
    const ctx = createContext({ runtimeActive: true });
    ctx.pauseAfterStep = true;

    const outcome = await runOrchestratorStep(ctx, {
      cycleId: "cycle-1",
      stage: "technical",
      run: async () => "value",
    });

    expect(outcome).toEqual({ status: "paused" });
  });

  it("returns failed and records failure by default", async () => {
    const ctx = createContext({ runtimeActive: true });
    const handleFailure = vi.spyOn(ctx, "handleStepFailure");

    const outcome = await runOrchestratorStep(ctx, {
      cycleId: "cycle-1",
      stage: "risk_gate",
      run: async () => {
        throw Object.assign(new Error("risk blocked"), {
          code: "VALIDATION_FAILED",
        });
      },
    });

    expect(outcome.status).toBe("failed");
    expect(handleFailure).toHaveBeenCalled();
  });

  it("invokes onRetry callback from step runner", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const ctx = createContext({ runtimeActive: true });
    const onRetry = vi.fn();

    await runOrchestratorStep(ctx, {
      cycleId: "cycle-1",
      stage: "technical",
      onRetry,
      run: async () => {
        throw Object.assign(new Error("transient"), { statusCode: 503 });
      },
    });

    await vi.runAllTimersAsync();
    expect(onRetry).toHaveBeenCalled();
    ctx.disposeStepRunners();
    vi.useRealTimers();
  });
});

describe("runPhaseCycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("runs selector-style cycle and clears transient streak on success", async () => {
    const ctx = createContext({ runtimeActive: true });
    ctx.consecutiveHardFailures = 2;
    ctx.deps.sessionRepo.getStatus = vi.fn(() => "attention_required" as const);
    ctx.deps.logger.info = vi.fn();
    ctx.deps.logger.warn = vi.fn();
    ctx.deps.logger.error = vi.fn();
    ctx.deps.logger.debug = vi.fn();

    await runPhaseCycle(ctx, {
      context: { kind: "selector", cycleId: "sel-1", label: "Test" },
      stage: "selector",
      run: async () => [{ symbol: "AAPL", instrumentClass: "stock" }],
      retryCycle: vi.fn(async () => undefined),
      onSuccess: vi.fn(),
      busEvents: { phase: "selector" },
      completePayload: (instruments) => ({
        instrumentCount: instruments.length,
      }),
    });

    expect(ctx.consecutiveHardFailures).toBe(0);
    expect(ctx.deps.sessionRepo.setStatus).toHaveBeenCalledWith(
      "active",
      "session-1",
    );
  });

  it("runs selector-style cycle and emits phase complete on success", async () => {
    const ctx = createContext({ runtimeActive: true });
    const onSuccess = vi.fn();

    await runPhaseCycle(ctx, {
      context: { kind: "selector", cycleId: "sel-1", label: "Test" },
      stage: "selector",
      run: async () => [{ symbol: "AAPL", instrumentClass: "stock" }],
      retryCycle: vi.fn(async () => undefined),
      onSuccess,
      busEvents: { phase: "selector" },
      completePayload: (instruments) => ({
        instrumentCount: instruments.length,
      }),
    });

    expect(onSuccess).toHaveBeenCalledWith([
      { symbol: "AAPL", instrumentClass: "stock" },
    ]);
    expect(ctx.deps.bus.emit).toHaveBeenCalledWith(
      "research_phase_complete",
      expect.objectContaining({
        sessionId: "session-1",
        phase: "selector",
        instrumentCount: 1,
      }),
    );
  });

  it("schedules selector retry after failed selector step", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const ctx = createContext({ runtimeActive: true });
    const retryCycle = vi.fn(async () => undefined);

    await runPhaseCycle(ctx, {
      context: { kind: "selector", cycleId: "sel-1", label: "Test" },
      stage: "selector",
      run: async () => {
        throw Object.assign(new Error("provider down"), { statusCode: 503 });
      },
      retryCycle,
      onSuccess: vi.fn(),
      busEvents: { phase: "selector" },
      completePayload: () => ({ instrumentCount: 0 }),
    });

    expect(ctx.deps.bus.emit).toHaveBeenCalledWith(
      "research_phase_failed",
      expect.objectContaining({ phase: "selector" }),
    );
    vi.advanceTimersByTime(5 * 60 * 1000);
    await ctx.queue.onIdle();
    expect(retryCycle).toHaveBeenCalled();
    ctx.disposeStepRunners();
  });
});

function createContext(options: { runtimeActive: boolean }) {
  let sessionStatus: "active" | "attention_required" = "active";
  return new TradingCycleContext("session-1", {
    sessionRepo: {
      getStatus: () => sessionStatus,
      setStatus: vi.fn((status: string) => {
        sessionStatus = status as typeof sessionStatus;
      }),
      requireById: () => ({
        id: "session-1",
        instrumentClasses: ["stock"],
        experienceId: "prediction-event-edge",
      }),
    },
    strategyContextService: {
      getSelectorSettings: () => ({
        aiPickerEnabled: true,
        noInstrumentRetryMinutes: null,
      }),
      get: () => ({
        rules: { setupType: "momentum" },
        riskConfig: {
          waitForOpenThreshold: 0.8,
          maxPositionUsd: 1000,
          maxConcurrentTrades: 3,
          stopLossPct: 2,
          takeProfitPct: 4,
          maxConsecutiveLosers: 3,
          dailyLossLimitUsd: 100,
          profitTargetUsd: 200,
          maxAiSpendUsd: 5,
          humanApprovalRequired: false,
        },
      }),
    },
    sessionExecutionStepsRepo: {
      upsert: vi.fn((step) => step),
      get: vi.fn(),
      clearFailed: vi.fn(),
    },
    eventsRepo: {
      insert: vi.fn((event) => ({ id: "event-1", ...event })),
    },
    bus: {
      runtimeStatus: () => (options.runtimeActive ? "active" : "paused"),
      setRuntimeStatus: vi.fn(),
      emit: vi.fn(),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    tradesRepo: {
      listOpenAndPending: () => [],
    },
  } as never);
}
