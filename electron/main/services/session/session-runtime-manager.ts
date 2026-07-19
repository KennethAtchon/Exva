import type { ExecutionStage, Trade } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import {
  InProcessSessionRuntimeHost,
  type SessionRuntimeHost,
} from "./session-runtime-host";
import {
  SessionStartupRecoveryService,
  type SessionStartupRecoveryDeps,
} from "./session-startup-recovery-service";
import { countOpenTrades } from "./session-trade-state";
import type {
  ApprovalRecheckInput,
  ManagedSessionRuntime,
  SessionRuntimeManagerDeps,
} from "./session-types";

export class SessionRuntimeManager {
  private readonly runtimes = new Map<string, ManagedSessionRuntime>();
  /** Coalesces concurrent startSession calls for the same id (TOCTOU guard). */
  private readonly startInFlight = new Map<
    string,
    Promise<ManagedSessionRuntime>
  >();
  private readonly startupRecovery: SessionStartupRecoveryService;
  private readonly runtimeHost: SessionRuntimeHost;

  constructor(
    private readonly deps: SessionRuntimeManagerDeps,
    runtimeHost?: SessionRuntimeHost,
  ) {
    this.runtimeHost =
      runtimeHost ?? new InProcessSessionRuntimeHost(this.deps);
    this.startupRecovery = new SessionStartupRecoveryService(
      this.recoveryDeps(),
    );
    this.deps.bus.on("trade_closed", (trade) => {
      void this.handleTradeClosedForDrain(trade).catch((error) => {
        this.deps.logger.error(
          { err: error, sessionId: trade.sessionId, tradeId: trade.id },
          "failed to handle trade_closed for drain completion",
        );
      });
    });
  }

  private recoveryDeps(): SessionStartupRecoveryDeps {
    return {
      sessionRepo: this.deps.sessionRepo,
      tradesRepo: this.deps.tradesRepo,
      tradeApprovalsRepo: this.deps.tradeApprovalsRepo,
      sessionExecutionStepsRepo: this.deps.sessionExecutionStepsRepo,
      capitalReservationsRepo: this.deps.capitalReservationsRepo,
      capitalReservation: this.deps.capitalReservation,
      brokerRegistry: this.deps.brokerRegistry,
      eventsRepo: this.deps.eventsRepo,
      logger: this.deps.logger,
    };
  }

  async startSession(sessionId: string): Promise<ManagedSessionRuntime> {
    const existing = this.runtimes.get(sessionId);
    if (existing) {
      this.deps.logger.debug({ sessionId }, "runtime already active");
      return existing;
    }

    const inFlight = this.startInFlight.get(sessionId);
    if (inFlight) {
      this.deps.logger.debug({ sessionId }, "runtime start already in flight");
      return inFlight;
    }

    const startPromise = this.startSessionExclusive(sessionId).finally(() => {
      this.startInFlight.delete(sessionId);
    });
    this.startInFlight.set(sessionId, startPromise);
    return startPromise;
  }

  private async startSessionExclusive(
    sessionId: string,
  ): Promise<ManagedSessionRuntime> {
    const existing = this.runtimes.get(sessionId);
    if (existing) {
      this.deps.logger.debug({ sessionId }, "runtime already active");
      return existing;
    }

    this.deps.logger.info({ sessionId }, "starting runtime");

    const session = this.deps.sessionRepo.requireById(sessionId);
    const runtime = await this.runtimeHost.createRuntime(sessionId);

    this.runtimes.set(sessionId, runtime);
    const initStatus = this.resolveInitialRuntimeStatus(session.status);
    this.deps.bus.setRuntimeStatus(
      sessionId,
      initStatus === "monitoring_only" ? "paused" : initStatus,
    );
    if (
      session.status !== initStatus &&
      session.status !== "monitoring_only" &&
      initStatus !== "monitoring_only"
    ) {
      this.deps.sessionRepo.setStatus(initStatus, sessionId);
    }

    try {
      await runtime.initialize(initStatus);
      this.deps.logger.info({ sessionId, initStatus }, "runtime started");
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
    // Emit immediately so the renderer and other consumers see the change
    // without waiting for the next polling cycle.
    this.deps.bus.emit("session_status_changed", {
      sessionId,
      status: "paused",
    });
    await runtime.pause();
    this.deps.logger.info({ sessionId }, "runtime paused");
  }

  async resumeSession(sessionId: string): Promise<void> {
    this.deps.logger.info({ sessionId }, "resuming runtime");
    const priorStatus = this.deps.sessionRepo.getStatus(sessionId);
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      throw new AppError(
        `Runtime for session ${sessionId} is not active`,
        "SESSION_NOT_ACTIVE",
        { sessionId },
      );
    }
    this.deps.bus.setRuntimeStatus(sessionId, "active");
    this.deps.sessionRepo.setStatus("active", sessionId);
    this.deps.bus.emit("session_status_changed", {
      sessionId,
      status: "active",
    });
    await runtime.resume();
    this.deps.signals?.onSessionResumed(sessionId);
    if (priorStatus === "attention_required") {
      // A failed selector cycle does not auto-reschedule, so an idempotent
      // resume() leaves the loop dead. Force a fresh selector cycle.
      this.deps.logger.info(
        { sessionId },
        "restarting orchestrator after attention_required",
      );
      await runtime.orchestrator.restartFromAttention();
    }
    this.deps.logger.info({ sessionId, priorStatus }, "runtime resumed");
  }

