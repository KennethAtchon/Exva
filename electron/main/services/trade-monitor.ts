import type { StatsRepo } from "../db/repositories/stats-repo";
import type { TradesRepo } from "../db/repositories/trades-repo";
import type { BrokerService } from "./broker-service";
import type { EventBus } from "./event-bus";
import type { SessionService } from "./session-service";

export class TradeMonitor {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tradesRepo: TradesRepo,
    private readonly statsRepo: StatsRepo,
    private readonly broker: BrokerService,
    private readonly session: () => SessionService,
    private readonly eventBus: EventBus,
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
    const openTrades = this.tradesRepo.listOpenAndPending().filter((trade) => trade.status === "open");
    for (const trade of openTrades) {
      if (!trade.broker_order_id) continue;
      const status = await this.broker.current().getOrderStatus(trade.broker_order_id);
      if (status.status === "closed") {
        const closed = this.tradesRepo.updateStatus(trade.id, "closed", status.realizedPnlUsd ?? 0);
        this.eventBus.emit("trade_closed", closed);
      }
    }

    const session = this.session();
    this.eventBus.emit(
      "stats_update",
      this.statsRepo.dashboardStats(
        session.getStatus(),
        session.getPortfolioValue(),
        session.uptimeMin(),
        5,
      ),
    );
  }
}
