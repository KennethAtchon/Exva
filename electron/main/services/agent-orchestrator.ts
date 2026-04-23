import PQueue from "p-queue";
import type { SessionConfig, Trade } from "@/lib/types";
import type { AgentRunsRepo } from "../db/repositories/agent-runs-repo";
import type { EventsRepo } from "../db/repositories/events-repo";
import type { StatsRepo } from "../db/repositories/stats-repo";
import type { TradesRepo } from "../db/repositories/trades-repo";
import type { BrokerService } from "./broker-service";
import type { EventBus } from "./event-bus";
import type { AiSdkService } from "./ai-sdk-service";
import type { RiskEngine } from "./risk-engine";

export interface OrchestratorDeps {
  ai: AiSdkService;
  broker: BrokerService;
  risk: RiskEngine;
  tradesRepo: TradesRepo;
  agentRunsRepo: AgentRunsRepo;
  eventsRepo: EventsRepo;
  statsRepo: StatsRepo;
  eventBus: EventBus;
  getConfig(): SessionConfig;
  getStats(): ReturnType<StatsRepo["dashboardStats"]>;
  isActive(): boolean;
}

export class AgentOrchestrator {
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly pendingApprovals = new Map<string, (approved: boolean) => void>();

  constructor(private readonly deps: OrchestratorDeps) {}

  start(): void {
    const config = this.deps.getConfig();
    this.queue.concurrency = config.max_concurrent_trades;
    for (const asset of this.watchlistFor(config)) {
      this.queue.add(() => this.runTradeCycle(asset)).catch((error) => {
        this.emitEvent("ERROR", null, `Trade cycle failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  pause(): void {
    this.queue.pause();
  }

  resume(): void {
    this.queue.start();
  }

  stop(): void {
    this.queue.clear();
    for (const resolve of this.pendingApprovals.values()) resolve(false);
    this.pendingApprovals.clear();
  }

  approve(tradeId: string, approved: boolean): void {
    const resolve = this.pendingApprovals.get(tradeId);
    if (resolve) {
      this.pendingApprovals.delete(tradeId);
      resolve(approved);
    }
  }

  private async runTradeCycle(asset: string): Promise<void> {
    if (!this.deps.isActive()) return;
    this.emitEvent("INFO", null, `Starting agent cycle for ${asset}`);

    const config = this.deps.getConfig();
    const bull = await this.deps.ai.runResearcher({ asset }, "bull");
    const bear = await this.deps.ai.runResearcher({ asset }, "bear");
    const review = await this.deps.ai.runReviewer({
      asset,
      bullCase: bull.output,
      bearCase: bear.output,
    });
    const decision = await this.deps.ai.runDecisionMaker({
      asset,
      bullCase: bull.output,
      bearCase: bear.output,
      review: review.output,
      maxPositionUsd: config.max_position_usd,
    });

    const trade = this.createTradeFromDecision(asset, config, decision.output);
    this.deps.tradesRepo.insert(trade);
    for (const run of [bull.run, bear.run, review.run, decision.run]) {
      this.deps.agentRunsRepo.insert({ ...run, trade_id: trade.id });
    }

    this.emitEvent(
      "INFO",
      trade.id,
      decision.output.action === "trade"
        ? `Decision maker proposed ${trade.side} ${trade.asset} with ${(Number(trade.confidence_score ?? 0) * 100).toFixed(0)}% confidence`
        : `Decision maker rejected ${trade.asset}: ${decision.output.reasoning}`,
      "decision_maker",
    );

    if (decision.output.action !== "trade") return;

    const risk = this.deps.risk.validateDecision({
      config,
      stats: this.deps.getStats(),
      order: {
        asset: trade.asset,
        side: trade.side,
        sizeUsd: trade.position_size_usd,
      },
      confidence: trade.confidence_score ?? 0,
    });
    if (!risk.allowed || !risk.value) {
      const rejected = this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
      this.emitEvent("WARN", trade.id, risk.reason ?? "Trade rejected by risk engine");
      this.deps.eventBus.emit("trade_closed", rejected);
      return;
    }

    if (config.human_approval_required) {
      this.deps.eventBus.emit("approval_required", {
        trade_id: trade.id,
        asset: trade.asset,
        side: trade.side,
        size_usd: trade.position_size_usd,
        confidence: trade.confidence_score ?? 0,
        reasoning: decision.output.reasoning,
      });

      const approved = await this.waitForApproval(trade.id);
      if (!approved) {
        const rejected = this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
        this.emitEvent("WARN", trade.id, "Trade rejected or approval timed out");
        this.deps.eventBus.emit("trade_closed", rejected);
        return;
      }
    }

    const order = await this.deps.broker.placeOrder(risk.value);
    const opened = this.deps.tradesRepo.markOpen(trade.id, order.brokerOrderId, order.filledAvgPrice);
    this.emitEvent("INFO", trade.id, `Broker order opened: ${order.brokerOrderId}`);
    this.deps.eventBus.emit("trade_opened", opened);
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
    asset: string,
    config: SessionConfig,
    decision: {
      action: "trade" | "no_trade";
      asset?: string;
      side?: "BUY" | "SELL";
      sizeUsd?: number;
      confidence: number;
      stopLossPct?: number;
      takeProfitPct?: number;
    },
  ): Trade {
    return {
      id: crypto.randomUUID(),
      asset: decision.asset ?? asset,
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

  private emitEvent(
    level: "DEBUG" | "INFO" | "WARN" | "ERROR",
    tradeId: string | null,
    message: string,
    agentType: "researcher_bull" | "researcher_bear" | "reviewer" | "decision_maker" | null = null,
  ): void {
    const event = this.deps.eventsRepo.insert({
      trade_id: tradeId,
      level,
      agent_type: agentType,
      message,
    });
    this.deps.eventBus.emit("agent_event", event);
  }

  private watchlistFor(config: SessionConfig): string[] {
    if (config.strategy.toLowerCase().includes("income")) return ["SPY"];
    return ["SPY", "QQQ"].slice(0, config.max_concurrent_trades);
  }
}
