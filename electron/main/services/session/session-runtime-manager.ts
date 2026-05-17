import type { ExecutionStage } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import { SessionRuntime } from "./session-runtime";
import type { ApprovalRecheckInput, OrchestratorDeps, SessionRuntimeManagerDeps } from "./session-types";

export class SessionRuntimeManager {
  private readonly runtimes = new Map<string, SessionRuntime>();

  constructor(private readonly deps: SessionRuntimeManagerDeps) {}

  async startSession(sessionId: string): Promise<SessionRuntime> {
    const existing = this.runtimes.get(sessionId);
    if (existing) {
      this.deps.logger.debug({ sessionId }, "runtime already active");
      return existing;
    }

    this.deps.logger.info({ sessionId }, "starting runtime");

    const session = this.deps.sessionRepo.requireById(sessionId);
    const orchestratorDeps: OrchestratorDeps = {
      sessionRepo: this.deps.sessionRepo,
      sessionStrategiesRepo: this.deps.sessionStrategiesRepo,
      strategyContextService: this.deps.strategyContextService,
      tradesRepo: this.deps.tradesRepo,
      tradeApprovalsRepo: this.deps.tradeApprovalsRepo,
      agentRunsRepo: this.deps.agentRunsRepo,
      agentMessagesRepo: this.deps.agentMessagesRepo,
      eventsRepo: this.deps.eventsRepo,
      statsRepo: this.deps.statsRepo,
      sessionAiRolesRepo: this.deps.sessionAiRolesRepo,
      sessionSelectorSettingsRepo: this.deps.sessionSelectorSettingsRepo,
      sessionExecutionStepsRepo: this.deps.sessionExecutionStepsRepo,
      providerAccountsRepo: this.deps.providerAccountsRepo,
      workspacePreferencesRepo: this.deps.workspacePreferencesRepo,
      capitalReservationsRepo: this.deps.capitalReservationsRepo,
      capitalReservation: this.deps.capitalReservation,
      brokerRoutingRepo: this.deps.brokerRoutingRepo,
      sessionBrokerAssignmentsRepo: this.deps.sessionBrokerAssignmentsRepo,
      brokerAccountsRepo: this.deps.brokerAccountsRepo,
      brokerRegistry: this.deps.brokerRegistry,
      brokerRouting: this.deps.brokerRouting,
      brokerBalanceCache: this.deps.brokerBalanceCache,
      brokerCapital: this.deps.brokerCapital,
      brokerAllocationGate: this.deps.brokerAllocationGate,
      instrumentNormalizer: this.deps.instrumentNormalizer,
      instrumentCacheRepo: this.deps.instrumentCacheRepo,
      ai: this.deps.ai,
      riskEngine: this.deps.riskEngine,
      bus: this.deps.bus,
      logger: this.deps.logger,
    };

    const runtime = new SessionRuntime(
      sessionId,
      this.deps.createOrchestrator(sessionId, orchestratorDeps),
      this.deps.createTradeMonitor(sessionId),
    );

    this.runtimes.set(sessionId, runtime);
    const runtimeStatus = session.status === "paused" ? "paused" : "active";
    this.deps.bus.setRuntimeStatus(sessionId, runtimeStatus);
    if (session.status !== runtimeStatus) {
      this.deps.sessionRepo.setStatus(runtimeStatus, sessionId);
    }

    try {
      await runtime.initialize(runtimeStatus);
      this.deps.logger.info({ sessionId, runtimeStatus }, "runtime started");
      return runtime;
    } catch (error) {
      this.runtimes.delete(sessionId);
      this.deps.bus.clearRuntimeStatus(sessionId);
      this.deps.logger.error({ err: error, sessionId }, "runtime start failed");
      throw error;
    }
  }

  async pauseSession(sessionId: string): Promise<void> {
    this.deps.logger.info({ sessionId }, "pausing runtime");
    const runtime = this.requireRuntime(sessionId);
    this.deps.bus.setRuntimeStatus(sessionId, "paused");
    this.deps.sessionRepo.setStatus("paused", sessionId);
    await runtime.pause();
    this.deps.logger.info({ sessionId }, "runtime paused");
  }

