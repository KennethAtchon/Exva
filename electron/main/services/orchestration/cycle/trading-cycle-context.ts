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
import {
  TradingStepRunner,
  type TradingStepResult,
} from "./trading-step-runner";
import type { CycleContext } from "./types";
import {
  DEFAULT_SELECTOR_NO_INSTRUMENT_RETRY_MINUTES,
  SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX,
  SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN,
} from "./types";
import {
  outcomeLevel,
  type FailureHistoryEntry,
  type FailureHistoryReasonCategory,
  type OrchestrationOutcome,
} from "./runtime-outcome";

const FAILURE_HISTORY_WINDOW_MS = 60 * 60 * 1000;
const MAX_CONSECUTIVE_HARD_FAILURES = 3;

export class TradingCycleContext {
  readonly queue = new PQueue({ concurrency: 1 });
  /** FIFO signal delivery processing — one signal-driven selector cycle at a time. */
  readonly signalDeliveryQueue = new PQueue({ concurrency: 1 });
  readonly approvalCallbacks = new Map<string, (approved: boolean) => void>();
  readonly pendingApprovalIds = new Map<string, string>();
  readonly cycleContexts = new Map<string, CycleContext>();
  readonly stepRunners = new Map<string, TradingStepRunner>();
  readonly failureHistory: FailureHistoryEntry[] = [];

