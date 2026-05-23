import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionConfig, WorkspaceSession } from "@/lib/types";
import { SEARCH_EVERYTHING_SCOPE } from "@electron/shared/instruments/session-instrument-classes";
import { registerDefaultAIPhases } from "../../../pipeline/implementations/registry/register-phases";
import { buildCompositeInput } from "../../../pipeline/implementations/registry/input-builder-registry";
import { AgentOrchestrator } from "../agent-orchestrator";
import * as runSelectorModule from "../selector/run-selector";

registerDefaultAIPhases();

async function drainOrchestratorQueue(
  orchestrator: AgentOrchestrator,
): Promise<void> {
  await (
    orchestrator as never as { ctx: { queue: { onIdle: () => Promise<void> } } }
  ).ctx.queue.onIdle();
}

describe("AgentOrchestrator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("uses the selector retry profile for both the timer and emitted message", () => {
    const deps = createDeps({ noInstrumentRetryMinutes: 7 });
    const timeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(() => 1 as never);
    const orchestrator = new AgentOrchestrator("session-1", deps as never);

    (
      orchestrator as never as {
        handleResolvedInstruments: (rows: unknown[], context: string) => void;
      }
    ).handleResolvedInstruments([], "Initial research cycle complete");

    expect(timeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      7 * 60 * 1000,
    );
    expect(deps.eventsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Initial research cycle complete; no tradable instruments were selected. Re-evaluating in 7 minutes.",
      }),
    );
  });

  it.each([
    {
      label: "profile is missing the setting",
      noInstrumentRetryMinutes: undefined,
    },
    {
      label: "profile contains an out-of-range value",
      noInstrumentRetryMinutes: 0,
    },
  ])(
    "falls back to the 5-minute default when $label",
    ({ noInstrumentRetryMinutes }) => {
      const deps = createDeps({ noInstrumentRetryMinutes });
      const timeoutSpy = vi
        .spyOn(globalThis, "setTimeout")
        .mockImplementation(() => 1 as never);
      const orchestrator = new AgentOrchestrator("session-1", deps as never);

      (
        orchestrator as never as {
          handleResolvedInstruments: (rows: unknown[], context: string) => void;
        }
      ).handleResolvedInstruments([], "Scheduled selector retry complete");

      expect(timeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        5 * 60 * 1000,
      );
      expect(deps.eventsRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "Scheduled selector retry complete; no tradable instruments were selected. Re-evaluating in 5 minutes.",
        }),
      );
    },
  );

  it("returns without throwing when the selector stage hits a retryable provider error", async () => {
    vi.useFakeTimers();
    const deps = createDeps({ noInstrumentRetryMinutes: 5 });
    const orchestrator = new AgentOrchestrator("session-1", deps as never);
    vi.spyOn(
      orchestrator as never as { getSessionConfig: () => SessionConfig },
      "getSessionConfig",
    ).mockReturnValue(baseConfig());
    vi.spyOn(runSelectorModule, "runSelector").mockRejectedValue(
      Object.assign(new Error("selector provider unavailable"), {
        statusCode: 503,
      }),
    );

    await expect(orchestrator.start()).resolves.toBeUndefined();
    await drainOrchestratorQueue(orchestrator);

    const [step] =
      deps.sessionExecutionStepsRepo.getLatestBySession("session-1");
    expect(step).toMatchObject({
      stage: "selector",
      status: "retrying",
      retryable: true,
    });
    expect(deps.sessionStatus.current).toBe("active");
    await orchestrator.stop();
  });

  it("retries the failed selector stage and succeeds on the second run", async () => {
    vi.useFakeTimers();
    const deps = createDeps({ noInstrumentRetryMinutes: 5 });
    const orchestrator = new AgentOrchestrator("session-1", deps as never);
    vi.spyOn(
      orchestrator as never as { getSessionConfig: () => SessionConfig },
      "getSessionConfig",
    ).mockReturnValue(baseConfig());
    vi.spyOn(
      orchestrator as never as {
        handleResolvedInstruments: (rows: unknown[], context: string) => void;
      },
      "handleResolvedInstruments",
    ).mockImplementation(() => undefined);
    const runSelector = vi
      .spyOn(runSelectorModule, "runSelector")
      .mockRejectedValueOnce(
        Object.assign(new Error("selector provider unavailable"), {
          statusCode: 503,
        }),
      )
      .mockResolvedValueOnce([{ symbol: "AAPL", instrumentClass: "stock" }]);

    await orchestrator.start();
    await drainOrchestratorQueue(orchestrator);
    const [failedStep] =
      deps.sessionExecutionStepsRepo.getLatestBySession("session-1");
    const retryResult = await orchestrator.retryStep(
      failedStep.cycleId,
      "selector",
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(retryResult).toEqual({ ok: true });
    expect(runSelector).toHaveBeenCalledTimes(2);
    expect(
      deps.sessionExecutionStepsRepo.get(
        "session-1",
        failedStep.cycleId,
        "selector",
      ),
    ).toMatchObject({ status: "succeeded" });
    await orchestrator.stop();
  });

  it("returns from start before the initial selector cycle completes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let selectorFinished = false;
    const deps = createDeps({ noInstrumentRetryMinutes: 5 });
    const orchestrator = new AgentOrchestrator("session-1", deps as never);
    vi.spyOn(
      orchestrator as never as { getSessionConfig: () => SessionConfig },
      "getSessionConfig",
    ).mockReturnValue(baseConfig());
    vi.spyOn(runSelectorModule, "runSelector").mockImplementation(async () => {
      await gate;
      selectorFinished = true;
      return [];
    });

    const startedAt = Date.now();
    await orchestrator.start();
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(200);
    expect(selectorFinished).toBe(false);

    release();
    await drainOrchestratorQueue(orchestrator);
    expect(selectorFinished).toBe(true);
    await orchestrator.stop();
  });

  it("does not enqueue follow-up work after stop while selector is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = createDeps({ noInstrumentRetryMinutes: 5 });
    const orchestrator = new AgentOrchestrator("session-1", deps as never);
    const handleResolvedInstruments = vi.spyOn(
      orchestrator as never as {
        handleResolvedInstruments: (rows: unknown[], context: string) => void;
      },
      "handleResolvedInstruments",
    );
    vi.spyOn(
      orchestrator as never as { getSessionConfig: () => SessionConfig },
      "getSessionConfig",
    ).mockReturnValue(baseConfig());
    vi.spyOn(runSelectorModule, "runSelector").mockImplementation(async () => {
      await gate;
      return [{ symbol: "AAPL", instrumentClass: "stock" }];
    });

    await orchestrator.start();
    const stopPromise = orchestrator.stop();
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await stopPromise;
    await drainOrchestratorQueue(orchestrator);

    expect(handleResolvedInstruments).not.toHaveBeenCalled();
  });
});

