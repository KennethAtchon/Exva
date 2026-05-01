import type { StatsRepo } from "../../db/repositories/stats-repo";
import type { TradesRepo } from "../../db/repositories/trades-repo";
import type { BrokerService } from "./broker-service";
import type { EventBus } from "../infra/event-bus";
import type { SessionRepo } from "../../db/repositories/session-repo";

export class TradeMonitor {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly tradesRepo: TradesRepo,
    private readonly statsRepo: StatsRepo,
    private readonly sessionRepo: SessionRepo,
    private readonly broker: BrokerService,
    private readonly portfolioValue: () => number,
    private readonly eventBus: EventBus,
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
    for (const trade of openTrades) {
      if (!trade.broker_order_id) continue;
      const status = await this.broker.current().getOrderStatus(trade.broker_order_id);
      if (status.status === "closed") {
        const closed = this.tradesRepo.updateStatus(trade.id, "closed", status.realizedPnlUsd ?? 0);
        this.eventBus.emit("trade_closed", closed);
      }
    }

    this.eventBus.emit(
      "stats_update",
      this.statsRepo.dashboardStats(
        this.sessionId,
        this.sessionRepo.getStatus(this.sessionId),
        this.portfolioValue(),
        this.uptimeMin(),
        this.sessionRepo.getConfig(this.sessionId).max_api_spend_usd,
      ),
    );
  }
}
