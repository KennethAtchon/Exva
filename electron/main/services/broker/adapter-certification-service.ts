import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import { AdapterCertRepo } from "../../db/repositories/brokers/adapter-cert-repo";
import type { BrokerRegistry } from "./broker-registry";
import type {
  AdapterCertOptions,
  AdapterCertReport,
} from "./__tests__/adapter-certification";
import { runAdapterCertification } from "./__tests__/adapter-certification";
import type { BrokerAdapterCertState } from "@electron/shared/domain/adapter-certification";
import { AppError } from "@electron/shared/infra/errors";
import type { BrokerOrderV2 } from "./order-contract-v2";

export interface AdapterCertificationServiceDeps {
  adapterCertRepo: AdapterCertRepo;
  brokerAccountsRepo: BrokerAccountsRepo;
  brokerRegistry: BrokerRegistry;
}

const DEFAULT_CERT_SYMBOLS: Record<string, { symbol: string; instrumentClass: BrokerOrderV2["instrument"]["instrumentClass"] }> = {
  alpaca: { symbol: "SPY", instrumentClass: "stock" },
  kraken: { symbol: "BTC/USD", instrumentClass: "crypto" },
  tradier: { symbol: "SPY", instrumentClass: "stock" },
  kalshi: { symbol: "KXTEST", instrumentClass: "prediction_market" },
  polymarket: { symbol: "TEST-MKT", instrumentClass: "prediction_market" },
  mock: { symbol: "AAPL", instrumentClass: "stock" },
};

/**
 * Run adapter certification against a stored broker account and persist result.
 */
export class AdapterCertificationService {
  constructor(private readonly deps: AdapterCertificationServiceDeps) {}

  getLatest(brokerAccountId: string): BrokerAdapterCertState | null {
    return this.deps.adapterCertRepo.getLatest(brokerAccountId);
  }

  listRuns(brokerAccountId: string, limit = 20): BrokerAdapterCertState[] {
    return this.deps.adapterCertRepo.listRuns(brokerAccountId, limit);
  }

  async runForAccount(
    brokerAccountId: string,
    options?: Partial<Omit<AdapterCertOptions, "adapter">>,
  ): Promise<BrokerAdapterCertState> {
    const account = this.deps.brokerAccountsRepo.find(brokerAccountId);
    if (!account) {
      throw new AppError(
        `Broker account not found: ${brokerAccountId}`,
        "NOT_FOUND",
      );
    }

    const adapter = await this.deps.brokerRegistry.get(brokerAccountId);
    const defaults =
      DEFAULT_CERT_SYMBOLS[account.brokerType] ?? DEFAULT_CERT_SYMBOLS.mock;

    const report = await runAdapterCertification({
      adapter,
      symbol: options?.symbol ?? defaults.symbol,
      instrumentClass: options?.instrumentClass ?? defaults.instrumentClass,
      trade: options?.trade,
      fillTimeoutMs: options?.fillTimeoutMs,
      farLimitFraction: options?.farLimitFraction,
    });

    return this.deps.adapterCertRepo.saveResult(brokerAccountId, report);
  }

  /** Whether persisted cert allows effective launch for non-Alpaca adapters. */
  isEffectivelyLaunchCapable(brokerAccountId: string): boolean {
    const latest = this.getLatest(brokerAccountId);
    return latest?.passed === true;
  }
}

export type { AdapterCertReport };
