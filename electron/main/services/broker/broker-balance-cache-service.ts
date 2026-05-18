import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import type { BrokerRegistry } from "./broker-registry";

export class BrokerBalanceCacheService {
  constructor(
    private readonly repo: BrokerAccountsRepo,
    private readonly registry: BrokerRegistry,
  ) {}

  async getBalance(brokerAccountId: string): Promise<number> {
    const { balanceCacheUsd, balanceCachedAt } = this.repo.getBalanceCache(brokerAccountId);
    const account = this.repo.require(brokerAccountId);
    const staleLimitMs = account.balanceRefreshIntervalMin * 60 * 1000;
    const isStale =
      balanceCacheUsd == null ||
      !balanceCachedAt ||
      Date.now() - Date.parse(balanceCachedAt) > staleLimitMs;

    if (!isStale) return balanceCacheUsd;
    return this.refreshBalance(brokerAccountId);
  }

  async refreshBalance(brokerAccountId: string): Promise<number> {
    const adapter = await this.registry.get(brokerAccountId);
    const balance = await adapter.getAccountBalance();
    this.repo.updateBalanceCache(brokerAccountId, balance, new Date().toISOString());
    return balance;
  }

  async refreshAll(brokerAccountIds: string[]): Promise<Array<{ id: string; balance?: number; error?: string }>> {
    return Promise.all(
      brokerAccountIds.map(async (id) => {
        try {
          const balance = await this.refreshBalance(id);
          return { id, balance };
        } catch (error) {
          return { id, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
  }
}
