import type { StatsRepo } from "../../db/repositories/stats-repo";
import type { TradesRepo } from "../../db/repositories/trades-repo";
import type { SessionStrategyContextService } from "../session/session-strategy-context-service";
import type { BrokerRegistry } from "../broker/broker-registry";
import type { EventBus } from "../infra/event-bus";
import type { SessionRepo } from "../../db/repositories/session-repo";
import type { CapitalReservationService } from "../risk/capital-reservation-service";

export class TradeMonitor {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly tradesRepo: TradesRepo,
    private readonly statsRepo: StatsRepo,
    private readonly sessionRepo: SessionRepo,
    private readonly brokerRegistry: BrokerRegistry,
    private readonly strategyContextService: SessionStrategyContextService,
    private readonly capitalReservation: CapitalReservationService,
    private readonly portfolioValue: () => number,
    private readonly eventBus: EventBus,
    private readonly getMaxAiSpendUsd: () => number,
    private readonly uptimeMin: () => number = () => 0,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const openTrades = this.tradesRepo.listOpenAndPending(this.sessionId).filter((trade) => trade.status === "open");
    const strategyContext = this.strategyContextService.get(this.sessionId);

    await this.enforcePredictionMarketPolicy(openTrades, strategyContext.timeframe.maxHoldDays, strategyContext.riskConfig.maxExposureUsd);

    const remainingOpenTrades = this.tradesRepo.listOpenAndPending(this.sessionId).filter((trade) => trade.status === "open");
    for (const trade of remainingOpenTrades) {
      if (!trade.broker_order_id || !trade.brokerAccountId) continue;
      const adapter = await this.brokerRegistry.get(trade.brokerAccountId);
      const status = await adapter.getOrderStatus(trade.broker_order_id);
      if (status.status === "closed") {
        this.closeTrade(trade.id, status.realizedPnlUsd ?? 0);
      }
    }

    this.eventBus.emit(
      "stats_update",
      this.statsRepo.dashboardStats(
        this.sessionId,
        this.sessionRepo.getStatus(this.sessionId),
        this.portfolioValue(),
        this.uptimeMin(),
        this.getMaxAiSpendUsd(),
      ),
    );
  }

  private async enforcePredictionMarketPolicy(
    openTrades: ReturnType<TradesRepo["listOpenAndPending"]>,
    maxHoldDays: number | null,
    maxExposureUsd: number | null,
  ): Promise<void> {
    const predictionTrades = openTrades
      .filter((trade) => trade.instrumentType === "prediction_market")
      .sort((a, b) => {
        const at = new Date(a.opened_at ?? a.created_at).getTime();
        const bt = new Date(b.opened_at ?? b.created_at).getTime();
        return at - bt;
      });

    for (const trade of predictionTrades) {
      const resolutionTime = readResolutionTime(trade.instrumentMetadataJson);
      if (resolutionTime && resolutionTime.getTime() <= Date.now()) {
        await this.closePredictionTrade(trade);
      }
    }

    if (maxHoldDays != null) {
      for (const trade of predictionTrades) {
        const openedAt = new Date(trade.opened_at ?? trade.created_at).getTime();
        const ageDays = (Date.now() - openedAt) / (1000 * 60 * 60 * 24);
        if (ageDays > maxHoldDays) {
          await this.closePredictionTrade(trade);
        }
      }
    }

    if (maxExposureUsd != null) {
      const remaining = this.tradesRepo
        .listOpenAndPending(this.sessionId)
        .filter((trade) => trade.status === "open" && trade.instrumentType === "prediction_market");
      let exposure = remaining.reduce((sum, trade) => sum + trade.position_size_usd, 0);
      for (const trade of remaining.sort((a, b) => new Date(a.opened_at ?? a.created_at).getTime() - new Date(b.opened_at ?? b.created_at).getTime())) {
        if (exposure <= maxExposureUsd) break;
        await this.closePredictionTrade(trade);
        exposure -= trade.position_size_usd;
      }
    }
  }

  private async closePredictionTrade(trade: ReturnType<TradesRepo["require"]>): Promise<void> {
    if (!trade.broker_order_id || !trade.brokerAccountId) return;
    const adapter = await this.brokerRegistry.get(trade.brokerAccountId);
    const result = await adapter.closeOrder(trade.broker_order_id);
    this.closeTrade(trade.id, result.realizedPnlUsd);
  }

  private closeTrade(tradeId: string, pnl: number) {
    const closed = this.tradesRepo.updateStatus(tradeId, "closed", pnl);
    this.capitalReservation.releaseOnClose(tradeId);
    this.eventBus.emit("trade_closed", closed);
    return closed;
  }
}

function readResolutionTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { resolutionTime?: string | null };
    if (!parsed.resolutionTime) return null;
    const date = new Date(parsed.resolutionTime);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}