  async resumeSession(sessionId: string): Promise<void> {
    this.deps.logger.info({ sessionId }, "resuming runtime");
    const priorStatus = this.deps.sessionRepo.getStatus(sessionId);
    const runtime = this.runtimes.get(sessionId) ?? (await this.startSession(sessionId));
    this.deps.bus.setRuntimeStatus(sessionId, "active");
    this.deps.sessionRepo.setStatus("active", sessionId);
    await runtime.resume();
    if (priorStatus === "attention_required") {
      // A failed selector cycle does not auto-reschedule, so an idempotent
      // resume() leaves the loop dead. Force a fresh selector cycle.
      this.deps.logger.info({ sessionId }, "restarting orchestrator after attention_required");
      await runtime.orchestrator.restartFromAttention();
    }
    this.deps.logger.info({ sessionId, priorStatus }, "runtime resumed");
  }

  async stopSession(sessionId: string): Promise<void> {
    this.deps.logger.info({ sessionId }, "stopping runtime");
    const runtime = this.requireRuntime(sessionId);
    this.deps.bus.setRuntimeStatus(sessionId, "stopping");
    this.deps.sessionRepo.setStatus("stopped", sessionId);
    await runtime.stop();
    this.runtimes.delete(sessionId);
    this.deps.bus.clearRuntimeStatus(sessionId);
    this.deps.logger.info({ sessionId }, "runtime stopped");
  }

  get(sessionId: string): SessionRuntime | null {
    return this.runtimes.get(sessionId) ?? null;
  }

  listActive(): SessionRuntime[] {
    return [...this.runtimes.values()];
  }

  /**
   * Startup rehydration policy (intentional, conservative):
   *
   *   - Previously `active` sessions are NOT auto-resumed. They are demoted to `paused`
   *     and started in paused mode: orchestrator does not open new cycles, but the
   *     trade monitor IS started so open positions remain managed (stops/take-profit
   *     can still fire). Operator must explicitly Resume to re-enable new intake.
   *   - Previously `paused` sessions are rehydrated in paused mode unchanged.
   *
   * Rationale: between process death and restart, market state and broker state may
   * have changed in ways the strategy did not see. Auto-resuming new entries from
   * stale context is unsafe; abandoning open positions is also unsafe. Paused-with-
   * live-monitor is the safe intersection.
   */
  async rehydrateFromDb(): Promise<void> {
    const sessions = this.deps.sessionRepo.listByStatuses(["active", "paused"]);
    this.deps.logger.info({ sessionCount: sessions.length }, "rehydrating runtimes from db");
    for (const session of sessions) {
      if (session.status === "active") {
        this.deps.logger.warn(
          { sessionId: session.id },
          "startup rehydration: demoting previously-active session to paused (monitor stays live for open positions)",
        );
        this.deps.sessionRepo.setStatus("paused", session.id);
      }
      await this.startSession(session.id);
    }
    this.deps.logger.info({ sessionCount: sessions.length }, "runtime rehydration complete");
  }

  async enqueueApprovalRecheck(input: ApprovalRecheckInput): Promise<void> {
    this.deps.logger.debug({ sessionId: input.sessionId, approvalId: input.approvalId }, "enqueue approval recheck");
    const runtime = this.requireRuntime(input.sessionId);
    await runtime.orchestrator.runApprovalRecheck(input);
  }

  pauseAfterCurrentStep(sessionId: string): void {
    const runtime = this.requireRuntime(sessionId);
    runtime.orchestrator.pauseAfterCurrentStep();
  }

  async retryStep(
    sessionId: string,
    cycleId: string,
    stage: ExecutionStage,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const runtime = this.requireRuntime(sessionId);
    return runtime.orchestrator.retryStep(cycleId, stage);
  }

  private requireRuntime(sessionId: string): SessionRuntime {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      throw new AppError(`Runtime for session ${sessionId} is not active`, "SESSION_NOT_ACTIVE", { sessionId });
    }
    return runtime;
  }
}
