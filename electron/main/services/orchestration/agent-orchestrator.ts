import PQueue from "p-queue";
import { toLegacySessionConfig, type EventSourceType, type ExecutionStage, type InstrumentClass, type SessionConfig, type Trade, type WorkspaceSession } from "@/lib/types";
import { SEARCH_EVERYTHING_SCOPE } from "@electron/shared/catalog/session-instrument-classes";
import type { SelectorEvidence } from "@electron/shared/ai/selector-pipeline-candidate";
import { AppError } from "@electron/shared/infra/errors";
import { isMarketDiscoveryAdapter, type OrderRequest, type PolymarketMarketRow } from "../broker/adapters/broker-adapter";
import type { ApprovalRecheckInput, OrchestratorDeps } from "../session";
import { resolveSessionInstrumentClasses } from "../session/effective-instrument-classes";
import { buildSelectorDefinitionFingerprint, hashSelectorDefinition } from "./selector-definition-hash";
import { ResearchBurstService } from "./research-burst-service";
import { ExecutionStepRunner, type StepResult } from "./execution-step-runner";
import { CandidateValidationService, type ToolStepTrace } from "./candidate-validation-service";
import { OrderPolicyGate } from "./order-policy-gate";

type ResolvedInstrument = {
  symbol: string;
  instrumentClass: InstrumentClass;
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
  selectorEvidence?: SelectorEvidence | null;
  selectorTraces?: ToolStepTrace[];
};

import type { AgentResult } from "../ai/ai-runtime/ai-runtime-types";
import type { TechnicalSignal, FundamentalSignal, ReviewSignal, TradeSignal } from "@electron/shared/ai/pipeline-signals";
import { computeExecutionProfile, priceLevelsFromProfile } from "../ai/engines/execution-profile-engine";

type AiTechnicalRun = AgentResult<TechnicalSignal>;
type AiFundamentalRun = AgentResult<FundamentalSignal>;
type AiReviewRun = AgentResult<ReviewSignal>;
type AiDecisionRun = AgentResult<TradeSignal>;
type AiPipelineResult = { technical: AiTechnicalRun; fundamental: AiFundamentalRun; review: AiReviewRun; decision: AiDecisionRun };

type PredictionToken = { outcome?: unknown; token_id?: unknown };

type SelectorCycleContext = {
  kind: "selector";
  cycleId: string;
  label: string;
};

type TradeCycleContext = {
  kind: "trade";
  cycleId: string;
  instrument: ResolvedInstrument;
  technical?: AiTechnicalRun;
  fundamental?: AiFundamentalRun;
  review?: AiReviewRun;
  decision?: AiDecisionRun;
  trade?: Trade;
  riskOrder?: OrderRequest;
};

type CycleContext = SelectorCycleContext | TradeCycleContext;
const DEFAULT_SELECTOR_NO_INSTRUMENT_RETRY_MINUTES = 5;
const SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN = 1;
const SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX = 60;

