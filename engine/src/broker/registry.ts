import type { SecretsFile } from "../config.ts";
import type { Clock } from "../core/clock.ts";
import type { AlpacaKeys } from "../data/alpaca-data.ts";
import { InputError } from "../errors.ts";
import type { Store } from "../store/store.ts";
import { AlpacaBroker } from "./alpaca.ts";
import { type PriceSource, SimBroker } from "./sim.ts";
import type { Broker } from "./types.ts";

/** One broker instance per account, built from the account row and its keys. */
export class Brokers {
  private readonly cache = new Map<string, Broker>();

  constructor(
    private readonly d: {
      store: Store;
      secrets: SecretsFile;
      clock: Clock;
      prices: PriceSource;
      alpacaBaseUrl?: string;
      fetch?: typeof fetch;
    },
  ) {}

  get(accountId: string): Broker {
    const cached = this.cache.get(accountId);
    if (cached) return cached;
    const account = this.d.store.getAccount(accountId);
    if (!account) throw new InputError(`Unknown account ${accountId}`);
    let broker: Broker;
    if (account.broker === "alpaca") {
      const keys = this.keys(accountId);
      if (!keys) throw new InputError(`${account.name} has no API keys. Add them in Settings.`);
      broker = new AlpacaBroker({ keys, baseUrl: this.d.alpacaBaseUrl, fetch: this.d.fetch });
    } else {
      broker = new SimBroker({
        accountId,
        store: this.d.store,
        prices: this.d.prices,
        clock: this.d.clock,
        startingCash: account.startingCash ?? 100_000,
        slippageBps: 2,
        feeBps: 0,
      });
    }
    this.cache.set(accountId, broker);
    return broker;
  }

  mode(accountId: string): "paper" | "sim" {
    return this.d.store.getAccount(accountId)?.mode ?? "sim";
  }

  keys(accountId: string): AlpacaKeys | null {
    return this.d.secrets.read().accounts[accountId] ?? null;
  }

  /** Market data uses the first Alpaca account's keys. */
  dataKeys(): AlpacaKeys | null {
    for (const a of this.d.store.listAccounts()) {
      if (a.broker === "alpaca") {
        const k = this.keys(a.id);
        if (k) return k;
      }
    }
    return null;
  }

  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }
}
