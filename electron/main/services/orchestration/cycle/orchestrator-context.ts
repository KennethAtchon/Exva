import PQueue from "p-queue";
import {
  toLegacySessionConfig,
  type EventSourceType,
  type ExecutionStage,
  type SessionConfig,
  type WorkspaceSession,
} from "@/lib/types";
import type { OrchestratorDeps } from "../../session";
import { resolveSessionInstrumentClasses } from "../../session/effective-instrument-classes";
import type { InstrumentClass } from "@/lib/types";
import { ExecutionStepRunner, type StepResult } from "./execution-step-runner";
import type { CycleContext } from "./types";
import {
  DEFAULT_SELECTOR_NO_INSTRUMENT_RETRY_MINUTES,
  SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX,
  SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN,
} from "./types";

export class OrchestratorContext {
  readonly queue = new PQueue({ concurrency: 1 });
  readonly approvalCallbacks = new Map<string, (approved: boolean) => void>();
  readonly pendingApprovalIds = new Map<string, string>();
  readonly cycleContexts = new Map<string, CycleContext>();
  readonly stepRunners = new Map<string, ExecutionStepRunner>();

  unsubscribeTradeClosed: (() => void) | null = null;
  cycleRestartInFlight = false;
  started = false;
  pauseAfterStep = false;
  noInstrumentRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly sessionId: string,
    readonly deps: OrchestratorDeps,
  ) {}

  runtimeIsActive(): boolean {
    return this.deps.bus.runtimeStatus(this.sessionId) === "active";
  }

  enqueueTask(
    task: () => Promise<void>,
    onError: (error: unknown) => void,
  ): void {
    this.queue.add(task).catch(onError);
  }

  getSessionConfig(): SessionConfig {
    return toLegacySessionConfig(
      this.deps.strategyContextService.get(this.sessionId),
    );
  }

  getNoInstrumentRetryMinutes(): number {
    const configured = this.deps.sessionSelectorSettingsRepo.get(
      this.sessionId,
    ).noInstrumentRetryMinutes;
    return typeof configured === "number" &&
      Number.isInteger(configured) &&
      configured >= SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN &&
      configured <= SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX
      ? configured
      : DEFAULT_SELECTOR_NO_INSTRUMENT_RETRY_MINUTES;
  }

  getStepRunner(cycleId: string): ExecutionStepRunner {
    const existing = this.stepRunners.get(cycleId);
    if (existing) return existing;
    const runner = new ExecutionStepRunner(this.sessionId, cycleId, {
      stepsRepo: this.deps.sessionExecutionStepsRepo,
      bus: this.deps.bus,
      logger: this.deps.logger,
    });
    this.stepRunners.set(cycleId, runner);
    return runner;
  }

  handleStepFailure(
    stage: ExecutionStage,
    cycleId: string,
    result: Extract<StepResult<unknown>, { ok: false }>,
    tradeId: string | null = null,
  ): void {
    this.emitEvent(
      "ERROR",
      tradeId,
      `${stage} failed: ${result.errorMessage}`,
      "orchestrator",
      cycleId,
    );
    if (
      !result.retryable &&
      stage !== "risk_gate" &&
      stage !== "broker_order"
    ) {
      this.setSessionStatus("attention_required");
    }
  }

  clearAttentionRequired(): void {
    if (
      this.deps.sessionRepo.getStatus(this.sessionId) === "attention_required"
    ) {
      this.setSessionStatus("active");
    }
  }

  setSessionStatus(status: WorkspaceSession["status"]): void {
    const current = this.deps.sessionRepo.getStatus(this.sessionId);
    if (current === status) return;
    this.deps.sessionRepo.setStatus(status, this.sessionId);
    this.deps.bus.emit("session_status_changed", {
      sessionId: this.sessionId,
      status,
    });
  }

  async pauseIfRequested(cycleId: string): Promise<boolean> {
    if (!this.pauseAfterStep) return false;
    this.pauseAfterStep = false;
    this.queue.pause();
    this.clearNoInstrumentRetry();
    if (this.deps.bus.runtimeStatus(this.sessionId) === "active") {
      this.deps.bus.setRuntimeStatus(this.sessionId, "paused");
      this.setSessionStatus("paused");
    }
    this.emitEvent(
      "INFO",
      null,
      "Paused after current step.",
      "orchestrator",
      cycleId,
    );
    return true;
  }

  emitEvent(
    level: "DEBUG" | "INFO" | "WARN" | "ERROR",
    tradeId: string | null,
    message: string,
    agentType: EventSourceType | null = null,
    cycleId: string | null = null,
  ): void {
    const event = this.deps.eventsRepo.insert({
      session_id: this.sessionId,
      trade_id: tradeId,
      cycle_id: cycleId,
      level,
      agent_type: agentType,
      message,
    });
    this.deps.bus.emit("agent_event", event);
  }

  emitAbort(): null {
    this.emitEvent(
      "INFO",
      null,
      "Cycle aborted: session paused mid-flight.",
      "orchestrator",
    );
    return null;
  }

  totalAllocatedUsd(): number {
    return this.deps.sessionBrokerAssignmentsRepo
      .listAssignments(this.sessionId)
      .reduce((sum, assignment) => sum + assignment.allocatedUsd, 0);
  }

  getEffectiveInstrumentClasses(session: WorkspaceSession): InstrumentClass[] {
    return resolveSessionInstrumentClasses(session, this.deps);
  }

  resolveBrokerAccountId(instrumentClass: InstrumentClass): string {
    return this.deps.brokerRouting.resolveBrokerAccountId(
      this.sessionId,
      instrumentClass,
    );
  }

  clearNoInstrumentRetry(): void {
    if (!this.noInstrumentRetryTimer) return;
    clearTimeout(this.noInstrumentRetryTimer);
    this.noInstrumentRetryTimer = null;
  }

  disposeStepRunners(): void {
    for (const runner of this.stepRunners.values()) runner.dispose();
    this.stepRunners.clear();
  }

  releaseApprovalsAndCapital(): void {
    for (const approvalId of this.pendingApprovalIds.values()) {
      this.deps.capitalReservation.releaseByApproval(approvalId);
    }
    this.pendingApprovalIds.clear();
    for (const resolve of this.approvalCallbacks.values()) resolve(false);
    this.approvalCallbacks.clear();
    for (const r of this.deps.capitalReservation.listActiveBySession(
      this.sessionId,
    )) {
      if (r.approvalId == null && r.tradeId) {
        this.deps.capitalReservation.releaseOnFailure(r.tradeId);
      }
    }
  }
}
