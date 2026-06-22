import type { ConnectionTestResult } from "@/lib/types";
import { BROKER_SUPPORTED_INSTRUMENT_CLASSES } from "@electron/shared/domain/broker-capabilities";
import { AppError } from "@electron/shared/infra/errors";
import type { BrokerInteractionLogger } from "../broker-interaction-logger";
import { traceBrokerInteraction } from "../broker-interaction-logger";
import { createLogger } from "../../infra/log";
import {
  AssetType,
  ClobClient,
  OrderType,
  Side,
} from "@polymarket/clob-client";
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

const logger = createLogger("polymarket-adapter");

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

export class PolymarketAdapter
  implements BrokerAdapter, MarketDiscoveryAdapter
{
  readonly brokerType = "polymarket";
  readonly supportedInstrumentClasses =
    BROKER_SUPPORTED_INSTRUMENT_CLASSES.polymarket;
  /**
   * Launch-capable: closeOrder issues a real opposite-side order via the CLOB client.
   * getPositions returns [] (Polymarket does not expose an aggregate positions endpoint)
   * but exits are driven by individual order tracking in this app.
   */
  readonly launchCapable = true;

  private authClientPromise: Promise<ClobClient> | null = null;

  constructor(
    private readonly credentials: PolymarketCredentials,
    private readonly interactionLogger?: BrokerInteractionLogger,
  ) {}

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const client = await this.getAuthedClient();
      await client.getOk();
      const balance = await client.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });
      return {
        ok: true,
        message: "Polymarket CLOB connected",
        account_balance: Number(balance.balance ?? 0),
      };
    } catch (error) {
      logger.error({ err: error }, "polymarket testConnection: failed");
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to connect to Polymarket",
      };
    }
  }

  async getAccountBalance(): Promise<number> {
    logger.debug("polymarket getAccountBalance: fetching balance");
    const client = await this.getAuthedClient();
    const balance = await client.getBalanceAllowance({
      asset_type: AssetType.COLLATERAL,
    });
    return Number(balance.balance ?? 0);
  }

  async getMarketSnapshot(instrumentSymbol: string): Promise<MarketSnapshot> {
    logger.debug(
      { instrumentSymbol },
      "polymarket getMarketSnapshot: fetching",
    );
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
    logger.info(
      {
        instrumentSymbol: order.instrumentSymbol,
        side: order.side,
        sizeUsd: order.sizeUsd,
        instrumentType: order.instrumentType,
      },
      "polymarket placeOrder: submitting order",
    );
    if (order.instrumentType !== "prediction_market") {
      const err = new AppError(
        "Polymarket adapter supports prediction markets only",
        "UNSUPPORTED_INSTRUMENT",
      );
      logger.error(
        { err, instrumentType: order.instrumentType },
        "polymarket placeOrder: unsupported instrument type",
      );
      throw err;
    }
    const metadata = parsePredictionMetadata(order.instrumentMetadataJson);
    const client = await this.getAuthedClient();
    const price = await this.resolveReferencePrice(
      client,
      metadata.outcomeTokenId,
    );
    const amount =
      order.side === "BUY"
        ? order.sizeUsd
        : Number((order.sizeUsd / Math.max(price, 0.01)).toFixed(6));

    const tickSize = await this.resolveTickSize(client, metadata.outcomeTokenId);

    let response: unknown;
    try {
      response = await traceBrokerInteraction(
        this.interactionLogger,
        "placeOrder_submit",
        `${order.side}/${metadata.outcomeTokenId}/FOK/$${order.sizeUsd.toFixed(2)}`,
        () =>
          client.createAndPostMarketOrder(
            {
              tokenID: metadata.outcomeTokenId,
              side: order.side === "BUY" ? Side.BUY : Side.SELL,
              amount,
              price,
              orderType: OrderType.FOK,
            },
            { tickSize },
            OrderType.FOK,
          ),
      );
    } catch (err) {
      logger.error(
        {
          err,
          tokenId: metadata.outcomeTokenId,
          side: order.side,
          amount,
          price,
        },
        "polymarket placeOrder: createAndPostMarketOrder threw",
      );
      throw err;
    }

    const brokerOrderId = extractOrderId(response);
    logger.info(
      { brokerOrderId, filledAvgPrice: price },
      "polymarket placeOrder: order accepted",
    );
    return {
      brokerOrderId,
      filledAvgPrice: price,
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    logger.info({ brokerOrderId }, "polymarket cancelOrder: cancelling order");
    const client = await this.getAuthedClient();
    await traceBrokerInteraction(
      this.interactionLogger,
      "cancelOrder_submit",
      brokerOrderId,
      () => client.cancelOrder({ orderID: brokerOrderId }),
    );
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return [];
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    logger.info({ orderId }, "polymarket closeOrder: closing order");
    const client = await this.getAuthedClient();
    const order = await client.getOrder(orderId);
    const matchedSize = Number(order.size_matched ?? order.original_size ?? 0);
    if (!order.asset_id || matchedSize <= 0) {
      logger.info(
        { orderId, matchedSize },
        "polymarket closeOrder: nothing matched; cancelling only",
      );
      await this.cancelOrder(orderId);
      return { brokerOrderId: orderId, realizedPnlUsd: 0 };
    }

    const price = await this.resolveReferencePrice(client, order.asset_id);
    const tickSize = await this.resolveTickSize(client, order.asset_id);
    let response: unknown;
    try {
      response = await traceBrokerInteraction(
        this.interactionLogger,
        "closeOrder_submit",
        `SELL/${order.asset_id}/${matchedSize}`,
        () =>
          client.createAndPostMarketOrder(
            {
              tokenID: order.asset_id,
              side: Side.SELL,
              amount: matchedSize,
              price,
              orderType: OrderType.FOK,
            },
            { tickSize },
            OrderType.FOK,
          ),
      );
    } catch (err) {
      logger.error(
        { err, orderId, tokenId: order.asset_id, matchedSize, price },
        "polymarket closeOrder: closing order threw",
      );
      throw err;
    }

    const brokerOrderId = extractOrderId(response);
    logger.info(
      { orderId, closeOrderId: brokerOrderId },
      "polymarket closeOrder: close order placed",
    );
    return {
      brokerOrderId,
      realizedPnlUsd: 0,
    };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    logger.debug({ orderId }, "polymarket getOrderStatus: fetching");
    const client = await this.getAuthedClient();
    const order = await client.getOrder(orderId);
    const status = String(order.status ?? "").toLowerCase();
    const latestPrice = order.asset_id
      ? await this.resolveOptionalPrice(client, order.asset_id)
      : null;
    const market =
      typeof order.market === "string"
        ? await this.getReadOnlyClient()
            .getMarket(order.market)
            .catch(() => null)
        : null;
    const resolutionTime = readMarketResolutionTime(market);
    const resolvedByTime =
      resolutionTime != null && resolutionTime.getTime() <= Date.now();
    return {
      brokerOrderId: order.id ?? orderId,
      status:
        status === "live" || status === "delayed" || !resolvedByTime
          ? "open"
          : "closed",
      latestPrice,
      realizedPnlUsd: null,
    };
  }

  private getReadOnlyClient(): ClobClient {
    return new ClobClient(
      this.credentials.host ?? "https://clob.polymarket.com",
      (this.credentials.chainId ?? 137) as 137,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
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
      const err = new AppError(
        "Polymarket credentials require private key and funder address.",
        "BROKER_ERROR",
      );
      logger.error(
        { err },
        "polymarket: missing private key or funder address",
      );
      throw err;
    }

    const walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey as `0x${string}`),
      chain: polygon,
      transport: http(),
    });
    const host = this.credentials.host ?? "https://clob.polymarket.com";
    const chainId = (this.credentials.chainId ?? 137) as 137;
    const bootstrap = new ClobClient(
      host,
      chainId,
      walletClient,
      undefined,
      0,
      funderAddress,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    const creds = await bootstrap.createOrDeriveApiKey();
    return new ClobClient(
      host,
      chainId,
      walletClient,
      creds,
      0,
      funderAddress,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
  }

  async fetchMarketCandidates(): Promise<PolymarketMarketRow[]> {
    const response = await fetch(
      "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=25",
    );
    logger.debug("polymarket: fetching market candidates");
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "polymarket: market candidates fetch failed",
      );
      return [];
    }
    return (await response.json()) as PolymarketMarketRow[];
  }

  private async resolveReferencePrice(
    client: ClobClient,
    tokenId: string,
  ): Promise<number> {
    const raw = await client
      .getLastTradePrice(tokenId)
      .catch((err: unknown) => {
        logger.warn(
          { err, tokenId },
          "polymarket: could not fetch last trade price; defaulting to 0.5",
        );
        return null;
      });
    // reason: SDK getLastTradePrice returns number | { price: string | number } depending on market state
    const price =
      typeof raw === "number"
        ? raw
        : Number((raw as { price?: string | number } | null)?.price ?? 0);
    return price > 0 ? price : 0.5;
  }

  private async resolveOptionalPrice(
    client: ClobClient,
    tokenId: string,
  ): Promise<number | null> {
    const price = await this.resolveReferencePrice(client, tokenId);
    return Number.isFinite(price) ? price : null;
  }

  private async resolveTickSize(
    client: ClobClient,
    tokenId: string,
  ): Promise<"0.1" | "0.01" | "0.001" | "0.0001"> {
    return client.getTickSize(tokenId);
  }
}

