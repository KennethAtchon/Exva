import PQueue from "p-queue";
import type { EventSourceType, InstrumentClass, SessionConfig, Trade, WorkspaceSession } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { OrderRequest } from "./broker/adapters/broker-adapter";
import type { ApprovalRecheckInput, OrchestratorDeps } from "./session";
import { buildSelectorDefinitionFingerprint, hashSelectorDefinition } from "./selector-definition-hash";

type ResolvedInstrument = { symbol: string; instrumentClass: InstrumentClass };

type AiResearchRun = Awaited<ReturnType<OrchestratorDeps["ai"]["runResearcher"]>>;
type AiReviewRun = Awaited<ReturnType<OrchestratorDeps["ai"]["runReviewer"]>>;
type AiDecisionRun = Awaited<ReturnType<OrchestratorDeps["ai"]["runDecisionMaker"]>>;

type DecisionOutput = {
  action: "trade" | "no_trade";
  instrumentSymbol?: string;
  side?: "BUY" | "SELL";
  sizeUsd?: number;
  confidence: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  reasoning: string;
};

export class AgentOrchestrator {
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly approvalCallbacks = new Map<string, (approved: boolean) => void>();
  /** Trade id → approval id while waiting for human decision. */
  private readonly pendingApprovalIds = new Map<string, string>();
  private started = false;

  constructor(
    readonly sessionId: string,
    private readonly deps: OrchestratorDeps,
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      this.queue.start();
      return;
    }

    const session = this.deps.sessionRepo.requireById(this.sessionId);
    const config = this.deps.sessionRepo.getConfig(this.sessionId);
    this.queue.concurrency = config.max_concurrent_trades;
    this.started = true;

