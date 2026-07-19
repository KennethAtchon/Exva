import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import type { EventBus } from "../infra/event-bus";
import type { Logger } from "../infra/log";
import type { BrokerBalanceCacheService } from "./broker-balance-cache-service";

export class BrokerBalanceTicker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repo: BrokerAccountsRepo,
    private readonly balanceCache: BrokerBalanceCacheService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly tickIntervalMs = 60_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        this.logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "broker balance ticker tick failed",
        );
      });
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const accounts = this.repo.list();
    for (const account of accounts) {
      const { balanceCachedAt } = this.repo.getBalanceCache(account.id);
      const staleLimitMs = account.balanceRefreshIntervalMin * 60 * 1000;
      const isStale =
        !balanceCachedAt ||
        Date.now() - Date.parse(balanceCachedAt) > staleLimitMs;
      if (!isStale) continue;

      try {
        const cachedAt = new Date().toISOString();
        const balance = await this.balanceCache.refreshBalance(account.id);
        this.bus.emit("broker_balance_updated", {
          brokerAccountId: account.id,
          balanceUsd: balance,
          cachedAt,
        });
      } catch (error) {
        this.logger.warn(
          {
            brokerAccountId: account.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "balance refresh failed in tick; retaining stale cache",
        );
      }
    }
  }
}