describe("selector input builders", () => {
  it("builds full-universe selector instructions from assigned broker coverage instead of stored class picks", async () => {
    const deps = createDeps({
      noInstrumentRetryMinutes: 5,
      session: {
        selectionMode: "ai_selected_universe",
        instrumentScope: SEARCH_EVERYTHING_SCOPE,
        instrumentClasses: ["stock"],
      },
      assignedBrokers: [
        {
          id: "broker-crypto",
          name: "Crypto Broker",
          supportedInstrumentClasses: ["crypto"],
        },
      ],
    });
    const session = deps.sessionRepo.requireById();

    const instructions = await buildCompositeInput(
      ["selector-scope", "broker-coverage"],
      {
        sessionId: session.id,
        session,
        instrumentClasses: ["crypto"],
        toolContext: {
          sessionId: session.id,
          cycleId: null,
          searchProviderId: null,
          instrumentClasses: ["crypto"],
          strategyContext: deps.strategyContextService.get() as never,
        } as never,
        services: {
          sessionSelectorSettingsRepo: deps.sessionSelectorSettingsRepo,
          sessionBrokerAssignmentsRepo: deps.sessionBrokerAssignmentsRepo,
          brokerAccountsRepo: deps.brokerAccountsRepo,
          brokerRouting: { resolveAdapter: vi.fn() },
        } as never,
      },
    );

    expect(instructions).toContain("Selector mode: full-universe discovery.");
    expect(instructions).toContain("broker-backed classes: crypto");
    expect(instructions).toContain(
      "enumerate all serious candidate instruments",
    );
    expect(instructions).toContain("research each candidate online");
    expect(instructions).toContain(
      "crypto: tradable via Crypto Broker (broker-crypto)",
    );
    expect(instructions).not.toContain("stock: tradable via");
  });
});