function parsePredictionMetadata(
  raw: string | null | undefined,
): PredictionInstrumentMetadata {
  if (!raw) {
    const err = new AppError(
      "Prediction-market orders require instrument metadata.",
      "VALIDATION_FAILED",
    );
    logger.error({ err }, "polymarket: order missing instrument metadata");
    throw err;
  }
  const parsed = JSON.parse(raw) as Partial<PredictionInstrumentMetadata>;
  if (!parsed.conditionId || !parsed.outcomeTokenId) {
    const err = new AppError(
      "Prediction-market metadata must include conditionId and outcomeTokenId.",
      "VALIDATION_FAILED",
    );
    logger.error(
      {
        err,
        conditionId: parsed.conditionId,
        outcomeTokenId: parsed.outcomeTokenId,
      },
      "polymarket: incomplete prediction metadata",
    );
    throw err;
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
    const obj = response as {
      orderID?: unknown;
      orderId?: unknown;
      id?: unknown;
    };
    const candidate = obj.orderID ?? obj.orderId ?? obj.id;
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  const err = new AppError(
    "Polymarket did not return an order id.",
    "BROKER_ERROR",
  );
  logger.error(
    { err, response },
    "polymarket: order response missing order id",
  );
  throw err;
}

function pickFirstToken(
  market: unknown,
): { outcome: "YES" | "NO" | null; price: number | null } | null {
  // reason: CLOB client returns untyped market objects; narrow before field access
  const tokens = (
    market as { tokens?: Array<{ outcome?: unknown; price?: unknown }> } | null
  )?.tokens;
  const token = Array.isArray(tokens) ? tokens[0] : null;
  if (!token) return null;
  const outcome =
    token.outcome === "YES" || token.outcome === "NO" ? token.outcome : null;
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
  const raw =
    (market as { endDate?: unknown; end_date?: unknown } | null)?.endDate ??
    (market as { endDate?: unknown; end_date?: unknown } | null)?.end_date;
  if (typeof raw !== "string") return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
