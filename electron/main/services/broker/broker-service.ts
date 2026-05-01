import type { BrokerCredentials, ConnectionTestResult } from "@/lib/types";
import { AlpacaAdapter } from "../../broker/alpaca-adapter";
import type { BrokerAdapter, OrderRequest } from "../../broker/broker-adapter";
import { MockBrokerAdapter } from "../../broker/mock-adapter";
import { secretKeys, type SecretsService } from "../infra/secrets-service";

export class BrokerService {
  private adapter: BrokerAdapter = new MockBrokerAdapter();

  constructor(private readonly secrets: SecretsService) {}

  current(): BrokerAdapter {
    return this.adapter;
  }

  async restore(): Promise<void> {
    const apiKey = await this.secrets.get(secretKeys.alpacaApiKey);
    const secretKey = await this.secrets.get(secretKeys.alpacaSecretKey);
    const mode = (await this.secrets.get(secretKeys.alpacaMode)) ?? "paper";
    if (apiKey && secretKey && (mode === "paper" || mode === "live")) {
      this.adapter = new AlpacaAdapter({
        provider: "alpaca",
        api_key: apiKey,
        secret_key: secretKey,
        mode,
      });
    }
  }

  async saveBroker(credentials: BrokerCredentials): Promise<ConnectionTestResult> {
    const adapter = new AlpacaAdapter(credentials);
    const result = await adapter.testConnection();
    if (!result.ok) return result;

    await this.secrets.set(secretKeys.alpacaApiKey, credentials.api_key);
    await this.secrets.set(secretKeys.alpacaSecretKey, credentials.secret_key);
    await this.secrets.set(secretKeys.alpacaMode, credentials.mode);
    this.adapter = adapter;
    return result;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return this.adapter.testConnection();
  }

  async removeBroker(): Promise<void> {
    await Promise.all([
      this.secrets.delete(secretKeys.alpacaApiKey),
      this.secrets.delete(secretKeys.alpacaSecretKey),
      this.secrets.delete(secretKeys.alpacaMode),
    ]);
    this.adapter = new MockBrokerAdapter();
  }

  async getAccountBalance(): Promise<number> {
    return this.adapter.getAccountBalance();
  }

  async placeOrder(order: OrderRequest) {
    return this.adapter.placeOrder(order);
  }

  async closeOrder(orderId: string) {
    return this.adapter.closeOrder(orderId);
  }
}