export class AgentOrchestrator {
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly approvalCallbacks = new Map<string, (approved: boolean) => void>();
  /** Trade id → approval id while waiting for human decision. */
  private readonly pendingApprovalIds = new Map<string, string>();
  private readonly cycleContexts = new Map<string, CycleContext>();
  private readonly stepRunners = new Map<string, ExecutionStepRunner>();
  private unsubscribeTradeClosed: (() => void) | null = null;
  private cycleRestartInFlight = false;
  private started = false;
  private pauseAfterStep = false;
  private noInstrumentRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly sessionId: string,
    private readonly deps: OrchestratorDeps,
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      this.deps.logger.debug({ sessionId: this.sessionId }, "orchestrator already started; resuming queue");
      this.queue.start();
      return;
    }

    const config = this.getSessionConfig();
    this.queue.concurrency = config.max_concurrent_trades;
    this.deps.logger.info({ sessionId: this.sessionId, concurrency: this.queue.concurrency }, "orchestrator starting");
    this.attachTradeClosedListener();
    this.started = true;
    await this.executeSelectorCycle({ kind: "selector", cycleId: crypto.randomUUID(), label: "Initial research cycle complete" });
    this.deps.logger.info({ sessionId: this.sessionId }, "orchestrator started");
  }

  async pause(): Promise<void> {
    this.queue.pause();
    this.clearNoInstrumentRetry();
  }

  async resume(): Promise<void> {
    this.pauseAfterStep = false;
    if (!this.started) {
      await this.start();
      return;
    }
    this.queue.start();
  }

  /**
   * Re-kick the selector loop after a non-retryable failure put the session
   * into attention_required. A failed selector cycle does NOT auto-reschedule
   * (handleStepFailure just returns), so a plain resume() would leave the
   * orchestrator idle. This enqueues a fresh selector cycle.
   */
  async restartFromAttention(): Promise<void> {
    this.pauseAfterStep = false;
    this.clearNoInstrumentRetry();
    this.queue.start();
    if (!this.started) {
      await this.start();
      return;
    }
    const cycleId = crypto.randomUUID();
    this.deps.logger.info({ sessionId: this.sessionId, cycleId }, "orchestrator restart from attention_required");
    this.queue
      .add(() => this.executeSelectorCycle({ kind: "selector", cycleId, label: "Selector cycle restarted after attention" }))
      .catch((error) => {
        this.emitEvent(
          "ERROR",
          null,
          `Restart selector cycle failed: ${error instanceof Error ? error.message : String(error)}`,
          "orchestrator",
          cycleId,
        );
      });
  }

  async stop(): Promise<void> {
    this.deps.logger.info(
      { sessionId: this.sessionId, pendingApprovals: this.pendingApprovalIds.size, queuedApprovals: this.approvalCallbacks.size },
      "orchestrator stopping",
    );
    this.queue.clear();
    this.detachTradeClosedListener();
    this.clearNoInstrumentRetry();
    this.cycleRestartInFlight = false;
    this.pauseAfterStep = false;
    for (const runner of this.stepRunners.values()) runner.dispose();
    this.stepRunners.clear();
    this.cycleContexts.clear();
    for (const approvalId of this.pendingApprovalIds.values()) {
      this.deps.capitalReservation.releaseByApproval(approvalId);
    }
    this.pendingApprovalIds.clear();
    for (const resolve of this.approvalCallbacks.values()) resolve(false);
    this.approvalCallbacks.clear();
    for (const r of this.deps.capitalReservation.listActiveBySession(this.sessionId)) {
      if (r.approvalId == null && r.tradeId) {
        this.deps.capitalReservation.releaseOnFailure(r.tradeId);
      }
    }
    this.deps.logger.info({ sessionId: this.sessionId }, "orchestrator stopped");
  }

  pauseAfterCurrentStep(): void {
    this.pauseAfterStep = true;
  }

  async retryStep(cycleId: string, stage: ExecutionStage): Promise<{ ok: true } | { ok: false; reason: string }> {
    const context = this.cycleContexts.get(cycleId);
    if (!context) {
      return { ok: false, reason: `No live cycle context exists for ${cycleId}.` };
    }

    this.deps.sessionExecutionStepsRepo.clearFailed(this.sessionId, cycleId, stage);
    const runner = this.stepRunners.get(cycleId);
    if (runner?.get(stage)?.status === "retrying") {
      runner.dispose();
      this.stepRunners.delete(cycleId);
    }

    const enqueue = context.kind === "selector"
      ? () => this.executeSelectorCycle(context)
      : () => this.executeTradeCycle(context);

    this.queue.add(enqueue).catch((error) => {
      this.emitEvent("ERROR", null, `Step retry failed: ${error instanceof Error ? error.message : String(error)}`, "orchestrator", cycleId);
    });
    return { ok: true };
  }

  private async executeSelectorCycle(context: SelectorCycleContext): Promise<void> {
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;
    this.cycleContexts.set(context.cycleId, context);

    const session = this.deps.sessionRepo.requireById(this.sessionId);
    const config = this.getSessionConfig();
    this.queue.concurrency = config.max_concurrent_trades;
    this.deps.bus.emit("research_phase_started", { sessionId: this.sessionId, phase: "selector", cycleId: context.cycleId });

    const result = await this.getStepRunner(context.cycleId).run(
      "selector",
      () => this.runResearchBurst(session, config, context.cycleId),
      {
        onRetry: () => {
          if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;
          this.queue.add(() => this.executeSelectorCycle(context)).catch((error) => {
            this.emitEvent(
              "ERROR",
              null,
              `Scheduled selector retry failed: ${error instanceof Error ? error.message : String(error)}`,
              "orchestrator",
              context.cycleId,
            );
          });
        },
      },
    );

    if (await this.pauseIfRequested(context.cycleId)) return;
    if (!result.ok) {
      this.handleStepFailure("selector", context.cycleId, result);
      this.deps.bus.emit("research_phase_failed", {
        sessionId: this.sessionId,
        phase: "selector",
        cycleId: context.cycleId,
        error: result.errorMessage,
      });
      return;
    }

    this.clearAttentionRequired();
    this.deps.bus.emit("research_phase_complete", {
      sessionId: this.sessionId,
      phase: "selector",
      cycleId: context.cycleId,
      instrumentCount: result.value.length,
    });
    this.handleResolvedInstruments(result.value, context.label);
  }

  private async executeTradeCycle(context: TradeCycleContext): Promise<void> {
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;
    this.cycleContexts.set(context.cycleId, context);
    this.deps.logger.debug(
      { sessionId: this.sessionId, instrumentSymbol: context.instrument.symbol, instrumentClass: context.instrument.instrumentClass },
      "trade cycle start",
    );

    const config = this.getSessionConfig();
    const stats = this.deps.statsRepo.dashboardStats(
      this.sessionId,
      this.deps.sessionRepo.getStatus(this.sessionId),
      this.totalAllocatedUsd(),
      this.deps.sessionRepo.uptimeMin(this.sessionId),
      config.max_api_spend_usd,
    );
    const stepRunner = this.getStepRunner(context.cycleId);

    // Candidate validation: fetch fresh quote + run deterministic checks before AI pipeline
    const candidateResult = await stepRunner.run(
      "candidate_validation",
      async () => {
        const { adapter } = await this.deps.brokerRouting.resolveAdapter(this.sessionId, context.instrument.instrumentClass);
        const wireSymbol = this.deps.instrumentNormalizer.toBrokerSymbol({
          symbol: context.instrument.symbol,
          instrumentClass: context.instrument.instrumentClass,
          brokerType: adapter.brokerType,
        });
        const quoteSnapshot = await adapter.getMarketSnapshot(wireSymbol);
        const strategy = this.deps.strategyContextService.get(this.sessionId);
        const session = this.deps.sessionRepo.requireById(this.sessionId);
        const sessionInstrumentClasses = this.getEffectiveInstrumentClasses(session);
        const cvResult = new CandidateValidationService().validate({
          sessionId: this.sessionId,
          cycleId: context.cycleId,
          instrument: {
            symbol: context.instrument.symbol,
            instrumentClass: context.instrument.instrumentClass,
            selectorEvidence: context.instrument.selectorEvidence ?? null,
          },
          sessionInstrumentClasses,
          sideBias: strategy.rules.sideBias,
          holdingStyle: strategy.timeframe.holdingStyle,
          selectorTrace: context.instrument.selectorTraces ?? [],
          quoteSnapshot,
        });
        if (!cvResult.allowed) {
          throw new AppError(
            `Candidate validation failed: ${cvResult.reasons.join("; ")}`,
            "VALIDATION_FAILED",
          );
        }
        return quoteSnapshot;
      },
      { onRetry: () => this.enqueueTradeCycleRetry(context) },
    );
    if (await this.pauseIfRequested(context.cycleId)) return;
    if (!candidateResult.ok) {
      this.emitEvent("WARN", null, `[candidate-validation] ${context.instrument.symbol}: ${candidateResult.errorMessage}`, "orchestrator", context.cycleId);
      return;
    }
    const latestQuote = candidateResult.value;

    const pipeline = await this.runAiPipeline(context, config, stepRunner);
    if (!pipeline) return;
    if (await this.pauseIfRequested(context.cycleId)) return;

    const { technical, fundamental, review, decision } = pipeline;
    const totalAiCostUsd = sumAiPipelineCost(pipeline);

    if (!context.trade) {
      const trade = this.createTradeFromDecision(
        context.instrument,
        config,
        decision.output,
        totalAiCostUsd,
        review.output.recommendation,
      );
      this.deps.tradesRepo.insert(trade);
      for (const result of [technical, fundamental, review, decision]) {
        this.deps.agentRunsRepo.insert({ ...result.run, session_id: this.sessionId, trade_id: trade.id });
        this.deps.agentMessagesRepo.insert({ ...result.message, session_id: this.sessionId, trade_id: trade.id });
      }
      context.trade = trade;
    }

    const trade = context.trade;
    if (decision.output.action === "skip") {
      this.clearAttentionRequired();
      this.emitEvent("INFO", trade.id, `No trade decision for ${trade.instrumentSymbol}; cycle complete.`, "orchestrator", context.cycleId);
      return;
    }

    if (!context.riskOrder) {
      const riskConfig = this.deps.strategyContextService.get(this.sessionId).riskConfig;
      const riskResult = await stepRunner.run(
        "risk_gate",
        async () => {
          const risk = this.deps.riskEngine.validateDecision({
            config,
            stats,
            order: {
              instrumentSymbol: trade.instrumentSymbol,
              instrumentDisplayName: trade.instrumentDisplayName ?? null,
              predictionOutcome: trade.predictionOutcome ?? null,
              instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
              instrumentType: context.instrument.instrumentClass,
              side: trade.side,
              sizeUsd: trade.position_size_usd,
            },
            confidence: trade.confidence_score ?? 0,
            riskPolicy: {
              waitForOpenThreshold: riskConfig.waitForOpenThreshold,
              maxExposureUsd: context.instrument.instrumentClass === "prediction_market" ? riskConfig.maxExposureUsd : null,
            },
          });
          if (!risk.allowed || !risk.value) {
            throw new AppError(risk.reason ?? "Trade rejected by risk engine", "VALIDATION_FAILED");
          }
          return risk.value;
        },
        { onRetry: () => this.enqueueTradeCycleRetry(context) },
      );
      if (await this.pauseIfRequested(context.cycleId)) return;
      if (!riskResult.ok) {
        this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
        this.handleStepFailure("risk_gate", context.cycleId, riskResult, trade.id);
        return;
      }
      context.riskOrder = riskResult.value;
    }

    const brokerAccountId = this.resolveBrokerAccountId(context.instrument.instrumentClass);
    if (trade.brokerAccountId !== brokerAccountId) {
      this.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId });
    }

    const allocationResult = this.deps.brokerAllocationGate.checkOrderFits(
      brokerAccountId,
      this.sessionId,
      context.riskOrder.sizeUsd,
    );
    if (!allocationResult.ok) {
      this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
      this.emitEvent("WARN", trade.id, allocationResult.reason, "orchestrator", context.cycleId);
      this.deps.bus.emit("trade_closed", this.deps.tradesRepo.require(trade.id));
      return;
    }
    if (allocationResult.warning === "over_allocated") {
      this.emitEvent(
        "WARN",
        trade.id,
        "Order exceeds allocation (warn-only mode); proceeding.",
        "orchestrator",
        context.cycleId,
      );
    }

    const conflictResult = this.deps.brokerAllocationGate.checkInstrumentConflict(
      brokerAccountId,
      context.instrument.symbol,
      this.sessionId,
    );
    if (!conflictResult.ok) {
      this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
      this.emitEvent("WARN", trade.id, conflictResult.reason, "orchestrator", context.cycleId);
      this.deps.bus.emit("trade_closed", this.deps.tradesRepo.require(trade.id));
      return;
    }

    let approvalIdForCapital: string | null = null;
    if (config.human_approval_required) {
      const { approved, approvalId } = await this.waitForApproval(trade, context.instrument.instrumentClass, decision.output, undefined);
      approvalIdForCapital = approvalId;
      if (!approved) {
        this.deps.capitalReservation.releaseByApproval(approvalId);
        const rejected = this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
        this.emitEvent("WARN", trade.id, "Trade rejected by user", null, context.cycleId);
        this.deps.bus.emit("trade_closed", rejected);
        return;
      }
    }

    // No-approval path: reserve capital before touching the broker
    if (!config.human_approval_required) {
      this.deps.capitalReservation.reserveForOrder({
        sessionId: this.sessionId,
        tradeId: trade.id,
        amountUsd: trade.position_size_usd,
      });
    }

    const brokerResult = await stepRunner.run(
      "broker_order",
      async () => {
        const clientOrderId = `${context.cycleId}:${trade.id}`;
        const strategy = this.deps.strategyContextService.get(this.sessionId);
        const { adapter, brokerAccountId: resolvedBrokerAccountId } = await this.deps.brokerRouting.resolveAdapter(
          this.sessionId,
          context.instrument.instrumentClass,
        );

        // Fetch a fresh placement quote; fail closed if unavailable
        const wireSymbol = this.deps.instrumentNormalizer.toBrokerSymbol({
          symbol: context.instrument.symbol,
          instrumentClass: context.instrument.instrumentClass,
          brokerType: adapter.brokerType,
        });
        let placementQuote: { price: number; timestamp: string };
        try {
          const snap = await adapter.getMarketSnapshot(wireSymbol);
          placementQuote = { price: snap.price, timestamp: snap.timestamp };
        } catch (err) {
          throw new AppError(
            `Pre-placement quote fetch failed: ${err instanceof Error ? err.message : String(err)}`,
            "VALIDATION_FAILED",
          );
        }

        const brokerSupportsClass = adapter.supportedInstrumentClasses.includes(context.instrument.instrumentClass);
        const riskOrder = context.riskOrder;
        if (!riskOrder) {
          throw new AppError("Internal error: riskOrder missing at policy gate", "VALIDATION_FAILED");
        }
        const policyResult = new OrderPolicyGate().evaluate({
          sessionId: this.sessionId,
          cycleId: context.cycleId,
          tradeId: trade.id,
          brokerAccountId: resolvedBrokerAccountId,
          existingOrderCheck: (orderId, accountId) =>
            this.deps.tradesRepo.checkDuplicateClientOrder(accountId, orderId),
          sessionIsPaused: () => this.deps.bus.runtimeStatus(this.sessionId) !== "active",
          decisionRiskInput: {
            config,
            stats,
            order: riskOrder,
            confidence: trade.confidence_score ?? 0,
            quoteSnapshot: latestQuote ?? undefined,
            placementQuoteSnapshot: placementQuote,
            side: trade.side,
            exitPolicy: {
              stopLossPct: strategy.riskConfig.stopLossPct,
              atrStopMultiplier: strategy.riskConfig.atrStopMultiplier,
              takeProfitPct: strategy.riskConfig.takeProfitPct,
              maxHoldDays: strategy.timeframe.maxHoldDays,
            },
            strategyRules: { sideBias: strategy.rules.sideBias },
            brokerSupportsClass,
          },
        });
        if (!policyResult.allowed) {
          throw new AppError(policyResult.reason ?? "Order blocked by policy gate", "VALIDATION_FAILED");
        }

        // Persist clientOrderId on trade before placement for idempotency tracking
        this.deps.tradesRepo.patchPendingExecution(trade.id, { client_order_id: clientOrderId });

        const placed = await this.placeRoutedOrder(trade, context.instrument.instrumentClass, riskOrder, clientOrderId);
        if (!placed) {
          throw new AppError("Instrument conflict or broker routing blocked order placement.", "VALIDATION_FAILED");
        }
        return placed;
      },
      { onRetry: () => this.enqueueTradeCycleRetry(context) },
    );
    if (await this.pauseIfRequested(context.cycleId)) return;
    if (!brokerResult.ok) {
      if (!config.human_approval_required) {
        this.deps.capitalReservation.releaseOnFailure(trade.id);
      } else if (approvalIdForCapital) {
        this.deps.capitalReservation.releaseByApproval(approvalIdForCapital);
      }
      this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
      this.handleStepFailure("broker_order", context.cycleId, brokerResult, trade.id);
      this.deps.bus.emit("trade_closed", this.deps.tradesRepo.require(trade.id));
      return;
    }

    const opened = this.deps.tradesRepo.markOpen(trade.id, brokerResult.value.brokerOrderId, brokerResult.value.filledAvgPrice);
    if (approvalIdForCapital) {
      this.deps.capitalReservation.convertApprovalToOpenOrder(approvalIdForCapital, trade.id);
    }
    this.deps.capitalReservation.convertOrderToPosition(trade.id);
    this.clearAttentionRequired();
    this.emitEvent("INFO", trade.id, `Placed ${trade.side} ${trade.instrumentSymbol} $${trade.position_size_usd} via broker.`, "broker", context.cycleId);
    this.deps.bus.emit("trade_opened", opened);
    this.deps.sessionExecutionStepsRepo.upsert({
      sessionId: this.sessionId,
      cycleId: context.cycleId,
      stage: "monitoring",
      status: "succeeded",
      attempt: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      nextRetryAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      retryable: false,
    });
    this.emitEvent(
      "INFO",
      trade.id,
      `Trade opened ${trade.side} ${trade.instrumentSymbol}; session waiting for position to close before next cycle.`,
      "orchestrator",
      context.cycleId,
    );
  }

  private enqueueTradeCycleRetry(context: TradeCycleContext): void {
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;
    this.queue.add(() => this.executeTradeCycle(context)).catch((error) => {
      this.emitEvent(
        "ERROR",
        null,
        `Scheduled trade-step retry failed: ${error instanceof Error ? error.message : String(error)}`,
        "orchestrator",
        context.cycleId,
      );
    });
  }

  private getStepRunner(cycleId: string): ExecutionStepRunner {
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

  private handleStepFailure(
    stage: ExecutionStage,
    cycleId: string,
    result: Extract<StepResult<unknown>, { ok: false }>,
    tradeId: string | null = null,
  ): void {
    this.emitEvent("ERROR", tradeId, `${stage} failed: ${result.errorMessage}`, "orchestrator", cycleId);
    if (!result.retryable && stage !== "risk_gate" && stage !== "broker_order") {
      this.setSessionStatus("attention_required");
    }
  }

  private clearAttentionRequired(): void {
    if (this.deps.sessionRepo.getStatus(this.sessionId) === "attention_required") {
      this.setSessionStatus("active");
    }
  }

  private setSessionStatus(status: WorkspaceSession["status"]): void {
    const current = this.deps.sessionRepo.getStatus(this.sessionId);
    if (current === status) return;
    this.deps.sessionRepo.setStatus(status, this.sessionId);
    this.deps.bus.emit("session_status_changed", { sessionId: this.sessionId, status });
  }

  private async pauseIfRequested(cycleId: string): Promise<boolean> {
    if (!this.pauseAfterStep) return false;
    this.pauseAfterStep = false;
    this.queue.pause();
    this.clearNoInstrumentRetry();
    if (this.deps.bus.runtimeStatus(this.sessionId) === "active") {
      this.deps.bus.setRuntimeStatus(this.sessionId, "paused");
      this.setSessionStatus("paused");
    }
    this.emitEvent("INFO", null, "Paused after current step.", "orchestrator", cycleId);
    return true;
  }

  async runApprovalRecheck(input: ApprovalRecheckInput): Promise<void> {
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;

    const approval = this.deps.tradeApprovalsRepo.require(input.approvalId);
    const trade = this.deps.tradesRepo.require(approval.tradeId);
    if (trade.status !== "pending") return;

    const config = this.getSessionConfig();
    const stats = this.deps.statsRepo.dashboardStats(
      this.sessionId,
      this.deps.sessionRepo.getStatus(this.sessionId),
      this.totalAllocatedUsd(),
      this.deps.sessionRepo.uptimeMin(this.sessionId),
      config.max_api_spend_usd,
    );

    const cycleId = crypto.randomUUID();
    const context: TradeCycleContext = {
      kind: "trade",
      cycleId,
      instrument: {
        symbol: trade.instrumentSymbol,
        instrumentClass: trade.instrumentType,
        instrumentDisplayName: trade.instrumentDisplayName ?? undefined,
        predictionOutcome: trade.predictionOutcome ?? null,
        instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      },
    };
    this.cycleContexts.set(cycleId, context);
    const pipeline = await this.runAiPipeline(context, config, this.getStepRunner(cycleId));
    if (!pipeline) return;

    const { technical, fundamental, review, decision } = pipeline;
    const totalAiCostUsd = sumAiPipelineCost(pipeline);

    for (const result of [technical, fundamental, review, decision]) {
      this.deps.agentRunsRepo.insert({ ...result.run, session_id: this.sessionId, trade_id: trade.id });
      this.deps.agentMessagesRepo.insert({ ...result.message, session_id: this.sessionId, trade_id: trade.id });
    }
    this.deps.tradesRepo.patchAiCost(trade.id, totalAiCostUsd);

    const fresh = decision.output;
    if (fresh.action === "skip") {
      this.failRecheck(trade.id, approval.id, "Fresh decision is skip; not placing order.");
      return;
    }

    const nextTrade = this.buildTradeFromDecision(
      trade.id,
      {
        symbol: trade.instrumentSymbol,
        instrumentClass: trade.instrumentType,
        instrumentDisplayName: trade.instrumentDisplayName ?? undefined,
        predictionOutcome: trade.predictionOutcome ?? null,
        instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      },
      config,
      fresh,
      totalAiCostUsd,
      review.output.recommendation,
    );
    this.deps.tradesRepo.patchPendingExecution(trade.id, {
      side: nextTrade.side,
      entry_price: nextTrade.entry_price,
      position_size_usd: nextTrade.position_size_usd,
      stop_loss_price: nextTrade.stop_loss_price,
      take_profit_price: nextTrade.take_profit_price,
      execution_strategy: nextTrade.execution_strategy,
      confidence_score: nextTrade.confidence_score,
      brokerAccountId: nextTrade.brokerAccountId,
    });
    const updated = this.deps.tradesRepo.require(trade.id);

    const riskConfig = this.deps.strategyContextService.get(this.sessionId).riskConfig;
    const risk = this.deps.riskEngine.validateDecision({
      config,
      stats,
      order: {
        instrumentSymbol: updated.instrumentSymbol,
        instrumentDisplayName: updated.instrumentDisplayName ?? null,
        predictionOutcome: updated.predictionOutcome ?? null,
        instrumentMetadataJson: updated.instrumentMetadataJson ?? null,
        instrumentType: input.instrumentClass,
        side: updated.side,
        sizeUsd: updated.position_size_usd,
      },
      confidence: updated.confidence_score ?? 0,
      riskPolicy: {
        waitForOpenThreshold: riskConfig.waitForOpenThreshold,
        maxExposureUsd: input.instrumentClass === "prediction_market" ? riskConfig.maxExposureUsd : null,
      },
    });

    if (!risk.allowed || !risk.value) {
      this.failRecheck(trade.id, approval.id, risk.reason ?? "Fresh risk check rejected the trade.");
      return;
    }

    this.deps.capitalReservation.updateReservedAmountForApproval(approval.id, risk.value.sizeUsd);

    const recheckBrokerAccountId = updated.brokerAccountId ?? this.resolveBrokerAccountId(input.instrumentClass);
    if (updated.brokerAccountId !== recheckBrokerAccountId) {
      this.deps.tradesRepo.patchPendingExecution(updated.id, { brokerAccountId: recheckBrokerAccountId });
    }
    const recheckAllocation = this.deps.brokerAllocationGate.checkOrderFits(
      recheckBrokerAccountId,
      this.sessionId,
      risk.value.sizeUsd,
    );
    if (!recheckAllocation.ok) {
      this.failRecheck(trade.id, approval.id, recheckAllocation.reason);
      return;
    }
    if (recheckAllocation.warning === "over_allocated") {
      this.emitEvent("WARN", trade.id, "Order exceeds allocation (warn-only mode); proceeding.", "orchestrator", cycleId);
    }
    const recheckConflict = this.deps.brokerAllocationGate.checkInstrumentConflict(
      recheckBrokerAccountId,
      updated.instrumentSymbol,
      this.sessionId,
    );
    if (!recheckConflict.ok) {
      this.failRecheck(trade.id, approval.id, recheckConflict.reason);
      return;
    }

    // CRITICAL: re-run the same final policy gate that intake uses, so a stale
    // approval cannot bypass duplicate-order / capital / broker-class checks.
    // Bind to the approval's recorded routing context (brokerAccountId).
    const recheckClientOrderId = `${cycleId}:${trade.id}`;
    const strategy = this.deps.strategyContextService.get(this.sessionId);
    const recheckPolicy = new OrderPolicyGate().evaluate({
      sessionId: this.sessionId,
      cycleId,
      tradeId: trade.id,
      brokerAccountId: recheckBrokerAccountId,
      existingOrderCheck: (orderId, accountId) =>
        this.deps.tradesRepo.checkDuplicateClientOrder(accountId, orderId),
      sessionIsPaused: () => this.deps.bus.runtimeStatus(this.sessionId) !== "active",
      decisionRiskInput: {
        config,
        stats,
        order: risk.value,
        confidence: updated.confidence_score ?? 0,
        side: updated.side,
        exitPolicy: {
          stopLossPct: strategy.riskConfig.stopLossPct,
          atrStopMultiplier: strategy.riskConfig.atrStopMultiplier,
          takeProfitPct: strategy.riskConfig.takeProfitPct,
          maxHoldDays: strategy.timeframe.maxHoldDays,
        },
        strategyRules: { sideBias: strategy.rules.sideBias },
        brokerSupportsClass: true,
      },
    });
    if (!recheckPolicy.allowed) {
      this.failRecheck(trade.id, approval.id, recheckPolicy.reason ?? "Approval recheck blocked by policy gate.");
      return;
    }

    const placed = await this.placeRoutedOrder(updated, input.instrumentClass, risk.value, recheckClientOrderId);
    if (!placed) {
      this.failRecheck(trade.id, approval.id, "Instrument conflict or broker routing blocked order placement.");
      return;
    }
    const opened = this.deps.tradesRepo.markOpen(trade.id, placed.brokerOrderId, placed.filledAvgPrice);
    this.deps.capitalReservation.convertApprovalToOpenOrder(approval.id, trade.id);
    this.deps.capitalReservation.convertOrderToPosition(trade.id);
    this.emitEvent("INFO", trade.id, `Placed ${updated.side} ${updated.instrumentSymbol} $${updated.position_size_usd} via broker (post-approval recheck).`, "broker");
    this.deps.bus.emit("trade_opened", opened);
    this.emitEvent(
      "INFO",
      trade.id,
      `Trade opened ${updated.side} ${updated.instrumentSymbol}; session waiting for position to close before next cycle.`,
      "orchestrator",
    );
  }

  private failRecheck(tradeId: string, approvalId: string, message: string): void {
    this.deps.capitalReservation.releaseByApproval(approvalId);
    const rejected = this.deps.tradesRepo.updateStatus(tradeId, "rejected", 0);
    this.emitEvent("WARN", tradeId, message);
    this.deps.bus.emit("trade_closed", rejected);
  }

  hasApprovalCallback(tradeId: string): boolean {
    return this.approvalCallbacks.has(tradeId);
  }

  resolveApproval(tradeId: string, approved: boolean): boolean {
    const resolve = this.approvalCallbacks.get(tradeId);
    if (!resolve) return false;

    this.approvalCallbacks.delete(tradeId);
    resolve(approved);
    return true;
  }

  private async runTradeCycle(instrument: ResolvedInstrument): Promise<void> {
    await this.executeTradeCycle({ kind: "trade", cycleId: crypto.randomUUID(), instrument });
  }

  private async placeRoutedOrder(
    trade: Trade,
    instrumentClass: InstrumentClass,
    riskOrder: OrderRequest,
    clientOrderId: string,
  ): Promise<{ brokerOrderId: string; filledAvgPrice: number } | null> {
    const { adapter, brokerAccountId } = await this.deps.brokerRouting.resolveAdapter(this.sessionId, instrumentClass);
    this.deps.logger.debug(
      { sessionId: this.sessionId, tradeId: trade.id, brokerAccountId, instrumentClass, brokerType: adapter.brokerType },
      "resolved broker adapter",
    );

    if (this.deps.tradesRepo.checkInstrumentConflict(brokerAccountId, trade.instrumentSymbol, this.sessionId)) {
      return null;
    }

    const wireSymbol = this.deps.instrumentNormalizer.toBrokerSymbol({
      symbol: trade.instrumentSymbol,
      instrumentClass,
      brokerType: adapter.brokerType,
    });

    const result = await adapter.placeOrder({
      instrumentSymbol: wireSymbol,
      instrumentDisplayName: trade.instrumentDisplayName ?? null,
      predictionOutcome: trade.predictionOutcome ?? null,
      instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      instrumentType: instrumentClass,
      side: riskOrder.side,
      sizeUsd: riskOrder.sizeUsd,
      clientOrderId,
    });

    if (trade.brokerAccountId !== brokerAccountId) {
      this.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId });
    }

    this.deps.logger.info(
      {
        sessionId: this.sessionId,
        tradeId: trade.id,
        brokerAccountId,
        brokerOrderIdLength: result.brokerOrderId.length,
        filledAvgPrice: result.filledAvgPrice,
      },
      "broker order placed",
    );

    return { brokerOrderId: result.brokerOrderId, filledAvgPrice: result.filledAvgPrice };
  }

  private async runAiPipeline(
    context: TradeCycleContext,
    config: SessionConfig,
    stepRunner: ExecutionStepRunner,
  ): Promise<AiPipelineResult | null> {
    const instrument = context.instrument;
    this.deps.logger.debug(
      { sessionId: this.sessionId, instrumentSymbol: instrument.symbol, instrumentClass: instrument.instrumentClass },
      "ai pipeline start",
    );
    if (!context.technical) {
      const technical = await stepRunner.run(
        "technical",
        async () => {
          const result = await this.deps.ai.runPhase<{ instrumentSymbol: string; selectorEvidence?: SelectorEvidence | null }, TechnicalSignal>(
            "technical",
            this.sessionId,
            { instrumentSymbol: instrument.symbol, selectorEvidence: instrument.selectorEvidence ?? null },
            context.cycleId,
          );
          if (!result.output.symbol) {
            throw new AppError("Technical phase returned no signal.", "VALIDATION_FAILED");
          }
          return result;
        },
        { onRetry: () => this.enqueueTradeCycleRetry(context) },
      );
      if (!technical.ok) {
        this.handleStepFailure("technical", context.cycleId, technical);
        return null;
      }
      context.technical = technical.value;
    }
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    if (!context.fundamental) {
      const fundamental = await stepRunner.run(
        "fundamental",
        async () => {
          const result = await this.deps.ai.runPhase<{ instrumentSymbol: string; selectorEvidence?: SelectorEvidence | null }, FundamentalSignal>(
            "fundamental",
            this.sessionId,
            { instrumentSymbol: instrument.symbol, selectorEvidence: instrument.selectorEvidence ?? null },
            context.cycleId,
          );
          if (!result.output.symbol) {
            throw new AppError("Fundamental phase returned no signal.", "VALIDATION_FAILED");
          }
          return result;
        },
        { onRetry: () => this.enqueueTradeCycleRetry(context) },
      );
      if (!fundamental.ok) {
        this.handleStepFailure("fundamental", context.cycleId, fundamental);
        return null;
      }
      context.fundamental = fundamental.value;
    }
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    if (!context.review) {
      const technical = context.technical;
      const fundamental = context.fundamental;
      if (!technical || !fundamental) {
        throw new AppError("Internal error: analyses missing at review step", "VALIDATION_FAILED");
      }
      const review = await stepRunner.run(
        "review",
        async () => {
          const result = await this.deps.ai.runPhase<
            { instrumentSymbol: string; technical: TechnicalSignal; fundamental: FundamentalSignal },
            ReviewSignal
          >(
            "review",
            this.sessionId,
            {
              instrumentSymbol: instrument.symbol,
              technical: technical.output,
              fundamental: fundamental.output,
            },
            context.cycleId,
          );
          if (!result.output.symbol) {
            throw new AppError("Review phase returned no signal.", "VALIDATION_FAILED");
          }
          return result;
        },
        { onRetry: () => this.enqueueTradeCycleRetry(context) },
      );
      if (!review.ok) {
        this.handleStepFailure("review", context.cycleId, review);
        return null;
      }
      context.review = review.value;
    }
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    if (!context.decision) {
      const technical = context.technical;
      const fundamental = context.fundamental;
      const review = context.review;
      if (!technical || !fundamental || !review) {
        throw new AppError("Internal error: analyses missing at decision step", "VALIDATION_FAILED");
      }
      const decision = await stepRunner.run(
        "decision",
        () =>
          this.deps.ai.runPhase<
            { instrumentSymbol: string; technical: TechnicalSignal; fundamental: FundamentalSignal; review: ReviewSignal },
            TradeSignal
          >(
            "decision",
            this.sessionId,
            {
              instrumentSymbol: instrument.symbol,
              technical: technical.output,
              fundamental: fundamental.output,
              review: review.output,
            },
            context.cycleId,
          ),
        { onRetry: () => this.enqueueTradeCycleRetry(context) },
      );
      if (!decision.ok) {
        this.handleStepFailure("decision", context.cycleId, decision);
        return null;
      }
      context.decision = decision.value;
    }
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    this.deps.logger.debug(
      {
        sessionId: this.sessionId,
        instrumentSymbol: instrument.symbol,
        decisionAction: context.decision.output.action,
        confidence: context.decision.output.confidence,
      },
      "ai pipeline complete",
    );

    return {
      technical: context.technical,
      fundamental: context.fundamental,
      review: context.review,
      decision: context.decision,
    };
  }

  private waitForApproval(
    trade: Trade,
    instrumentClass: InstrumentClass,
    decisionOut: TradeSignal,
    riskNote: string | undefined,
  ): Promise<{ approved: boolean; approvalId: string }> {
    const resolvedBroker = trade.brokerAccountId ?? this.resolveBrokerAccountId(instrumentClass);
    if (trade.brokerAccountId == null) {
      this.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId: resolvedBroker });
    }

    const sessionStrategy = this.deps.strategyContextService.get(this.sessionId).timeframe;
    const approval = this.deps.tradeApprovalsRepo.createPending({
      sessionId: this.sessionId,
      tradeId: trade.id,
      brokerAccountId: resolvedBroker,
      instrumentSymbol: trade.instrumentSymbol,
      instrumentDisplayName: trade.instrumentDisplayName ?? null,
      predictionOutcome: trade.predictionOutcome ?? null,
      instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      instrumentClass,
      proposedSide: trade.side,
      proposedSizeUsd: trade.position_size_usd,
      decisionSummaryJson: JSON.stringify({
        confidence: trade.confidence_score,
        reasoning: decisionOut.reasoning,
        riskNote: riskNote ?? null,
        sessionHorizon: {
          primaryTradingTimeframe: sessionStrategy.primaryTradingTimeframe,
          holdingStyle: sessionStrategy.holdingStyle,
          targetHoldDays: sessionStrategy.targetHoldDays,
          maxHoldDays: sessionStrategy.maxHoldDays,
          timeframeNotes: sessionStrategy.timeframeNotes.trim() || undefined,
        },
      }),
    });

    this.deps.capitalReservation.reserveForApproval({
      sessionId: this.sessionId,
      approvalId: approval.id,
      amountUsd: trade.position_size_usd,
    });

    this.deps.bus.emit("approval_required", {
      trade_id: trade.id,
      approval_id: approval.id,
      session_id: this.sessionId,
      instrumentSymbol: trade.instrumentSymbol,
      instrumentDisplayName: trade.instrumentDisplayName ?? undefined,
      predictionOutcome: trade.predictionOutcome ?? null,
      instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      side: trade.side,
      size_usd: trade.position_size_usd,
      confidence: trade.confidence_score ?? 0,
      reasoning: decisionOut.reasoning,
    });

    this.pendingApprovalIds.set(trade.id, approval.id);

    return new Promise((resolve) => {
      this.approvalCallbacks.set(trade.id, (approved) => {
        this.approvalCallbacks.delete(trade.id);
        this.pendingApprovalIds.delete(trade.id);
        resolve({ approved, approvalId: approval.id });
      });
    });
  }

  private resolveBrokerAccountId(instrumentClass: InstrumentClass): string {
    return this.deps.brokerRouting.resolveBrokerAccountId(this.sessionId, instrumentClass);
  }

  private executionFieldsForSignal(
    signal: TradeSignal,
    instrumentClass: InstrumentClass,
    config: SessionConfig,
    reviewRecommendation?: ReviewSignal["recommendation"],
  ): {
    position_size_usd: number;
    side: Trade["side"];
    entry_price: number | null;
    stop_loss_price: number | null;
    take_profit_price: number | null;
    execution_strategy: string | null;
  } {
    if (signal.action === "skip") {
      return {
        position_size_usd: 0,
        side: "BUY",
        entry_price: null,
        stop_loss_price: null,
        take_profit_price: null,
        execution_strategy: signal.executionStrategy,
      };
    }

    const strategyCtx = this.deps.strategyContextService.get(this.sessionId);
    const profile = computeExecutionProfile({
      signal,
      instrumentClass,
      maxPositionUsd: config.max_position_usd,
      maxExposureUsd: strategyCtx.riskConfig.maxExposureUsd ?? null,
      risk: {
        stopLossPct: strategyCtx.riskConfig.stopLossPct,
        takeProfitPct: strategyCtx.riskConfig.takeProfitPct,
        kellyFraction: strategyCtx.riskConfig.kellyFraction,
      },
      reviewRecommendation,
    });

    const entry_price = profile.limitPrice;
    const levels =
      entry_price != null
        ? priceLevelsFromProfile(profile.side, entry_price, profile)
        : { stopLossPrice: null, takeProfitPrice: null };

    return {
      position_size_usd: profile.positionSizeUsd,
      side: profile.side,
      entry_price,
      stop_loss_price: levels.stopLossPrice,
      take_profit_price: levels.takeProfitPrice,
      execution_strategy: signal.executionStrategy,
    };
  }

  /** Fresh sizing for an existing pending trade after a recheck decision. */
  private buildTradeFromDecision(
    tradeId: string,
    instrument: ResolvedInstrument,
    config: SessionConfig,
    signal: TradeSignal,
    aiCostUsd: number,
    reviewRecommendation?: ReviewSignal["recommendation"],
  ): Trade {
    const brokerAccountId = this.resolveBrokerAccountId(instrument.instrumentClass);
    const prediction = this.resolvePredictionTradeFields(instrument);
    const execution = this.executionFieldsForSignal(signal, instrument.instrumentClass, config, reviewRecommendation);
    return {
      id: tradeId,
      sessionId: this.sessionId,
      brokerAccountId,
      instrumentSymbol: signal.symbol,
      instrumentDisplayName: prediction.instrumentDisplayName,
      predictionOutcome: prediction.predictionOutcome,
      instrumentMetadataJson: prediction.instrumentMetadataJson,
      instrumentType: instrument.instrumentClass,
      side: execution.side,
      entry_price: execution.entry_price,
      position_size_usd: execution.position_size_usd,
      stop_loss_price: execution.stop_loss_price,
      take_profit_price: execution.take_profit_price,
      strategy: config.strategy,
      execution_strategy: execution.execution_strategy,
      status: "pending",
      opened_at: null,
      closed_at: null,
      final_pnl_usd: null,
      ai_cost_usd: aiCostUsd,
      confidence_score: signal.confidence,
      broker_order_id: null,
      high_water_mark_price: null,
      exit_reason: null,
      created_at: new Date().toISOString(),
    };
  }

  private createTradeFromDecision(
    instrument: ResolvedInstrument,
    config: SessionConfig,
    signal: TradeSignal,
    aiCostUsd: number,
    reviewRecommendation?: ReviewSignal["recommendation"],
  ): Trade {
    const id = crypto.randomUUID();
    const brokerAccountId = this.resolveBrokerAccountId(instrument.instrumentClass);
    const isTrade = signal.action !== "skip";
    const prediction = this.resolvePredictionTradeFields(instrument);
    const execution = this.executionFieldsForSignal(
      signal,
      instrument.instrumentClass,
      config,
      isTrade ? reviewRecommendation : undefined,
    );
    return {
      id,
      sessionId: this.sessionId,
      brokerAccountId,
      instrumentSymbol: signal.symbol,
      instrumentDisplayName: prediction.instrumentDisplayName,
      predictionOutcome: prediction.predictionOutcome,
      instrumentMetadataJson: prediction.instrumentMetadataJson,
      instrumentType: instrument.instrumentClass,
      side: execution.side,
      entry_price: execution.entry_price,
      position_size_usd: execution.position_size_usd,
      stop_loss_price: execution.stop_loss_price,
      take_profit_price: execution.take_profit_price,
      strategy: config.strategy,
      execution_strategy: execution.execution_strategy,
      status: isTrade ? "pending" : "rejected",
      opened_at: null,
      closed_at: isTrade ? null : new Date().toISOString(),
      final_pnl_usd: isTrade ? null : 0,
      ai_cost_usd: aiCostUsd,
      confidence_score: signal.confidence,
      broker_order_id: null,
      high_water_mark_price: null,
      exit_reason: null,
      created_at: new Date().toISOString(),
    };
  }

  private emitAbort(): null {
    this.emitEvent("INFO", null, "Cycle aborted: session paused mid-flight.", "orchestrator");
    return null;
  }

  private attachTradeClosedListener(): void {
    if (this.unsubscribeTradeClosed) return;
    this.unsubscribeTradeClosed = this.deps.bus.on("trade_closed", (trade) => {
      if (trade.sessionId !== this.sessionId || trade.status !== "closed") return;
      if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;
      if (this.cycleRestartInFlight) return;
      this.cycleRestartInFlight = true;
      this.emitEvent("INFO", trade.id, "Trade closed; session restarting research cycle.", "orchestrator");
      this.queue
        .add(() => this.executeSelectorCycle({ kind: "selector", cycleId: crypto.randomUUID(), label: "Trade-closed research cycle complete" }))
        .catch((error) => {
          this.emitEvent(
            "ERROR",
            null,
            `Trade-closed cycle restart failed: ${error instanceof Error ? error.message : String(error)}`,
            "orchestrator",
          );
        })
        .finally(() => {
          this.cycleRestartInFlight = false;
        });
    });
  }

  private detachTradeClosedListener(): void {
    this.unsubscribeTradeClosed?.();
    this.unsubscribeTradeClosed = null;
  }

  private enqueueTradeCycles(instruments: ResolvedInstrument[]): void {
    this.deps.logger.info({ sessionId: this.sessionId, instrumentCount: instruments.length }, "enqueueing trade cycles");
    for (const instrument of instruments) {
      this.queue.add(() => this.runTradeCycle(instrument)).catch((error) => {
        this.emitEvent(
          "ERROR",
          null,
          `Trade cycle failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  private handleResolvedInstruments(instruments: ResolvedInstrument[], context: string): void {
    if (instruments.length === 0) {
      const retryMinutes = this.getNoInstrumentRetryMinutes();
      const retryMs = retryMinutes * 60 * 1000;
      this.emitEvent(
        "INFO",
        null,
        `${context}; no tradable instruments were selected. Re-evaluating in ${formatMinutesLabel(retryMinutes)}.`,
        "orchestrator",
      );
      this.scheduleNoInstrumentRetry(retryMs);
      return;
    }
    this.clearNoInstrumentRetry();
    this.emitEvent("INFO", null, `${context}; ${instruments.length} cycles enqueued.`, "orchestrator");
    this.enqueueTradeCycles(instruments);
  }

  private scheduleNoInstrumentRetry(retryMs: number): void {
    if (this.noInstrumentRetryTimer) return;
    this.noInstrumentRetryTimer = setTimeout(() => {
      this.noInstrumentRetryTimer = null;
      if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;
      this.queue
        .add(() => this.executeSelectorCycle({ kind: "selector", cycleId: crypto.randomUUID(), label: "Scheduled selector retry complete" }))
        .catch((error) => {
          this.emitEvent(
            "ERROR",
            null,
            `Scheduled selector retry failed: ${error instanceof Error ? error.message : String(error)}`,
            "orchestrator",
          );
        });
    }, retryMs);
  }

  private clearNoInstrumentRetry(): void {
    if (!this.noInstrumentRetryTimer) return;
    clearTimeout(this.noInstrumentRetryTimer);
    this.noInstrumentRetryTimer = null;
  }

  // Exposed for ResearchBurstService integration.
  async resolveInstrumentsForBurst(session: WorkspaceSession, config: SessionConfig, cycleId?: string): Promise<ResolvedInstrument[]> {
    return this.resolveInstruments(session, config, cycleId);
  }

  private async runResearchBurst(session: WorkspaceSession, config: SessionConfig, cycleId?: string): Promise<ResolvedInstrument[]> {
    const burst = new ResearchBurstService(this);
    return burst.resolve(session, config, cycleId);
  }

  private emitEvent(
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

  private async resolveInstruments(
    session: WorkspaceSession,
    config: SessionConfig,
    cycleId?: string,
  ): Promise<ResolvedInstrument[]> {
    const activeCycleId = cycleId ?? crypto.randomUUID();
    const selectorSettings = this.deps.sessionSelectorSettingsRepo.get(session.id);
    const fingerprint = buildSelectorDefinitionFingerprint(session, this.deps);
    const definitionHash = hashSelectorDefinition(fingerprint);

    const cached = this.deps.instrumentCacheRepo.get(session.id);
    if (cached) {
      const expired = cached.expiresAt && new Date(cached.expiresAt) < new Date();
      if (expired) {
        this.deps.instrumentCacheRepo.clear(session.id);
      } else if (cached.definitionHash === definitionHash) {
        const parsed = JSON.parse(cached.instruments) as ResolvedInstrument[];
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new AppError("Cached instrument list is invalid or empty.", "VALIDATION_FAILED");
        }
        return parsed;
      }
    }

    if (session.selectionMode === "manual_shortlist" || !selectorSettings.aiPickerEnabled) {
      return this.parseManualShortlist(session, config);
    }

    this.emitEvent("INFO", null, "[stage:selector] starting discovery and verification workers", "orchestrator", activeCycleId);
    this.deps.bus.emit("research_phase_step", {
      sessionId: this.sessionId,
      phase: "selector",
      cycleId: activeCycleId,
      message: "[stage:selector] starting workers",
    });
    const selectionInstructions = await this.buildSelectionInstructions(session);
    const result = await this.deps.ai.runPhase<{ selectionInstructions: string }, import("@/lib/schemas").InstrumentSelection>(
      "selector",
      session.id,
      { selectionInstructions },
      activeCycleId,
    );

    const sessionInstrumentClasses = this.getEffectiveInstrumentClasses(session);
    const filtered = result.output.instruments
      .filter((row) => sessionInstrumentClasses.includes(row.instrumentClass))
      .map((row) => ({
        symbol: row.symbol,
        instrumentClass: row.instrumentClass,
        instrumentDisplayName: row.instrumentDisplayName,
        predictionOutcome: row.predictionOutcome ?? null,
        instrumentMetadataJson: row.instrumentMetadataJson ?? null,
        selectorEvidence: row.selectorEvidence ?? null,
      } satisfies ResolvedInstrument));

    const limited = filtered.slice(0, config.max_concurrent_trades);
    const payload: ResolvedInstrument[] = limited.map((row: ResolvedInstrument) => ({ ...row }));

    this.deps.agentRunsRepo.insert({
      ...result.run,
      session_id: this.sessionId,
      trade_id: null,
    });
    this.deps.agentMessagesRepo.insert({
      ...result.message,
      session_id: this.sessionId,
      trade_id: null,
    });

    if (payload.length === 0) {
      return [];
    }

    const cacheTtlMs = instrumentCacheTtlMs(this.deps.strategyContextService.get(this.sessionId).timeframe.holdingStyle);
    this.deps.instrumentCacheRepo.save({
      sessionId: session.id,
      instruments: JSON.stringify(payload),
      definitionHash,
      selectedAt: new Date().toISOString(),
      selectorAgentRunId: result.run.id,
      cycleId: activeCycleId,
      researchBriefsJson: JSON.stringify(Object.fromEntries(payload.map((row) => [row.symbol, row.selectorEvidence?.summary ?? ""]))),
      researchGeneratedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + cacheTtlMs).toISOString(),
    });

    this.emitEvent(
      "INFO",
      null,
      `[stage:selector] submission count=${payload.length}`,
      "orchestrator",
      activeCycleId,
    );
    this.deps.bus.emit("research_phase_step", {
      sessionId: this.sessionId,
      phase: "selector",
      cycleId: activeCycleId,
      message: `Selector chose ${payload.length} instruments`,
    });
    return payload;
  }

  private parseManualShortlist(session: WorkspaceSession, config: SessionConfig): ResolvedInstrument[] {
    const symbols = session.instrumentScope
      .split(/[\n,]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const out: ResolvedInstrument[] = [];
    for (const line of symbols) {
      const parsed = this.parseManualInstrumentLine(line, session.instrumentClasses);
      const instrumentClass = parsed.instrumentClass;
      if (!session.instrumentClasses.includes(instrumentClass)) continue;
      out.push(parsed);
    }
    if (out.length === 0) {
      throw new AppError("Manual instrument shortlist is empty after parsing.", "VALIDATION_FAILED");
    }
    return out.slice(0, config.max_concurrent_trades);
  }

  private inferInstrumentClass(symbol: string, classes: InstrumentClass[]): InstrumentClass {
    if (classes.length === 1) return classes[0] ?? "stock";
    const upper = symbol.toUpperCase();
    if (classes.includes("crypto") && upper.includes("-")) return "crypto";
    if (classes.includes("futures") && /^[A-Z]{2,4}[FGHJKMNQUVXZ]\d{1,2}$/i.test(upper)) return "futures";
    if (classes.includes("prediction_market") && symbol.startsWith("pm:")) return "prediction_market";
    if (classes.includes("stock")) return "stock";
    return classes[0] ?? "stock";
  }

  private parseManualInstrumentLine(line: string, classes: InstrumentClass[]): ResolvedInstrument {
    if (line.startsWith("{")) {
      const parsed = JSON.parse(line) as ResolvedInstrument;
      return {
        symbol: parsed.symbol,
        instrumentClass: parsed.instrumentClass,
        instrumentDisplayName: parsed.instrumentDisplayName,
        predictionOutcome: parsed.predictionOutcome ?? null,
        instrumentMetadataJson: parsed.instrumentMetadataJson ?? null,
      };
    }
    const symbol = line.startsWith("pm:") ? line : line.toUpperCase();
    return {
      symbol,
      instrumentClass: this.inferInstrumentClass(symbol, classes),
    };
  }

  private getSessionConfig(): SessionConfig {
    return toLegacySessionConfig(this.deps.strategyContextService.get(this.sessionId));
  }

  private getNoInstrumentRetryMinutes(): number {
    const settings = this.deps.sessionSelectorSettingsRepo.get(this.sessionId);
    const configured = settings.noInstrumentRetryMinutes;
    return typeof configured === "number" &&
      Number.isInteger(configured) &&
      configured >= SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN &&
      configured <= SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX
      ? configured
      : DEFAULT_SELECTOR_NO_INSTRUMENT_RETRY_MINUTES;
  }

  private resolvePredictionTradeFields(
    instrument: ResolvedInstrument,
  ): Pick<Trade, "instrumentDisplayName" | "predictionOutcome" | "instrumentMetadataJson"> {
    const instrumentDisplayName = instrument.instrumentDisplayName ?? null;
    const predictionOutcome = instrument.predictionOutcome ?? null;
    const instrumentMetadataJson =
      instrument.instrumentClass === "prediction_market"
        ? remapPredictionMetadataForOutcome(instrument.instrumentMetadataJson ?? null, predictionOutcome)
        : instrument.instrumentMetadataJson ?? null;

    return { instrumentDisplayName, predictionOutcome, instrumentMetadataJson };
  }

  private totalAllocatedUsd(): number {
    return this.deps.sessionBrokerAssignmentsRepo
      .listAssignments(this.sessionId)
      .reduce((sum, assignment) => sum + assignment.allocatedUsd, 0);
  }

  private async buildSelectionInstructions(session: WorkspaceSession): Promise<string> {
    const instrumentClasses = this.getEffectiveInstrumentClasses(session);
    const brokerCoverage = this.renderBrokerCoverageInstructions(session, instrumentClasses);

    if (this.isSearchEverythingScope(session)) {
      const sections = [
        [
          "Selector mode: full-universe discovery.",
          `Search across the full tradable universe for these broker-backed classes: ${instrumentClasses.join(", ")}.`,
          "Start broad, enumerate all serious candidate instruments you discover, and then research each candidate online before you rank it.",
          "Use live discovery/search evidence for every candidate you keep. Do not rely on memory-only ticker recall.",
          "Verify tradability with the market tools before submitting a candidate. Exclude anything that has no broker coverage or cannot be verified.",
          "Return ranked candidates through the selector pipeline output. Strongest setups first, up to the configured maximum.",
        ].join("\n"),
        brokerCoverage,
      ];

      const predictionCandidates = await this.renderPredictionMarketCandidatesInstructions(session, instrumentClasses);
      if (predictionCandidates) sections.push(predictionCandidates);

      return sections.filter(Boolean).join("\n\n");
    }

    const sections = [session.instrumentScope, brokerCoverage];
    const predictionCandidates = await this.renderPredictionMarketCandidatesInstructions(session, instrumentClasses);
    if (predictionCandidates) sections.push(predictionCandidates);
    return sections.filter(Boolean).join("\n\n");
  }

  private isSearchEverythingScope(session: WorkspaceSession): boolean {
    return session.instrumentScope.trim() === SEARCH_EVERYTHING_SCOPE;
  }

  private renderBrokerCoverageInstructions(session: WorkspaceSession, instrumentClasses: InstrumentClass[]): string {
    const assignedBrokerIds = this.deps.sessionBrokerAssignmentsRepo.listBrokerAccountIds(session.id);
    const assignedBrokers = assignedBrokerIds
      .map((brokerAccountId) => this.deps.brokerAccountsRepo.find(brokerAccountId))
      .filter((broker): broker is NonNullable<typeof broker> => Boolean(broker));

    const lines = ["Broker coverage constraints:"];

    if (assignedBrokers.length === 0) {
      lines.push("- No broker accounts are assigned to this session. Do not assume any instrument is tradable.");
      return lines.join("\n");
    }

    lines.push("- Assigned brokers:");
    for (const broker of assignedBrokers) {
      lines.push(`  - ${broker.name} (${broker.id}) supports: ${broker.supportedInstrumentClasses.join(", ")}`);
    }

    lines.push("- Enabled class coverage:");
    for (const instrumentClass of instrumentClasses) {
      const coveringBrokers = assignedBrokers.filter((broker) => broker.supportedInstrumentClasses.includes(instrumentClass));
      if (coveringBrokers.length === 0) {
        lines.push(`  - ${instrumentClass}: NO broker coverage. Do not return candidates for this class.`);
        continue;
      }
      lines.push(`  - ${instrumentClass}: tradable via ${coveringBrokers.map((broker) => `${broker.name} (${broker.id})`).join(", ")}`);
    }

    lines.push("- If get_quote/get_news/get_ohlcv cannot verify an instrument, treat it as not tradable enough for this session and exclude it.");
    return lines.join("\n");
  }

  private async renderPredictionMarketCandidatesInstructions(
    session: WorkspaceSession,
    instrumentClasses: InstrumentClass[],
  ): Promise<string | null> {
    if (!instrumentClasses.includes("prediction_market")) {
      return null;
    }

    const candidates = await this.fetchPredictionMarketCandidates();
    if (candidates.length === 0) {
      return null;
    }

    return `Prediction-market candidates (return only these canonical rows for prediction_market):\n${candidates
      .map((candidate) => `- ${JSON.stringify(candidate)}`)
      .join("\n")}`;
  }

  private async fetchPredictionMarketCandidates(): Promise<ResolvedInstrument[]> {
    let rows: PolymarketMarketRow[];
    try {
      const { adapter } = await this.deps.brokerRouting.resolveAdapter(this.sessionId, "prediction_market");
      if (!isMarketDiscoveryAdapter(adapter)) return [];
      rows = await adapter.fetchMarketCandidates();
    } catch {
      this.emitEvent("WARN", null, "Polymarket candidate fetch failed: no adapter or fetch error");
      return [];
    }
    const out: Array<ResolvedInstrument & { score: number }> = [];

    for (const row of rows) {
      const conditionId = typeof row.conditionId === "string" ? row.conditionId : null;
      const question = typeof row.question === "string" ? row.question : null;
      const slug = typeof row.slug === "string" ? row.slug : null;
      const category = typeof row.category === "string" ? row.category : null;
      const resolutionTime = typeof row.endDate === "string" ? row.endDate : null;
      const liquidity = Number(row.liquidity ?? row.liquidityClob ?? row.volume ?? 0);
      const tokens = Array.isArray(row.tokens) ? row.tokens : [];
      if (!conditionId || !question || tokens.length === 0) continue;

      // reason: Gamma API returns tokens as untyped JSON; narrowing outcome and token_id before use
      const yes = tokens.find(
        (token) => token && typeof token === "object" && (token as PredictionToken).outcome === "Yes",
      );
      const no = tokens.find(
        (token) => token && typeof token === "object" && (token as PredictionToken).outcome === "No",
      );
      const yesTokenId =
        typeof (yes as PredictionToken | undefined)?.token_id === "string"
          ? (yes as { token_id: string }).token_id
          : null;
      const noTokenId =
        typeof (no as PredictionToken | undefined)?.token_id === "string"
          ? (no as { token_id: string }).token_id
          : null;
      if (!yesTokenId || !noTokenId) continue;

      const timeScore = resolutionTime ? predictionResolutionScore(resolutionTime) : 0;
      const categoryScore = category ? 10 : 0;
      const score = Math.min(liquidity / 1000, 100) + timeScore + categoryScore;

      for (const [predictionOutcome, outcomeTokenId] of [["YES", yesTokenId], ["NO", noTokenId]] as const) {
        out.push({
          symbol: `pm:${conditionId}`,
          instrumentClass: "prediction_market",
          instrumentDisplayName: question,
          predictionOutcome,
          instrumentMetadataJson: JSON.stringify({
            slug,
            conditionId,
            outcomeTokenId,
            yesOutcomeTokenId: yesTokenId,
            noOutcomeTokenId: noTokenId,
            category,
            liquidity,
            resolutionTime,
          }),
          score,
        });
      }
    }

    return out
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ symbol, instrumentClass, instrumentDisplayName, predictionOutcome, instrumentMetadataJson }): ResolvedInstrument => ({
        symbol,
        instrumentClass,
        instrumentDisplayName,
        predictionOutcome,
        instrumentMetadataJson,
      }));
  }

  private getEffectiveInstrumentClasses(session: WorkspaceSession): InstrumentClass[] {
    return resolveSessionInstrumentClasses(session, this.deps);
  }
}

function formatMinutesLabel(minutes: number): string {
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function instrumentCacheTtlMs(holdingStyle: string): number {
  switch (holdingStyle) {
    case "intraday_flat":   return 30 * 60 * 1000;
    case "multi_day_swing": return 4 * 60 * 60 * 1000;
    case "weeks_position":  return 24 * 60 * 60 * 1000;
    default:                return 4 * 60 * 60 * 1000;
  }
}

function sumAiPipelineCost(pipeline: AiPipelineResult): number {
  return Number(
    (pipeline.technical.run.cost_usd +
      pipeline.fundamental.run.cost_usd +
      pipeline.review.run.cost_usd +
      pipeline.decision.run.cost_usd).toFixed(6),
  );
}

function remapPredictionMetadataForOutcome(
  raw: string | null,
  predictionOutcome: "YES" | "NO" | null,
): string | null {
  if (!raw || !predictionOutcome) return raw;
  const parsed = JSON.parse(raw) as {
    yesOutcomeTokenId?: string;
    noOutcomeTokenId?: string;
    outcomeTokenId?: string;
  };
  const outcomeTokenId = predictionOutcome === "YES" ? parsed.yesOutcomeTokenId : parsed.noOutcomeTokenId;
  return JSON.stringify({ ...parsed, outcomeTokenId: outcomeTokenId ?? parsed.outcomeTokenId });
}

function predictionResolutionScore(resolutionTime: string): number {
  const ms = new Date(resolutionTime).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const days = ms / (1000 * 60 * 60 * 24);
  if (days <= 1) return 30;
  if (days <= 7) return 20;
  if (days <= 30) return 10;
  return 4;
}
