import type { ConnectionTestResult, InstrumentClass } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { AssetType, ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import type {
  BrokerAdapter,
  BrokerOrder,
  BrokerOrderResult,
  BrokerPosition,
  CloseResult,
  MarketDiscoveryAdapter,
  MarketSnapshot,
  OrderStatus,
  PolymarketMarketRow,
} from "./broker-adapter";

type PolymarketCredentials = {
  privateKey: string;
  funderAddress: string;
  host?: string;
  chainId?: number;
};

type PredictionInstrumentMetadata = {
  slug?: string;
  conditionId: string;
  outcomeTokenId: string;
  category?: string;
  resolutionTime?: string;
};

export class PolymarketAdapter implements BrokerAdapter, MarketDiscoveryAdapter {
  readonly brokerType = "polymarket";
  readonly supportedInstrumentClasses = ["prediction_market"] as const satisfies readonly InstrumentClass[];
  /**
   * Launch-capable: closeOrder issues a real opposite-side order via the CLOB client.
   * getPositions returns [] (Polymarket does not expose an aggregate positions endpoint)
   * but exits are driven by individual order tracking in this app.
   */
  readonly launchCapable = true;

  private authClientPromise: Promise<ClobClient> | null = null;

  constructor(private readonly credentials: PolymarketCredentials) {}

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const client = await this.getAuthedClient();
      await client.getOk();
      const balance = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      return {
        ok: true,
        message: "Polymarket CLOB connected",
        account_balance: Number(balance.balance ?? 0),
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Unable to connect to Polymarket",
      };
    }
  }

  async getAccountBalance(): Promise<number> {
    const client = await this.getAuthedClient();
    const balance = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    return Number(balance.balance ?? 0);
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    const client = this.getReadOnlyClient();
    const conditionId = parseConditionId(instrumentSymbol);
    const market = await client.getMarket(conditionId);
    const token = pickFirstToken(market);
    return {
      instrumentSymbol,
      instrumentDisplayName: readQuestion(market),
      predictionOutcome: token?.outcome ?? null,
      price: token?.price ?? 0,
      timestamp: new Date().toISOString(),
    };
  }

  async placeOrder(order: BrokerOrder): Promise<BrokerOrderResult> {
    if (order.instrumentType !== "prediction_market") {
      throw new AppError("Polymarket adapter supports prediction markets only", "UNSUPPORTED_INSTRUMENT");
    }
    const metadata = parsePredictionMetadata(order.instrumentMetadataJson);
    const client = await this.getAuthedClient();
    const price = await this.resolveReferencePrice(client, metadata.outcomeTokenId);
    const amount = order.side === "BUY" ? order.sizeUsd : Number((order.sizeUsd / Math.max(price, 0.01)).toFixed(6));

    const response = await client.createAndPostMarketOrder(
      {
        tokenID: metadata.outcomeTokenId,
        side: order.side === "BUY" ? Side.BUY : Side.SELL,
        amount,
        price,
        orderType: OrderType.FOK,
      },
      { tickSize: await this.resolveTickSize(client, metadata.outcomeTokenId) },
      OrderType.FOK,
    );

    const brokerOrderId = extractOrderId(response);
    return {
      brokerOrderId,
      filledAvgPrice: price,
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    const client = await this.getAuthedClient();
    await client.cancelOrder({ orderID: brokerOrderId });
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return [];
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    const client = await this.getAuthedClient();
    const order = await client.getOrder(orderId);
    const matchedSize = Number(order.size_matched ?? order.original_size ?? 0);
    if (!order.asset_id || matchedSize <= 0) {
      await this.cancelOrder(orderId);
      return { brokerOrderId: orderId, realizedPnlUsd: 0 };
    }

    const price = await this.resolveReferencePrice(client, order.asset_id);
    const response = await client.createAndPostMarketOrder(
      {
        tokenID: order.asset_id,
        side: Side.SELL,
        amount: matchedSize,
        price,
        orderType: OrderType.FOK,
      },
      { tickSize: await this.resolveTickSize(client, order.asset_id) },
      OrderType.FOK,
    );

    return {
      brokerOrderId: extractOrderId(response),
      realizedPnlUsd: 0,
    };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const client = await this.getAuthedClient();
    const order = await client.getOrder(orderId);
    const status = String(order.status ?? "").toLowerCase();
    const latestPrice = order.asset_id ? await this.resolveOptionalPrice(client, order.asset_id) : null;
    const market = typeof order.market === "string" ? await this.getReadOnlyClient().getMarket(order.market).catch(() => null) : null;
    const resolutionTime = readMarketResolutionTime(market);
    const resolvedByTime = resolutionTime != null && resolutionTime.getTime() <= Date.now();
    return {
      brokerOrderId: order.id ?? orderId,
      status: status === "live" || status === "delayed" || !resolvedByTime ? "open" : "closed",
      latestPrice,
      realizedPnlUsd: null,
    };
  }

  private getReadOnlyClient(): ClobClient {
    return new ClobClient(this.credentials.host ?? "https://clob.polymarket.com", (this.credentials.chainId ?? 137) as 137, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true);
  }

  private async getAuthedClient(): Promise<ClobClient> {
    if (!this.authClientPromise) {
      this.authClientPromise = this.createAuthedClient();
    }
    return this.authClientPromise;
  }

  private async createAuthedClient(): Promise<ClobClient> {
    const privateKey = this.credentials.privateKey.trim();
    const funderAddress = this.credentials.funderAddress.trim();
    if (!privateKey || !funderAddress) {
      throw new AppError("Polymarket credentials require private key and funder address.", "BROKER_ERROR");
    }

    const walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey as `0x${string}`),
      chain: polygon,
      transport: http(),
    });
    const host = this.credentials.host ?? "https://clob.polymarket.com";
    const chainId = (this.credentials.chainId ?? 137) as 137;
    const bootstrap = new ClobClient(host, chainId, walletClient, undefined, 0, funderAddress, undefined, undefined, undefined, undefined, undefined, undefined, true);
    const creds = await bootstrap.createOrDeriveApiKey();
    return new ClobClient(host, chainId, walletClient, creds, 0, funderAddress, undefined, undefined, undefined, undefined, undefined, undefined, true);
  }

  async fetchMarketCandidates(): Promise<PolymarketMarketRow[]> {
    const response = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=25");
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as PolymarketMarketRow[];
  }

  private async resolveReferencePrice(client: ClobClient, tokenId: string): Promise<number> {
    const raw = await client.getLastTradePrice(tokenId).catch(() => null);
    // reason: SDK getLastTradePrice returns number | { price: string | number } depending on market state
    const price = typeof raw === "number" ? raw : Number((raw as { price?: string | number } | null)?.price ?? 0);
    return price > 0 ? price : 0.5;
  }

  private async resolveOptionalPrice(client: ClobClient, tokenId: string): Promise<number | null> {
    const price = await this.resolveReferencePrice(client, tokenId);
    return Number.isFinite(price) ? price : null;
  }

  private async resolveTickSize(client: ClobClient, tokenId: string): Promise<"0.1" | "0.01" | "0.001" | "0.0001"> {
    return client.getTickSize(tokenId);
  }
}