  stopped = false;
  unsubscribeTradeClosed: (() => void) | null = null;
  cycleRestartInFlight = false;
  started = false;
  pauseAfterStep = false;
  noInstrumentRetryTimer: ReturnType<typeof setTimeout> | null = null;
  scheduleSelectorCycle: ((label: string) => Promise<void>) | null = null;
  /**
   * Epoch ms of the next market open, set by the selector when a cycle produces
   * zero tradable instruments solely because the market is closed. Consumed
   * once by the no-instrument retry scheduler so the session wakes at the open
   * instead of polling on the fixed interval. null = no pending market wait.
   */
  private marketClosedRetryAt: number | null = null;
  consecutiveHardFailures = 0;

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
    if (this.stopped) return;
    this.queue.add(task).catch(onError);
  }

  getSessionConfig(): SessionConfig {
    return toLegacySessionConfig(
      this.deps.strategyContextService.get(this.sessionId),
    );
  }

  getFailureRetryMinutes(): number {
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

  getNoInstrumentRetryMinutes(): number {
    return this.getFailureRetryMinutes();
  }

  getStepRunner(cycleId: string): TradingStepRunner {
    const existing = this.stepRunners.get(cycleId);
    if (existing) return existing;
    const runner = new TradingStepRunner(this.sessionId, cycleId, {
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
    result: Extract<TradingStepResult<unknown>, { ok: false }>,
    tradeId: string | null = null,
  ): void {
    const level =
      result.level ?? outcomeLevel(result.outcome, result.retryable);
    this.emitEvent(
      level,
      tradeId,
      `${stage} failed: ${result.errorMessage}`,
      "orchestrator",
      cycleId,
    );

    this.recordFailure({
      cycleId,
      stage,
      outcome: result.outcome,
      level,
      code: result.errorCode,
      message: `${stage} failed: ${result.errorMessage}`,
      reasonCategory: result.reasonCategory,
    });

    if (result.outcome === "operator_required" || result.outcome === "bug") {
      this.clearNoInstrumentRetry();
      this.consecutiveHardFailures = 0;
      this.setSessionStatus("attention_required");
      return;
    }

    if (result.outcome === "transient") {
      this.consecutiveHardFailures += 1;
      if (this.consecutiveHardFailures >= MAX_CONSECUTIVE_HARD_FAILURES) {
        this.clearNoInstrumentRetry();
        this.emitEvent(
          "ERROR",
          tradeId,
          `Session paused after ${this.consecutiveHardFailures} consecutive hard failures. Resume after investigating the runtime errors.`,
          "orchestrator",
          cycleId,
        );
        this.setSessionStatus("attention_required");
      }
      return;
    }

    this.consecutiveHardFailures = 0;
  }

  clearAttentionRequired(): void {
    if (
      this.deps.sessionRepo.getStatus(this.sessionId) === "attention_required"
    ) {
      this.setSessionStatus("active");
    }
  }

  setSessionStatus(status: WorkspaceSession["status"]): void {
    if (this.stopped) return;
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
    const logFn =
      level === "ERROR"
        ? this.deps.logger.error.bind(this.deps.logger)
        : level === "WARN"
          ? this.deps.logger.warn.bind(this.deps.logger)
          : level === "DEBUG"
            ? this.deps.logger.debug.bind(this.deps.logger)
            : this.deps.logger.info.bind(this.deps.logger);
    logFn(
      {
        sessionId: this.sessionId,
        tradeId,
        cycleId,
        agentType,
        eventId: event.id,
        eventLevel: level,
      },
      message,
    );
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

  setMarketClosedRetryAt(at: number | null): void {
    this.marketClosedRetryAt = at;
  }

  /** Reads and clears the pending market-open wake time (single-shot). */
  consumeMarketClosedRetryAt(): number | null {
    const at = this.marketClosedRetryAt;
    this.marketClosedRetryAt = null;
    return at;
  }

  clearNoInstrumentRetry(): void {
    if (!this.noInstrumentRetryTimer) return;
    clearTimeout(this.noInstrumentRetryTimer);
    this.noInstrumentRetryTimer = null;
  }

  resetHardFailureStreak(): void {
    this.consecutiveHardFailures = 0;
  }

  getFailureHistory(): FailureHistoryEntry[] {
    this.pruneFailureHistory();
    return [...this.failureHistory];
  }

  getFailureHistoryForInstrument(symbol: string): FailureHistoryEntry[] {
    const normalized = symbol.trim().toUpperCase();
    return this.getFailureHistory().filter(
      (entry) => entry.instrumentSymbol?.trim().toUpperCase() === normalized,
    );
  }

  getNearestRetryAt(): string | null {
    const retryTimes = this.getFailureHistory()
      .map((entry) => entry.retryAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    return retryTimes[0] ?? null;
  }

  recordFailure(input: {
    cycleId: string;
    stage: ExecutionStage | "trade_cycle" | "selector_cycle";
    outcome: OrchestrationOutcome;
    level: "WARN" | "ERROR";
    code: string | null;
    message: string;
    reasonCategory: FailureHistoryReasonCategory;
  }): void {
    this.pruneFailureHistory();
    const cycleContext = this.cycleContexts.get(input.cycleId);
    const instrument =
      cycleContext?.kind === "trade" ? cycleContext.instrument : null;
    const occurredAt = new Date().toISOString();
    const retryAt =
      input.outcome === "no_trade" || input.outcome === "transient"
        ? new Date(
            Date.now() + this.getFailureRetryMinutes() * 60 * 1000,
          ).toISOString()
        : null;

    this.failureHistory.push({
      occurredAt,
      expiresAt: new Date(
        Date.parse(occurredAt) + FAILURE_HISTORY_WINDOW_MS,
      ).toISOString(),
      retryAt,
      cycleId: input.cycleId,
      instrumentSymbol: instrument?.symbol ?? null,
      instrumentClass: instrument?.instrumentClass ?? null,
      stage: input.stage,
      outcome: input.outcome,
      level: input.level,
      code: input.code,
      message: input.message,
      reasonCategory: input.reasonCategory,
    });
    this.pruneFailureHistory();
  }

  private pruneFailureHistory(): void {
    const now = Date.now();
    const kept = this.failureHistory.filter(
      (entry) => Date.parse(entry.expiresAt) > now,
    );
    this.failureHistory.splice(0, this.failureHistory.length, ...kept);
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
