import type { BrokerCredentials, ConnectionTestResult } from "@/lib/types";
import type { BrokerRegistry } from "./broker-registry";
import type { CloseResult } from "./adapters/broker-adapter";
import { runWithProviderCallScopeAsync } from "../infra/provider-call-log";

/** Thin helper for IPC paths that close by broker account + order id. */
export class BrokerService {
  constructor(private readonly registry: BrokerRegistry) {}

  async closeOrder(
    brokerAccountId: string,
    brokerOrderId: string,
    scope?: {
      sessionId?: string | null;
      tradeId?: string | null;
      cycleId?: string | null;
    },
  ): Promise<CloseResult> {
    return runWithProviderCallScopeAsync(scope ?? {}, async () => {
      const adapter = await this.registry.get(brokerAccountId);
      return adapter.closeOrder(brokerOrderId);
    });
  }

  /** @deprecated Legacy Alpaca-only flow — prefer broker registry IPC. */
  async saveBroker(
    _credentials: BrokerCredentials,
  ): Promise<ConnectionTestResult> {
    void _credentials;
    return {
      ok: false,
      message: "Use Accounts → Add broker to register a broker account.",
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      ok: false,
      message: "Test a specific broker account from the broker list.",
    };
  }

  async removeBroker(): Promise<void> {
    /* no-op: legacy */
  }
}