function parsePredictionMetadata(raw: string | null | undefined): PredictionInstrumentMetadata {
  if (!raw) {
    throw new AppError("Prediction-market orders require instrument metadata.", "VALIDATION_FAILED");
  }
  const parsed = JSON.parse(raw) as Partial<PredictionInstrumentMetadata>;
  if (!parsed.conditionId || !parsed.outcomeTokenId) {
    throw new AppError("Prediction-market metadata must include conditionId and outcomeTokenId.", "VALIDATION_FAILED");
  }
  return {
    conditionId: parsed.conditionId,
    outcomeTokenId: parsed.outcomeTokenId,
    slug: parsed.slug,
    category: parsed.category,
    resolutionTime: parsed.resolutionTime,
  };
}

function parseConditionId(instrumentSymbol: string): string {
  if (!instrumentSymbol.startsWith("pm:")) return instrumentSymbol;
  return instrumentSymbol.slice(3);
}

function extractOrderId(response: unknown): string {
  if (typeof response === "object" && response !== null) {
    // reason: CLOB client returns untyped JSON; field name varies by order type
    const obj = response as { orderID?: unknown; orderId?: unknown; id?: unknown };
    const candidate = obj.orderID ?? obj.orderId ?? obj.id;
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  throw new AppError("Polymarket did not return an order id.", "BROKER_ERROR");
}

function pickFirstToken(market: unknown): { outcome: "YES" | "NO" | null; price: number | null } | null {
  // reason: CLOB client returns untyped market objects; narrow before field access
  const tokens = (market as { tokens?: Array<{ outcome?: unknown; price?: unknown }> } | null)?.tokens;
  const token = Array.isArray(tokens) ? tokens[0] : null;
  if (!token) return null;
  const outcome = token.outcome === "YES" || token.outcome === "NO" ? token.outcome : null;
  const price = token.price == null ? null : Number(token.price);
  return { outcome, price };
}

function readQuestion(market: unknown): string | null {
  // reason: CLOB client returns untyped market objects; narrow before field access
  const question = (market as { question?: unknown } | null)?.question;
  return typeof question === "string" ? question : null;
}

function readMarketResolutionTime(market: unknown): Date | null {
  // reason: CLOB client returns untyped market objects; field name varies between REST endpoints
  const raw = (market as { endDate?: unknown; end_date?: unknown } | null)?.endDate
    ?? (market as { endDate?: unknown; end_date?: unknown } | null)?.end_date;
  if (typeof raw !== "string") return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
