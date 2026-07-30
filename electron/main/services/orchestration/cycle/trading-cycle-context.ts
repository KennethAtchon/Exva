import PQueue from "p-queue";
import type {
  EventSourceType,
  ExecutionStage,
  WorkspaceSession,
} from "@/lib/types";
import type { SessionStrategyContext } from "@electron/shared/domain";
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
/** Same skip reason N times in a row → attention_required (Phase 0 guardrail). */
const MAX_CONSECUTIVE_SAME_SKIP = 10;

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
  /**
   * Solution 05: when true, equity-hours session is dormant until next open.
   * No selector/trade cycles; wake via noInstrumentRetryTimer at nextOpenAt.
   */
  marketClosedDormant = false;
  marketClosedDormantNextOpenAt: string | null = null;
  marketClosedSkipCount = 0;
  consecutiveHardFailures = 0;
  /** Streak of identical reasonCategory on no_trade/transient skips. */
  consecutiveSameSkipReason: FailureHistoryReasonCategory | null = null;
  consecutiveSameSkipCount = 0;

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

  getStrategyContext(): SessionStrategyContext {
    return this.deps.strategyContextService.get(this.sessionId);
  }

  getFailureRetryMinutes(): number {
    const configured = this.deps.strategyContextService.getSelectorSettings(
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

  /** Enter market-closed dormancy until nextOpenAt (Solution 05 P2-3). */
  enterMarketClosedDormancy(nextOpenAt: Date): void {
    const nextIso = nextOpenAt.toISOString();
    if (
      this.marketClosedDormant &&
      this.marketClosedDormantNextOpenAt === nextIso
    ) {
      return; // same closed window — no re-log / re-arm churn
    }
    this.marketClosedDormant = true;
    this.marketClosedDormantNextOpenAt = nextIso;
    this.marketClosedSkipCount = 0;
    this.setMarketClosedRetryAt(nextOpenAt.getTime());
    this.emitEvent(
      "INFO",
      null,
      `Entering market_closed dormancy until ${nextIso} (ET open). Selector/trade cycles paused.`,
      "orchestrator",
    );
  }

  leaveMarketClosedDormancy(): void {
    if (!this.marketClosedDormant) return;
    const skips = this.marketClosedSkipCount;
    this.marketClosedDormant = false;
    this.marketClosedDormantNextOpenAt = null;
    this.marketClosedSkipCount = 0;
    this.emitEvent(
      "INFO",
      null,
      `Leaving market_closed dormancy; quiet holds/skips during close: ${skips}.`,
      "orchestrator",
    );
  }

  noteMarketClosedSkip(): void {
    if (this.marketClosedDormant) this.marketClosedSkipCount += 1;
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

  /** Clear hard-failure streak only — does not touch no-trade skip counting. */
  resetHardFailureStreak(): void {
    this.consecutiveHardFailures = 0;
  }

  /** Clear consecutive no-trade/skip streak after substantive progress. */
  resetNoTradeSkipStreak(): void {
    this.consecutiveSameSkipReason = null;
    this.consecutiveSameSkipCount = 0;
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

  /** Tell the supervisor this session is still alive. */
  touchHeartbeat(expectedIntervalMs = 15 * 60 * 1000): void {
    this.deps.supervisor?.recordHeartbeat?.({
      sessionId: this.sessionId,
      lastActivityAt: new Date().toISOString(),
      expectedIntervalMs,
    });
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
    this.touchHeartbeat();
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

    const reasonCode = input.code ?? input.reasonCategory;
    const funnelOutcome = mapNoTradeFunnelOutcome(input.outcome, reasonCode);
    this.deps.cycleFunnel?.record({
      cycleId: input.cycleId,
      sessionId: this.sessionId,
      inputId: null,
      originKind: "strategy",
      terminalStage: mapStageToFunnel(input.stage),
      outcome: funnelOutcome,
      reasonCode,
      detailJson: JSON.stringify({ message: input.message }),
      occurredAt,
    });

    this.maybeRaiseConsecutiveSkipAlarm(input);
  }

  private maybeRaiseConsecutiveSkipAlarm(input: {
    cycleId: string;
    outcome: OrchestrationOutcome;
    reasonCategory: FailureHistoryReasonCategory;
  }): void {
    const isSkipOutcome =
      input.outcome === "no_trade" || input.outcome === "transient";
    if (!isSkipOutcome) {
      this.consecutiveSameSkipReason = null;
      this.consecutiveSameSkipCount = 0;
      return;
    }

    if (this.consecutiveSameSkipReason === input.reasonCategory) {
      this.consecutiveSameSkipCount += 1;
    } else {
      this.consecutiveSameSkipReason = input.reasonCategory;
      this.consecutiveSameSkipCount = 1;
    }

    if (this.consecutiveSameSkipCount < MAX_CONSECUTIVE_SAME_SKIP) return;
    if (
      this.deps.sessionRepo.getStatus(this.sessionId) === "attention_required"
    ) {
      return;
    }

    const reason = input.reasonCategory;
    const count = this.consecutiveSameSkipCount;
    const message = `Session needs attention: ${count} consecutive skips with reason "${reason}". Data starvation and healthy no-setup look the same until this fires.`;
    this.emitEvent("ERROR", null, message, "orchestrator", input.cycleId);
    this.deps.bus.emit("notification", {
      title: "Exva: consecutive skips",
      body: `Session ${this.sessionId.slice(0, 8)}… skipped ${count} times (${reason}).`,
      level: "ERROR",
    });
    void this.deps.supervisor
      ?.raiseConsecutiveSkip(this.sessionId, message)
      .catch((error) => {
        this.deps.logger.error(
          { err: error, sessionId: this.sessionId },
          "failed to raise consecutive-skip supervisor alarm",
        );
      });
    this.setSessionStatus("attention_required");
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

function mapNoTradeFunnelOutcome(
  outcome: OrchestrationOutcome,
  reasonCode: string,
): import("@electron/shared/domain/cycle-funnel").CycleFunnelOutcome["outcome"] {
  if (outcome === "bug") return "failed";
  if (outcome !== "no_trade") return "rejected";
  const upper = reasonCode.toUpperCase();
  if (
    upper === "INPUT_STALE" ||
    reasonCode === "input_stale" ||
    reasonCode.includes("stale")
  ) {
    return "input_stale";
  }
  if (
    upper === "INPUT_INSUFFICIENT_HISTORY" ||
    reasonCode === "input_insufficient_history" ||
    reasonCode === "insufficient_bars" ||
    reasonCode === "insufficient_history" ||
    reasonCode.includes("insufficient")
  ) {
    return "input_insufficient_history";
  }
  return "no_setup";
}

function mapStageToFunnel(
  stage: ExecutionStage | "trade_cycle" | "selector_cycle",
): import("@electron/shared/domain/cycle-funnel").CycleFunnelOutcome["terminalStage"] {
  switch (stage) {
    case "selector":
    case "selector_cycle":
      return "selector";
    case "fundamental":
    case "technical":
    case "review":
    case "candidate_validation":
      return "research";
    case "decision":
      return "decision";
    case "risk_gate":
      return "risk";
    case "broker_order":
      return "order";
    case "monitoring":
      return "fill";
    case "trade_cycle":
      return "decision";
    default:
      return "decision";
  }
}
