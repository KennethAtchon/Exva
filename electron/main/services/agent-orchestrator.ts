import PQueue from "p-queue";
import type { EventSourceType, InstrumentClass, SessionConfig, Trade } from "@/lib/types";
import type { ApprovalRecheckInput, OrchestratorDeps } from "./session";

export class AgentOrchestrator {
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly pendingApprovals = new Map<string, (approved: boolean) => void>();
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
    for (const resolve of this.pendingApprovals.values()) resolve(false);
    this.pendingApprovals.clear();
  }

  async runApprovalRecheck(input: ApprovalRecheckInput): Promise<void> {
    await this.runTradeCycle(input.instrumentSymbol, input.instrumentClass);
  }

  resolveApproval(tradeId: string, approved: boolean): void {
    const resolve = this.pendingApprovals.get(tradeId);
    if (!resolve) return;

    this.pendingApprovals.delete(tradeId);
    resolve(approved);
  }

  private async runTradeCycle(instrumentSymbol: string, _instrumentClass: InstrumentClass): Promise<void> {
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;

    const config = this.deps.sessionRepo.getConfig(this.sessionId);
    const stats = this.deps.statsRepo.dashboardStats(
      this.sessionId,
      this.deps.sessionRepo.getStatus(this.sessionId),
      100000,
      this.deps.sessionRepo.uptimeMin(this.sessionId),
      config.max_api_spend_usd,
    );

    const bull = await this.deps.ai.runResearcher({ instrumentSymbol }, "bull");
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort();

    const bear = await this.deps.ai.runResearcher({ instrumentSymbol }, "bear");
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort();

    const review = await this.deps.ai.runReviewer({
      instrumentSymbol,
      bullCase: bull.output,
      bearCase: bear.output,
    });
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort();

    const decision = await this.deps.ai.runDecisionMaker({
      instrumentSymbol,
      bullCase: bull.output,
      bearCase: bear.output,
      review: review.output,
      maxPositionUsd: config.max_position_usd,
    });
    if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return this.emitAbort();

    const trade = this.createTradeFromDecision(instrumentSymbol, config, decision.output);
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

    if (config.human_approval_required) {
      this.deps.bus.emit("approval_required", {
        trade_id: trade.id,
        instrumentSymbol: trade.instrumentSymbol,
        side: trade.side,
        size_usd: trade.position_size_usd,
        confidence: trade.confidence_score ?? 0,
        reasoning: decision.output.reasoning,
      });

      const approved = await this.waitForApproval(trade.id);
      if (!approved) {
        const rejected = this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
        this.emitEvent("WARN", trade.id, "Trade rejected or approval timed out");
        this.deps.bus.emit("trade_closed", rejected);
        return;
      }
    }

    const order = await this.deps.broker.placeOrder(risk.value);
    const opened = this.deps.tradesRepo.markOpen(trade.id, order.brokerOrderId, order.filledAvgPrice);
    this.emitEvent("INFO", trade.id, `Placed ${trade.side} ${trade.instrumentSymbol} $${trade.position_size_usd} via broker.`, "broker");
    this.deps.bus.emit("trade_opened", opened);
  }

  private waitForApproval(tradeId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(tradeId);
        resolve(false);
      }, 5 * 60 * 1000);

      this.pendingApprovals.set(tradeId, (approved) => {
        clearTimeout(timeout);
        resolve(approved);
      });
    });
  }

  private createTradeFromDecision(
    instrumentSymbol: string,
    config: SessionConfig,
    decision: {
      action: "trade" | "no_trade";
      instrumentSymbol?: string;
      side?: "BUY" | "SELL";
      sizeUsd?: number;
      confidence: number;
      stopLossPct?: number;
      takeProfitPct?: number;
    },
  ): Trade {
    return {
      id: crypto.randomUUID(),
      sessionId: this.sessionId,
      brokerAccountId: null,
      instrumentSymbol: decision.instrumentSymbol ?? instrumentSymbol,
      instrumentType: "stock",
      side: decision.side ?? "BUY",
      entry_price: null,
      position_size_usd: Math.min(decision.sizeUsd ?? config.max_position_usd, config.max_position_usd),
      stop_loss_price: null,
      take_profit_price: null,
      strategy: config.strategy,
      status: decision.action === "trade" ? "pending" : "rejected",
      opened_at: null,
      closed_at: decision.action === "trade" ? null : new Date().toISOString(),
      final_pnl_usd: decision.action === "trade" ? null : 0,
      ai_cost_usd: 0,
      confidence_score: decision.confidence,
      broker_order_id: null,
      created_at: new Date().toISOString(),
    };
  }

  private emitAbort(): void {
    this.emitEvent("INFO", null, "Cycle aborted: session paused mid-flight.", "orchestrator");
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