    let instruments: ResolvedInstrument[];
    try {
      instruments = await this.resolveInstruments(session, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent("ERROR", null, `Instrument resolution failed: ${message}`);
      throw error instanceof AppError ? error : new AppError(message, "VALIDATION_FAILED");
    }

    for (const { symbol, instrumentClass } of instruments) {
      this.queue.add(() => this.runTradeCycle(symbol, instrumentClass)).catch((error) => {
        this.emitEvent(
          "ERROR",
          null,
          `Trade cycle failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  async pause(): Promise<void> {
    this.queue.pause();
  }

  async resume(): Promise<void> {
    this.queue.start();
  }

  async stop(): Promise<void> {
    this.queue.clear();
    for (const approvalId of this.pendingApprovalIds.values()) {
      this.deps.capitalReservation.releaseByApproval(approvalId);
    }
    this.pendingApprovalIds.clear();
    for (const resolve of this.approvalCallbacks.values()) resolve(false);
    this.approvalCallbacks.clear();
  }

  async runApprovalRecheck(input: ApprovalRecheckInput): Promise<void> {
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;

    const approval = this.deps.tradeApprovalsRepo.require(input.approvalId);
    const trade = this.deps.tradesRepo.require(approval.tradeId);
    if (trade.status !== "pending") return;

    const config = this.deps.sessionRepo.getConfig(this.sessionId);
    const stats = this.deps.statsRepo.dashboardStats(
      this.sessionId,
      this.deps.sessionRepo.getStatus(this.sessionId),
      100000,
      this.deps.sessionRepo.uptimeMin(this.sessionId),
      config.max_api_spend_usd,
    );

    const pipeline = await this.runAiPipeline(input.instrumentSymbol, input.instrumentClass, config);
    if (!pipeline) return;

    const { bull, bear, review, decision } = pipeline;

    for (const run of [bull.run, bear.run, review.run, decision.run]) {
      this.deps.agentRunsRepo.insert({ ...run, session_id: this.sessionId, trade_id: trade.id });
    }

    const fresh = decision.output;
    if (fresh.action !== "trade") {
      this.failRecheck(trade.id, approval.id, "Fresh decision is no_trade; not placing order.");
      return;
    }

    const nextTrade = this.buildTradeFromDecision(trade.id, input.instrumentSymbol, input.instrumentClass, config, fresh);
    this.deps.tradesRepo.patchPendingExecution(trade.id, {
      side: nextTrade.side,
      position_size_usd: nextTrade.position_size_usd,
      confidence_score: nextTrade.confidence_score,
      brokerAccountId: nextTrade.brokerAccountId,
    });
    const updated = this.deps.tradesRepo.require(trade.id);

    const risk = this.deps.riskEngine.validateDecision({
      config,
      stats,
      order: {
        instrumentSymbol: updated.instrumentSymbol,
        instrumentType: input.instrumentClass,
        side: updated.side,
        sizeUsd: updated.position_size_usd,
      },
      confidence: updated.confidence_score ?? 0,
    });

    if (!risk.allowed || !risk.value) {
      this.failRecheck(trade.id, approval.id, risk.reason ?? "Fresh risk check rejected the trade.");
      return;
    }

    const workspace = this.deps.workspacePreferencesRepo.get();
    if (workspace.capitalAllocationMode === "shared_global_pool") {
      const target = risk.value.sizeUsd;
      this.deps.capitalReservation.updateReservedAmountForApproval(approval.id, target);
    }

    const placed = await this.placeRoutedOrder(updated, input.instrumentClass, risk.value);
    if (!placed) {
      this.failRecheck(trade.id, approval.id, "Instrument conflict or broker routing blocked order placement.");
      return;
    }
    const opened = this.deps.tradesRepo.markOpen(trade.id, placed.brokerOrderId, placed.filledAvgPrice);
    this.deps.capitalReservation.convertApprovalToOpenOrder(approval.id, trade.id);
    if (workspace.capitalAllocationMode === "shared_global_pool") {
      this.deps.capitalReservation.convertOrderToPosition(trade.id);
    }
    this.emitEvent("INFO", trade.id, `Placed ${updated.side} ${updated.instrumentSymbol} $${updated.position_size_usd} via broker (post-approval recheck).`, "broker");
    this.deps.bus.emit("trade_opened", opened);
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

  private async runTradeCycle(instrumentSymbol: string, instrumentClass: InstrumentClass): Promise<void> {
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;

    const config = this.deps.sessionRepo.getConfig(this.sessionId);
    const stats = this.deps.statsRepo.dashboardStats(
      this.sessionId,
      this.deps.sessionRepo.getStatus(this.sessionId),
      100000,
      this.deps.sessionRepo.uptimeMin(this.sessionId),
      config.max_api_spend_usd,
    );

    const pipeline = await this.runAiPipeline(instrumentSymbol, instrumentClass, config);
    if (!pipeline) return;

    const { bull, bear, review, decision } = pipeline;

    const trade = this.createTradeFromDecision(instrumentSymbol, instrumentClass, config, decision.output);
    this.deps.tradesRepo.insert(trade);
    for (const run of [bull.run, bear.run, review.run, decision.run]) {
      this.deps.agentRunsRepo.insert({ ...run, session_id: this.sessionId, trade_id: trade.id });
    }

    if (decision.output.action !== "trade") return;

    const risk = this.deps.riskEngine.validateDecision({
      config,
      stats,
      order: {
        instrumentSymbol: trade.instrumentSymbol,
        instrumentType: instrumentClass,
        side: trade.side,
        sizeUsd: trade.position_size_usd,
      },
      confidence: trade.confidence_score ?? 0,
    });
    if (!risk.allowed || !risk.value) {
      this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
      this.emitEvent("WARN", trade.id, risk.reason ?? "Trade rejected by risk engine");
      return;
    }

    let approvalIdForCapital: string | null = null;
    if (config.human_approval_required) {
      const { approved, approvalId } = await this.waitForApproval(trade, instrumentClass, decision.output, risk.reason);
      approvalIdForCapital = approvalId;
      if (!approved) {
        this.deps.capitalReservation.releaseByApproval(approvalId);
        const rejected = this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
        this.emitEvent("WARN", trade.id, "Trade rejected by user");
        this.deps.bus.emit("trade_closed", rejected);
        return;
      }
    }

    const placed = await this.placeRoutedOrder(trade, instrumentClass, risk.value);
    if (!placed) {
      this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
      this.emitEvent("WARN", trade.id, "Instrument conflict or broker routing blocked order placement.");
      this.deps.bus.emit("trade_closed", this.deps.tradesRepo.require(trade.id));
      return;
    }

    const opened = this.deps.tradesRepo.markOpen(trade.id, placed.brokerOrderId, placed.filledAvgPrice);
    if (approvalIdForCapital) {
      this.deps.capitalReservation.convertApprovalToOpenOrder(approvalIdForCapital, trade.id);
    }
    const workspace = this.deps.workspacePreferencesRepo.get();
    if (workspace.capitalAllocationMode === "shared_global_pool" && approvalIdForCapital) {
      this.deps.capitalReservation.convertOrderToPosition(trade.id);
    }
    this.emitEvent("INFO", trade.id, `Placed ${trade.side} ${trade.instrumentSymbol} $${trade.position_size_usd} via broker.`, "broker");
    this.deps.bus.emit("trade_opened", opened);
  }

  private async placeRoutedOrder(
    trade: Trade,
    instrumentClass: InstrumentClass,
    riskOrder: OrderRequest,
  ): Promise<{ brokerOrderId: string; filledAvgPrice: number } | null> {
    const { adapter, brokerAccountId } = await this.deps.brokerRouting.resolveAdapter(this.sessionId, instrumentClass);

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
      instrumentType: instrumentClass,
      side: riskOrder.side,
      sizeUsd: riskOrder.sizeUsd,
    });

    if (trade.brokerAccountId !== brokerAccountId) {
      this.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId });
    }

    return { brokerOrderId: result.brokerOrderId, filledAvgPrice: result.filledAvgPrice };
  }

  private async runAiPipeline(
    instrumentSymbol: string,
    instrumentClass: InstrumentClass,
    config: SessionConfig,
  ): Promise<{ bull: AiResearchRun; bear: AiResearchRun; review: AiReviewRun; decision: AiDecisionRun } | null> {
    const bull = await this.deps.ai.runResearcher({ instrumentSymbol }, "bull", this.sessionId);
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    const bear = await this.deps.ai.runResearcher({ instrumentSymbol }, "bear", this.sessionId);
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    const review = await this.deps.ai.runReviewer(
      {
        instrumentSymbol,
        bullCase: bull.output,
        bearCase: bear.output,
      },
      this.sessionId,
    );
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    const decision = await this.deps.ai.runDecisionMaker(
      {
        instrumentSymbol,
        bullCase: bull.output,
        bearCase: bear.output,
        review: review.output,
        maxPositionUsd: config.max_position_usd,
      },
      this.sessionId,
    );
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    return { bull, bear, review, decision };
  }

  private waitForApproval(
    trade: Trade,
    instrumentClass: InstrumentClass,
    decisionOut: DecisionOutput,
    riskNote: string | undefined,
  ): Promise<{ approved: boolean; approvalId: string }> {
    const resolvedBroker = trade.brokerAccountId ?? this.resolveBrokerAccountId(instrumentClass);
    if (trade.brokerAccountId == null) {
      this.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId: resolvedBroker });
    }

    const sessionStrategy = this.deps.sessionStrategiesRepo.get(this.sessionId);
    const approval = this.deps.tradeApprovalsRepo.createPending({
      sessionId: this.sessionId,
      tradeId: trade.id,
      brokerAccountId: resolvedBroker,
      instrumentSymbol: trade.instrumentSymbol,
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

    const workspace = this.deps.workspacePreferencesRepo.get();
    if (workspace.capitalAllocationMode === "shared_global_pool") {
      this.deps.capitalReservation.reserveForApproval({
        sessionId: this.sessionId,
        approvalId: approval.id,
        amountUsd: trade.position_size_usd,
      });
    }

    this.deps.bus.emit("approval_required", {
      trade_id: trade.id,
      approval_id: approval.id,
      session_id: this.sessionId,
      instrumentSymbol: trade.instrumentSymbol,
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

  /** Fresh sizing for an existing pending trade after a recheck decision. */
  private buildTradeFromDecision(
    tradeId: string,
    instrumentSymbol: string,
    instrumentClass: InstrumentClass,
    config: SessionConfig,
    decision: DecisionOutput,
  ): Trade {
    const brokerAccountId = this.resolveBrokerAccountId(instrumentClass);
    return {
      id: tradeId,
      sessionId: this.sessionId,
      brokerAccountId,
      instrumentSymbol: decision.instrumentSymbol ?? instrumentSymbol,
      instrumentType: instrumentClass,
      side: decision.side ?? "BUY",
      entry_price: null,
      position_size_usd: Math.min(decision.sizeUsd ?? config.max_position_usd, config.max_position_usd),
      stop_loss_price: null,
      take_profit_price: null,
      strategy: config.strategy,
      status: "pending",
      opened_at: null,
      closed_at: null,
      final_pnl_usd: null,
      ai_cost_usd: 0,
      confidence_score: decision.confidence,
      broker_order_id: null,
      created_at: new Date().toISOString(),
    };
  }

  private createTradeFromDecision(
    instrumentSymbol: string,
    instrumentClass: InstrumentClass,
    config: SessionConfig,
    decision: DecisionOutput,
  ): Trade {
    const id = crypto.randomUUID();
    const brokerAccountId = this.resolveBrokerAccountId(instrumentClass);
    const isTrade = decision.action === "trade";
    return {
      id,
      sessionId: this.sessionId,
      brokerAccountId,
      instrumentSymbol: decision.instrumentSymbol ?? instrumentSymbol,
      instrumentType: instrumentClass,
      side: decision.side ?? "BUY",
      entry_price: null,
      position_size_usd: Math.min(decision.sizeUsd ?? config.max_position_usd, config.max_position_usd),
      stop_loss_price: null,
      take_profit_price: null,
      strategy: config.strategy,
      status: isTrade ? "pending" : "rejected",
      opened_at: null,
      closed_at: isTrade ? null : new Date().toISOString(),
      final_pnl_usd: isTrade ? null : 0,
      ai_cost_usd: 0,
      confidence_score: decision.confidence,
      broker_order_id: null,
      created_at: new Date().toISOString(),
    };
  }

  private emitAbort(): null {
    this.emitEvent("INFO", null, "Cycle aborted: session paused mid-flight.", "orchestrator");
    return null;
  }

  private emitEvent(
    level: "DEBUG" | "INFO" | "WARN" | "ERROR",
    tradeId: string | null,
    message: string,
    agentType: EventSourceType | null = null,
  ): void {
    const event = this.deps.eventsRepo.insert({
      session_id: this.sessionId,
      trade_id: tradeId,
      level,
      agent_type: agentType,
      message,
    });
    this.deps.bus.emit("agent_event", event);
  }

  private async resolveInstruments(
    session: WorkspaceSession,
    config: SessionConfig,
  ): Promise<ResolvedInstrument[]> {
    const selectorSettings = this.deps.sessionSelectorSettingsRepo.get(session.id);
    const fingerprint = buildSelectorDefinitionFingerprint(session, this.deps);
    const definitionHash = hashSelectorDefinition(fingerprint);

    const cached = this.deps.instrumentCacheRepo.get(session.id);
    if (cached?.definitionHash === definitionHash) {
      const parsed = JSON.parse(cached.instruments) as ResolvedInstrument[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new AppError("Cached instrument list is invalid or empty.", "VALIDATION_FAILED");
      }
      return parsed;
    }

    if (session.selectionMode === "manual_shortlist" || !selectorSettings.aiPickerEnabled) {
      return this.parseManualShortlist(session, config);
    }

    this.emitEvent("INFO", null, "Running instrument selector agent...");
    const result = await this.deps.ai.runInstrumentSelector(session.id, session.instrumentScope);

    const filtered = result.output.instruments.filter((row: ResolvedInstrument) =>
      session.instrumentClasses.includes(row.instrumentClass),
    );
    if (filtered.length === 0) {
      throw new AppError(
        "Instrument selector returned no instruments compatible with this session's instrument classes.",
        "VALIDATION_FAILED",
      );
    }

    const limited = filtered.slice(0, config.max_concurrent_trades);
    const payload: ResolvedInstrument[] = limited.map((row: ResolvedInstrument) => ({
      symbol: row.symbol,
      instrumentClass: row.instrumentClass,
    }));

    this.deps.agentRunsRepo.insert({
      ...result.run,
      session_id: this.sessionId,
      trade_id: null,
    });

    this.deps.instrumentCacheRepo.save({
      sessionId: session.id,
      instruments: JSON.stringify(payload),
      definitionHash,
      selectedAt: new Date().toISOString(),
      selectorAgentRunId: result.run.id,
    });

    this.emitEvent("INFO", null, `Instrument selector chose ${payload.length} instruments.`);
    return payload;
  }

  private parseManualShortlist(session: WorkspaceSession, config: SessionConfig): ResolvedInstrument[] {
    const symbols = session.instrumentScope
      .split(/[\n,]+/)
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol) => symbol.length > 0);

    const out: ResolvedInstrument[] = [];
    for (const symbol of symbols) {
      const instrumentClass = this.inferInstrumentClass(symbol, session.instrumentClasses);
      if (!session.instrumentClasses.includes(instrumentClass)) continue;
      out.push({ symbol, instrumentClass });
    }
    if (out.length === 0) {
      throw new AppError("Manual instrument shortlist is empty after parsing.", "VALIDATION_FAILED");
    }
    return out.slice(0, config.max_concurrent_trades);
  }

  private inferInstrumentClass(symbol: string, classes: InstrumentClass[]): InstrumentClass {
    if (classes.length === 1) return classes[0]!;
    const upper = symbol.toUpperCase();
    if (classes.includes("crypto") && upper.includes("-")) return "crypto";
    if (classes.includes("futures") && /^[A-Z]{2,4}[FGHJKMNQUVXZ]\d{1,2}$/i.test(upper)) return "futures";
    if (classes.includes("stock")) return "stock";
    return classes[0]!;
  }
}
