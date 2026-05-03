import type { BrokerAccount } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { BrokerAccountsRepo } from "../../db/repositories/broker-accounts-repo";
import type { SecretsService } from "../infra/secrets-service";
import { AlpacaAdapter } from "./adapters/alpaca-adapter";
import type { BrokerAdapter } from "./adapters/broker-adapter";
import { CoinbaseAdvancedTradeAdapter, type CoinbaseAdvancedCredentials } from "./adapters/coinbase-advanced-trade-adapter";
import { MockBrokerAdapter } from "./adapters/mock-adapter";
import { TradovateAdapter, type TradovateCredentials } from "./adapters/tradovate-adapter";
import type { BrokerCredentials } from "@/lib/types";

export class BrokerRegistry {
  private readonly adapters = new Map<string, BrokerAdapter>();

  constructor(
    private readonly brokerAccountsRepo: BrokerAccountsRepo,
    private readonly secrets: SecretsService,
  ) {}

  async get(brokerAccountId: string): Promise<BrokerAdapter> {
    if (this.adapters.has(brokerAccountId)) return this.adapters.get(brokerAccountId)!;

    const account = this.brokerAccountsRepo.require(brokerAccountId);
    const secret = await this.secrets.get(account.secretRef);
    if (!secret && account.brokerType !== "mock") {
      throw new AppError(`No secret for broker account: ${brokerAccountId}`, "MISSING_SECRET", { brokerAccountId });
    }

    const adapter = this.buildAdapter(account, secret ?? "{}");
    this.adapters.set(brokerAccountId, adapter);
    return adapter;
  }

  /** Build adapter without caching (used for add-broker test-before-save). */
  async buildEphemeral(account: BrokerAccount, credentialsJson: string): Promise<BrokerAdapter> {
    return this.buildAdapter(account, credentialsJson);
  }

  invalidate(brokerAccountId: string): void {
    this.adapters.delete(brokerAccountId);
  }

  private buildAdapter(account: BrokerAccount, credsJson: string): BrokerAdapter {
    switch (account.brokerType) {
      case "alpaca": {
        const parsed = JSON.parse(credsJson) as BrokerCredentials;
        if (parsed.provider !== "alpaca") {
          throw new AppError("Invalid Alpaca credentials payload", "VALIDATION_FAILED");
        }
        return new AlpacaAdapter(parsed);
      }
      case "coinbase_advanced_trade": {
        const parsed = JSON.parse(credsJson) as CoinbaseAdvancedCredentials;
        return new CoinbaseAdvancedTradeAdapter(parsed, account.mode);
      }
      case "tradovate": {
        const parsed = JSON.parse(credsJson) as TradovateCredentials;
        return new TradovateAdapter(parsed, account.mode);
      }
      case "mock":
        return new MockBrokerAdapter();
      default:
        throw new AppError(`Unknown broker type: ${account.brokerType}`, "UNKNOWN_BROKER");
    }
  }
}