  async stopSession(sessionId: string): Promise<void> {
    this.deps.logger.info({ sessionId }, "stopping runtime");
    const runtime = this.requireRuntime(sessionId);
    this.deps.bus.setRuntimeStatus(sessionId, "stopping");
    try {
      if (runtime.shutdown) {
        await runtime.shutdown();
      } else {
        await runtime.stop();
      }
      this.deps.sessionRepo.setStatus("stopped", sessionId);
      this.deps.bus.emit("session_status_changed", {
        sessionId,
        status: "stopped",
      });
    } catch (error) {
      this.deps.sessionRepo.setStatus("attention_required", sessionId);
      this.deps.bus.emit("session_status_changed", {
        sessionId,
        status: "attention_required",
      });
      throw error;
    } finally {
      this.runtimes.delete(sessionId);
      this.deps.bus.clearRuntimeStatus(sessionId);
    }
    this.deps.logger.info({ sessionId }, "runtime stopped");
  }

  async drainSession(sessionId: string): Promise<void> {
    this.deps.logger.info({ sessionId }, "draining session to stop when flat");
    const runtime = this.requireRuntime(sessionId);
    this.deps.bus.setRuntimeStatus(sessionId, "paused");
    this.deps.sessionRepo.setStatus("monitoring_only", sessionId);
    this.deps.bus.emit("session_status_changed", {
      sessionId,
      status: "monitoring_only",
    });
    await runtime.drainStop();
    this.deps.logger.info({ sessionId }, "session drain started");
  }

  async completeDrainStop(sessionId: string): Promise<void> {
    if (this.deps.sessionRepo.getStatus(sessionId) !== "monitoring_only") {
      return;
    }
    const openTradeCount = countOpenTrades(this.deps.tradesRepo, sessionId);
    if (openTradeCount > 0) {
      return;
    }
    this.deps.logger.info({ sessionId }, "completing drain stop");
    await this.stopSession(sessionId);
  }

  get(sessionId: string): ManagedSessionRuntime | null {
    return this.runtimes.get(sessionId) ?? null;
  }

  listActive(): ManagedSessionRuntime[] {
    return [...this.runtimes.values()];
  }

  async shutdownAll(): Promise<void> {
    await this.runtimeHost.shutdownAll?.();
  }

  /**
   * Startup rehydration policy (intentional, conservative):
   *
   *   - Previously `active` sessions are NOT auto-resumed. They are demoted to `paused`
   *     and started in paused mode: orchestrator does not open new cycles, but the
   *     trade monitor IS started so open positions remain managed (stops/take-profit
   *     can still fire). Operator must explicitly Resume to re-enable new intake.
   *   - Previously `paused` sessions are rehydrated in paused mode unchanged.
   *   - Previously `monitoring_only` sessions stay in drain mode: orchestrator
   *     remains stopped while the trade monitor keeps managing open positions.
   *
   * Rationale: between process death and restart, market state and broker state may
   * have changed in ways the strategy did not see. Auto-resuming new entries from
   * stale context is unsafe; abandoning open positions is also unsafe. Paused-with-
   * live-monitor is the safe intersection.
   */
  async rehydrateFromDb(): Promise<void> {
    this.deps.signals?.replayStartup();
    const recoverable = this.startupRecovery.collectRecoverableSessions();
    this.deps.logger.info(
      { sessionCount: recoverable.length },
      "rehydrating runtimes from db",
    );
    for (const entry of recoverable) {
      await this.startupRecovery.recoverSession(entry.sessionId, entry);
      await this.startSession(entry.sessionId);
    }
    this.deps.logger.info(
      { sessionCount: recoverable.length },
      "runtime rehydration complete",
    );
  }

  async enqueueApprovalRecheck(input: ApprovalRecheckInput): Promise<void> {
    this.deps.logger.debug(
      { sessionId: input.sessionId, approvalId: input.approvalId },
      "enqueue approval recheck",
    );
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

  private resolveInitialRuntimeStatus(
    status: ReturnType<SessionRuntimeManagerDeps["sessionRepo"]["getStatus"]>,
  ): "active" | "paused" | "monitoring_only" {
    if (status === "paused") return "paused";
    if (status === "monitoring_only") return "monitoring_only";
    return "active";
  }

  private async handleTradeClosedForDrain(trade: Trade): Promise<void> {
    if (trade.status !== "closed" || !trade.sessionId) return;
    if (
      this.deps.sessionRepo.getStatus(trade.sessionId) !== "monitoring_only"
    ) {
      return;
    }
    const openTradeCount = countOpenTrades(
      this.deps.tradesRepo,
      trade.sessionId,
    );
    if (openTradeCount > 0) return;
    await this.completeDrainStop(trade.sessionId);
  }

  private requireRuntime(sessionId: string): ManagedSessionRuntime {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      throw new AppError(
        `Runtime for session ${sessionId} is not active`,
        "SESSION_NOT_ACTIVE",
        { sessionId },
      );
    }
    return runtime;
  }
}
