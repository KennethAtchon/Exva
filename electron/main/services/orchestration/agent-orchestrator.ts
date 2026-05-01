import PQueue from "p-queue";
import type { EventSourceType, InstrumentClass, SessionConfig, Trade } from "@/lib/types";
import type { ApprovalRecheckInput, OrchestratorDeps } from "../session";

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

    const config = this.deps.sessionRepo.getConfig(this.sessionId);
    this.queue.concurrency = config.max_concurrent_trades;
    this.started = true;

    for (const instrumentSymbol of this.getInstruments(this.deps.sessionRepo.requireById(this.sessionId), config)) {
      this.queue.add(() => this.runTradeCycle(instrumentSymbol, "stock")).catch((error) => {
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
      this.deps.capitalReservationsRepo.releaseByApproval(approvalId);
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
      this.deps.capitalReservationsRepo.updateReservedAmountForApproval(approval.id, target);
    }

    const order = await this.deps.broker.placeOrder(risk.value);
    const opened = this.deps.tradesRepo.markOpen(trade.id, order.brokerOrderId, order.filledAvgPrice);
    this.deps.capitalReservationsRepo.convertApprovalToOpenOrder(approval.id, trade.id);
    this.emitEvent("INFO", trade.id, `Placed ${updated.side} ${updated.instrumentSymbol} $${updated.position_size_usd} via broker (post-approval recheck).`, "broker");
    this.deps.bus.emit("trade_opened", opened);
  }

  private failRecheck(tradeId: string, approvalId: string, message: string): void {
    this.deps.capitalReservationsRepo.releaseByApproval(approvalId);
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
        this.deps.capitalReservationsRepo.releaseByApproval(approvalId);
        const rejected = this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
        this.emitEvent("WARN", trade.id, "Trade rejected by user");
        this.deps.bus.emit("trade_closed", rejected);
        return;
      }
    }

    const order = await this.deps.broker.placeOrder(risk.value);
    const opened = this.deps.tradesRepo.markOpen(trade.id, order.brokerOrderId, order.filledAvgPrice);
    if (approvalIdForCapital) {
      this.deps.capitalReservationsRepo.convertApprovalToOpenOrder(approvalIdForCapital, trade.id);
    }
    this.emitEvent("INFO", trade.id, `Placed ${trade.side} ${trade.instrumentSymbol} $${trade.position_size_usd} via broker.`, "broker");
    this.deps.bus.emit("trade_opened", opened);
  }

  private async runAiPipeline(
    instrumentSymbol: string,
    instrumentClass: InstrumentClass,
    config: SessionConfig,
  ): Promise<{ bull: AiResearchRun; bear: AiResearchRun; review: AiReviewRun; decision: AiDecisionRun } | null> {
    const bull = await this.deps.ai.runResearcher({ instrumentSymbol }, "bull");
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    const bear = await this.deps.ai.runResearcher({ instrumentSymbol }, "bear");
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    const review = await this.deps.ai.runReviewer({
      instrumentSymbol,
      bullCase: bull.output,
      bearCase: bear.output,
    });
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort(), null;

    const decision = await this.deps.ai.runDecisionMaker({
      instrumentSymbol,
      bullCase: bull.output,
      bearCase: bear.output,
      review: review.output,
      maxPositionUsd: config.max_position_usd,
    });
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
      }),
    });

    const workspace = this.deps.workspacePreferencesRepo.get();
    if (workspace.capitalAllocationMode === "shared_global_pool") {
      this.deps.capitalReservationsRepo.reserveForApproval({
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
    const routed = this.deps.brokerRoutingRepo.resolveBrokerAccountId(this.sessionId, instrumentClass);
    if (routed) return routed;
    const assigned = this.deps.sessionBrokerAssignmentsRepo.listBrokerAccountIds(this.sessionId);
    if (assigned[0]) return assigned[0];
    throw new Error("No broker account is assigned for this session.");
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

  private getInstruments(session: { instrumentScope: string }, config: SessionConfig): string[] {
    return session.instrumentScope
      .split(/[\n,]+/)
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol) => symbol.length > 0)
      .slice(0, config.max_concurrent_trades);
  }
}