function createDeps({
  noInstrumentRetryMinutes,
  session,
  assignedBrokers,
}: {
  noInstrumentRetryMinutes?: number;
  session?: Partial<WorkspaceSession>;
  assignedBrokers?: Array<{
    id: string;
    name: string;
    supportedInstrumentClasses: Array<
      "stock" | "crypto" | "futures" | "prediction_market"
    >;
  }>;
}) {
  const steps = new Map<string, StepRecord>();
  const sessionStatus = { current: "active" as WorkspaceSession["status"] };
  const resolvedSession: WorkspaceSession = {
    id: "session-1",
    name: "Test Session",
    objective: "Verify orchestrator step retries",
    status: session?.status ?? sessionStatus.current,
    isFocused: true,
    selectionMode: session?.selectionMode ?? "manual_shortlist",
    instrumentClasses: session?.instrumentClasses ?? ["stock"],
    instrumentScope: session?.instrumentScope ?? "AAPL",
    defaultSearchProviderId: null,
    executionMode: "paper_only",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const brokerRows = assignedBrokers ?? [];

  return {
    sessionStatus,
    strategyContextService: {
      get: () => ({
        researchPosture: {},
        rules: {},
        riskConfig: { maxExposureUsd: null, waitForOpenThreshold: 0.8 },
        timeframe: {},
      }),
    },
    sessionSelectorSettingsRepo: {
      get: () => ({
        aiPickerEnabled: session?.selectionMode === "ai_selected_universe",
        noInstrumentRetryMinutes: noInstrumentRetryMinutes ?? null,
      }),
    },
    sessionRepo: {
      requireById: () => ({
        ...resolvedSession,
        status: sessionStatus.current,
      }),
      getStatus: () => sessionStatus.current,
      setStatus: (status: WorkspaceSession["status"]) => {
        sessionStatus.current = status;
        return status;
      },
      uptimeMin: () => 0,
    },
    sessionExecutionStepsRepo: {
      upsert: (step: Omit<StepRecord, "id" | "createdAt" | "updatedAt">) => {
        const key = `${step.sessionId}:${step.cycleId}:${step.stage}`;
        const existing = steps.get(key);
        const next: StepRecord = {
          id: existing?.id ?? crypto.randomUUID(),
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...step,
        };
        steps.set(key, next);
        return next;
      },
      get: (sessionId: string, cycleId: string, stage: string) =>
        steps.get(`${sessionId}:${cycleId}:${stage}`) ?? null,
      getLatestByCycle: (sessionId: string, cycleId: string) =>
        [...steps.values()].filter(
          (step) => step.sessionId === sessionId && step.cycleId === cycleId,
        ),
      getLatestBySession: (sessionId: string) =>
        [...steps.values()]
          .filter((step) => step.sessionId === sessionId)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
      clearFailed: (sessionId: string, cycleId: string, stage: string) => {
        steps.delete(`${sessionId}:${cycleId}:${stage}`);
      },
    },
    eventsRepo: {
      insert: vi.fn((event) => event),
    },
    capitalReservation: {
      listActiveBySession: vi.fn(() => []),
      releaseOnFailure: vi.fn(),
      checkOrderFits: vi.fn(() => ({ ok: true })),
    },
    bus: {
      on: vi.fn(() => () => undefined),
      emit: vi.fn(),
      setRuntimeStatus: vi.fn(),
      runtimeStatus: vi.fn(() => "active"),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    sessionBrokerAssignmentsRepo: {
      listBrokerAccountIds: () => brokerRows.map((broker) => broker.id),
    },
    brokerAccountsRepo: {
      find: (brokerAccountId: string) =>
        brokerRows.find((broker) => broker.id === brokerAccountId) ?? null,
    },
  };
}

function baseConfig(): SessionConfig {
  return {
    strategy: "passive_income",
    max_position_usd: 500,
    stop_loss_pct: 2,
    take_profit_pct: 4,
    max_concurrent_trades: 3,
    research_depth: "balanced",
    daily_loss_limit_usd: 200,
    profit_target_usd: 1000,
    max_api_spend_usd: 5,
    human_approval_required: false,
  };
}

type StepRecord = {
  id: string;
  sessionId: string;
  cycleId: string;
  stage: string;
  status: string;
  attempt: number;
  startedAt: string | null;
  completedAt: string | null;
  nextRetryAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
};
