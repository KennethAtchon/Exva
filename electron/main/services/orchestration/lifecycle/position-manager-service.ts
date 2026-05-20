import type { SessionStrategyContextService } from "../../session/session-strategy-context-service";
import type { TradesRepo } from "../../../db/repositories/trades/trades-repo";
import type { BrokerRegistry } from "../../broker/broker-registry";
import type { EventBus } from "../../infra/event-bus";
import type { CapitalReservationService } from "../../risk/capital-reservation-service";

export class PositionManagerService {
  constructor(
    private readonly sessionId: string,
    private readonly tradesRepo: TradesRepo,
    private readonly brokerRegistry: BrokerRegistry,
    private readonly strategyContextService: SessionStrategyContextService,
    private readonly eventBus: EventBus,
    private readonly capitalReservation: CapitalReservationService,
  ) {}

  async dailyCheck(): Promise<void> {
    const { timeframe, riskConfig } = this.strategyContextService.get(
      this.sessionId,
    );
    const openTrades = this.tradesRepo
      .listOpenAndPending(this.sessionId)
      .filter((trade) => trade.status === "open");

    if (timeframe.maxHoldDays != null) {
      for (const trade of openTrades) {
        const openedAt = new Date(
          trade.opened_at ?? trade.created_at,
        ).getTime();
        const ageDays = (Date.now() - openedAt) / (1000 * 60 * 60 * 24);
        if (ageDays > timeframe.maxHoldDays) {
          await this.closeTradeAtBroker(
            trade.id,
            trade.brokerAccountId ?? null,
            trade.broker_order_id ?? null,
          );
        }
      }
    }

    if (riskConfig.maxExposureUsd != null) {
      const predictionTrades = this.tradesRepo
        .listOpenAndPending(this.sessionId)
        .filter(
          (trade) =>
            trade.status === "open" &&
            trade.instrumentType === "prediction_market",
        )
        .sort(
          (a, b) =>
            new Date(a.opened_at ?? a.created_at).getTime() -
            new Date(b.opened_at ?? b.created_at).getTime(),
        );
      let exposure = predictionTrades.reduce(
        (sum, trade) => sum + trade.position_size_usd,
        0,
      );
      for (const trade of predictionTrades) {
        if (exposure <= riskConfig.maxExposureUsd) break;
        await this.closeTradeAtBroker(
          trade.id,
          trade.brokerAccountId ?? null,
          trade.broker_order_id ?? null,
        );
        exposure -= trade.position_size_usd;
      }
    }
  }

  private async closeTradeAtBroker(
    tradeId: string,
    brokerAccountId: string | null,
    brokerOrderId: string | null,
  ): Promise<void> {
    if (!brokerAccountId || !brokerOrderId) return;
    const adapter = await this.brokerRegistry.get(brokerAccountId);
    const result = await adapter.closeOrder(brokerOrderId);
    const closed = this.tradesRepo.updateStatus(
      tradeId,
      "closed",
      result.realizedPnlUsd,
    );
    this.capitalReservation.releaseOnClose(tradeId);
    this.eventBus.emit("trade_closed", closed);
  }
}
