import type { BrokerMode, ConnectionTestResult } from "@/lib/types";
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
import {
  POLYMARKET_CAPABILITIES,
  adapterSupportsOrder,
  lowerBrokerOrderV2ToV1,
  type BrokerOrderV2,
  type OrderEvent,
  type OrderEventFeed,
} from "../order-contract-v2";
import {
  GhostFillSimulator,
  type GhostQuote,
} from "../mock/ghost-fill-simulator";
import { brokerError } from "../broker-errors";
import {
  DEFAULT_PAPER_STARTING_BALANCE_USD,
  type PaperBalancesRepo,
} from "../../../db/repositories/brokers/paper-balances-repo";
import type { PaperPositionsRepo } from "../../../db/repositories/brokers/paper-positions-repo";

const logger = createLogger("polymarket-adapter");

/** Filled (or pending-metadata) ghost position keyed by ghost order id. */
type GhostPosition = {
  tokenId: string;
  conditionId: string;
  market: string | null;
  side: "BUY" | "SELL";
  sizeUsd: number;
  shares: number;
  entryPrice: number;
  /** Position still open (not closed/settled). */
  open: boolean;
  /** Order still resting in GhostFillSimulator (not filled yet). */
  resting: boolean;
  order: BrokerOrderV2;
};

export type PolymarketAdapterOptions = {
  accountId?: string;
  paperBalances?: PaperBalancesRepo;
  /**
   * Persisted ghost position store. When set alongside `accountId`, ghost
   * positions survive an adapter rebuild (app restart): an order id absent
   * from the in-memory map is rehydrated from this repo before being treated
   * as unknown/closed.
   */
  paperPositions?: PaperPositionsRepo;
  /** Starting balance when no persisted row yet (tests / ephemeral). */
  startingPaperBalanceUsd?: number;
  /** Parity-check failure hook (registry wires to supervisor). */
  onParityWarning?: (message: string, details: Record<string, unknown>) => void;
};

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
  readonly capabilities = POLYMARKET_CAPABILITIES;

  private authClientPromise: Promise<ClobClient> | null = null;
  private readonly ghosts = new GhostFillSimulator();
  private readonly ghostPositions = new Map<string, GhostPosition>();
  /** In-memory fallback when PaperBalancesRepo is not injected (unit tests). */
  private memoryPaperBalanceUsd: number;
  private readonly accountId: string | undefined;
  private readonly paperBalances: PaperBalancesRepo | undefined;
  private readonly paperPositions: PaperPositionsRepo | undefined;
  private readonly onParityWarning:
    | ((message: string, details: Record<string, unknown>) => void)
    | undefined;

  constructor(
    private readonly credentials: PolymarketCredentials,
    private readonly mode: BrokerMode = "live",
    private readonly interactionLogger?: BrokerInteractionLogger,
    options?: PolymarketAdapterOptions,
  ) {
    this.accountId = options?.accountId;
    this.paperBalances = options?.paperBalances;
    this.paperPositions = options?.paperPositions;
    this.onParityWarning = options?.onParityWarning;
    this.memoryPaperBalanceUsd =
      options?.startingPaperBalanceUsd ?? DEFAULT_PAPER_STARTING_BALANCE_USD;
  }

  /** Ghost (paper) mode: fill locally against real prices, never post to the CLOB. */
  private get isPaper(): boolean {
    return this.mode === "paper";
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (this.isPaper) {
      try {
        await this.getReadOnlyClient().getOk();
        const balance = this.readPaperBalance();
        return {
          ok: true,
          message:
            "Polymarket ghost (paper) mode — market data live, orders local",
          account_balance: balance,
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Unable to reach Polymarket market data",
        };
      }
    }
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
    if (this.isPaper) return this.readPaperBalance();
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

  async placeOrderV2(order: BrokerOrderV2): Promise<BrokerOrderResult> {
    const check = adapterSupportsOrder(this.capabilities, order);
    if (!check.ok) {
      throw new AppError(
        `Polymarket rejects order: ${check.reason}`,
        "BROKER_REJECTED",
      );
    }
    if (order.orderType === "market") {
      if (order.quantity.kind === "notional_usd") {
        return this.placeOrder(lowerBrokerOrderV2ToV1(order));
      }
      return this.placeMarketUnitsOrderV2(order);
    }
    return this.placeLimitOrderV2(order);
  }

  /**
   * Market order sized in shares (units) rather than USD notional. Polymarket's
   * FOK market order takes `amount` in USDC for a BUY but in shares for a SELL,
   * so a units BUY still needs a live price to convert shares -> USDC budget.
   */
  private async placeMarketUnitsOrderV2(
    order: BrokerOrderV2,
  ): Promise<BrokerOrderResult> {
    if (order.instrument.instrumentClass !== "prediction_market") {
      throw new AppError(
        "Polymarket adapter supports prediction markets only",
        "UNSUPPORTED_INSTRUMENT",
      );
    }
    if (!(order.quantity.value > 0)) {
      throw new AppError(
        "Polymarket market+units requires a positive units quantity.",
        "VALIDATION_FAILED",
      );
    }
    const metadata = parsePredictionMetadata(order.instrument.metadataJson);

    if (this.isPaper) {
      return this.placeGhostOrderV2(order, metadata);
    }

    const client = await this.getAuthedClient();
    const price = await this.resolveReferencePrice(
      client,
      metadata.outcomeTokenId,
    );
    const amount =
      order.side === "BUY"
        ? Number((order.quantity.value * price).toFixed(6))
        : order.quantity.value;
    const tickSize = await this.resolveTickSize(
      client,
      metadata.outcomeTokenId,
    );

    let response: unknown;
    try {
      response = await traceBrokerInteraction(
        this.interactionLogger,
        "placeOrder_submit",
        `${order.side}/${metadata.outcomeTokenId}/FOK/units${order.quantity.value}`,
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
        "polymarket placeOrderV2: createAndPostMarketOrder (units) threw",
      );
      throw err;
    }

    const brokerOrderId = extractOrderId(response);
    logger.info(
      { brokerOrderId, filledAvgPrice: price },
      "polymarket placeOrderV2: market+units order accepted",
    );
    return { brokerOrderId, filledAvgPrice: price };
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

    if (this.isPaper) {
      const v2: BrokerOrderV2 = {
        clientOrderId: order.clientOrderId,
        instrument: {
          symbol: order.instrumentSymbol,
          instrumentClass: "prediction_market",
          displayName: order.instrumentDisplayName,
          metadataJson: order.instrumentMetadataJson,
        },
        side: order.side,
        quantity: { kind: "notional_usd", value: order.sizeUsd },
        orderType: "market",
        timeInForce: "ioc",
      };
      return this.placeGhostOrderV2(v2, metadata);
    }

    const client = await this.getAuthedClient();
    const price = await this.resolveReferencePrice(
      client,
      metadata.outcomeTokenId,
    );
    const amount =
      order.side === "BUY"
        ? order.sizeUsd
        : Number((order.sizeUsd / Math.max(price, 0.01)).toFixed(6));

    const tickSize = await this.resolveTickSize(
      client,
      metadata.outcomeTokenId,
    );

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

  /**
   * Ghost fill via shared GhostFillSimulator. Market → mid; limits rest until
   * marketable. Debits persisted paper balance on fill. Never posts to CLOB.
   */
  private async placeGhostOrderV2(
    order: BrokerOrderV2,
    metadata: PredictionInstrumentMetadata,
  ): Promise<BrokerOrderResult> {
    const readClient = this.getReadOnlyClient();
    const quote = await this.resolveGhostQuote(
      readClient,
      metadata.outcomeTokenId,
    );
    await this.runParityCheck(metadata);

    const receipt = this.ghosts.simulateFill(order, quote);
    const brokerOrderId = receipt.ghostOrderId;

    if (receipt.status === "filled" && receipt.filledAvgPrice != null) {
      const sizeUsd = receipt.filledQty * receipt.filledAvgPrice;
      if (order.side === "BUY") this.debitPaper(sizeUsd);
      this.setGhostPosition(brokerOrderId, {
        tokenId: metadata.outcomeTokenId,
        conditionId: metadata.conditionId,
        market: metadata.conditionId,
        side: order.side,
        sizeUsd,
        shares: receipt.filledQty,
        entryPrice: receipt.filledAvgPrice,
        open: true,
        resting: false,
        order,
      });
      logger.info(
        {
          brokerOrderId,
          filledAvgPrice: receipt.filledAvgPrice,
          paperBalanceUsd: this.readPaperBalance(),
        },
        "polymarket ghost: order filled locally",
      );
      return {
        brokerOrderId,
        filledAvgPrice: receipt.filledAvgPrice,
        filledSizeUsd: sizeUsd,
      };
    }

    // Resting limit — no debit until fill on poll.
    const estPrice = order.limitPrice ?? quote.last;
    const estQty =
      order.quantity.kind === "units"
        ? order.quantity.value
        : order.quantity.value / Math.max(estPrice, 0.01);
    this.setGhostPosition(brokerOrderId, {
      tokenId: metadata.outcomeTokenId,
      conditionId: metadata.conditionId,
      market: metadata.conditionId,
      side: order.side,
      sizeUsd: estQty * estPrice,
      shares: estQty,
      entryPrice: estPrice,
      open: true,
      resting: true,
      order,
    });
    logger.info(
      { brokerOrderId, limitPrice: order.limitPrice },
      "polymarket ghost: resting limit waiting for marketable quote",
    );
    return {
      brokerOrderId,
      filledAvgPrice: order.limitPrice ?? 0,
    };
  }

  private async placeLimitOrderV2(
    order: BrokerOrderV2,
  ): Promise<BrokerOrderResult> {
    const limitPrice = order.limitPrice;
    if (limitPrice == null || !(limitPrice > 0)) {
      throw new AppError(
        "Polymarket limit order requires a positive limitPrice.",
        "VALIDATION_FAILED",
      );
    }
    if (order.instrument.instrumentClass !== "prediction_market") {
      throw new AppError(
        "Polymarket adapter supports prediction markets only",
        "UNSUPPORTED_INSTRUMENT",
      );
    }
    const metadata = parsePredictionMetadata(order.instrument.metadataJson);

    if (this.isPaper) {
      return this.placeGhostOrderV2(order, metadata);
    }

    const sizeShares = resolveLimitSizeShares(order);
    const client = await this.getAuthedClient();
    const tickSize = await this.resolveTickSize(
      client,
      metadata.outcomeTokenId,
    );
    let response: unknown;
    try {
      response = await traceBrokerInteraction(
        this.interactionLogger,
        "placeOrder_submit",
        `${order.side}/${metadata.outcomeTokenId}/GTC/limit/${limitPrice}/sz${sizeShares}`,
        () =>
          client.createAndPostOrder(
            {
              tokenID: metadata.outcomeTokenId,
              price: limitPrice,
              size: sizeShares,
              side: order.side === "BUY" ? Side.BUY : Side.SELL,
            },
            { tickSize },
            OrderType.GTC,
          ),
      );
    } catch (err) {
      logger.error(
        {
          err,
          tokenId: metadata.outcomeTokenId,
          side: order.side,
          limitPrice,
          sizeShares,
        },
        "polymarket placeOrderV2: createAndPostOrder (GTC limit) threw",
      );
      throw err;
    }

    const brokerOrderId = extractOrderId(response);
    logger.info(
      { brokerOrderId, limitPrice },
      "polymarket placeOrderV2: GTC limit posted",
    );
    return { brokerOrderId, filledAvgPrice: limitPrice };
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    if (this.isPaper) {
      this.rehydrateGhostPosition(brokerOrderId);
      const canceled = this.ghosts.cancel(brokerOrderId);
      const pos = this.ghostPositions.get(brokerOrderId);
      if (pos?.resting) {
        pos.open = false;
        pos.resting = false;
        this.persistGhostPosition(brokerOrderId, pos);
      } else if (canceled?.status === "canceled") {
        this.ghostPositions.delete(brokerOrderId);
        this.paperPositions?.setClosed(brokerOrderId);
      }
      return;
    }
    logger.info({ brokerOrderId }, "polymarket cancelOrder: cancelling order");
    const client = await this.getAuthedClient();
    await traceBrokerInteraction(
      this.interactionLogger,
      "cancelOrder_submit",
      brokerOrderId,
      () => client.cancelOrder({ orderID: brokerOrderId }),
    );
  }

  /** Resting ghost limits (paper) or empty for immediate-fill ghosts. */
  async getOpenOrders(): Promise<
    Array<{
      brokerOrderId: string;
      clientOrderId: string;
      status: "open";
      remainingQty: number;
    }>
  > {
    if (!this.isPaper) return [];
    return this.ghosts.listOpen().map((r) => ({
      brokerOrderId: r.ghostOrderId,
      clientOrderId: r.clientOrderId,
      status: "open" as const,
      remainingQty: r.remainingQty,
    }));
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return [];
  }

  async closeOrder(orderId: string): Promise<CloseResult> {
    if (this.isPaper) return this.closeGhostOrder(orderId);
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

  /**
   * Settle a ghost position: prefer real gamma resolution price (0 or 1),
   * else mark-to-market at last trade. Credits paper balance with proceeds.
   */
  private async closeGhostOrder(orderId: string): Promise<CloseResult> {
    this.rehydrateGhostPosition(orderId);
    await this.promoteRestingIfFilled(orderId);
    const ghost = this.ghostPositions.get(orderId);
    if (!ghost || !ghost.open || ghost.resting) {
      return { brokerOrderId: orderId, realizedPnlUsd: 0 };
    }
    const readClient = this.getReadOnlyClient();
    const market = ghost.market
      ? await readClient.getMarket(ghost.market).catch(() => null)
      : null;
    const settlement = readResolutionSettlement(market, ghost.tokenId);
    const exitPrice =
      settlement.settlementPrice ??
      (await this.resolveReferencePrice(readClient, ghost.tokenId));
    const proceeds = ghost.shares * exitPrice;
    const realizedPnlUsd = proceeds - ghost.sizeUsd;
    this.creditPaper(proceeds);
    ghost.open = false;
    this.paperPositions?.setClosed(orderId);
    logger.info(
      {
        orderId,
        exitPrice,
        resolved: settlement.resolved,
        realizedPnlUsd,
        paperBalanceUsd: this.readPaperBalance(),
      },
      "polymarket ghost: position closed locally",
    );
    return { brokerOrderId: orderId, realizedPnlUsd };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    if (this.isPaper) return this.getGhostOrderStatus(orderId);
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

  /**
   * Ghost status: resting limits re-check quotes; filled positions stay open
   * until real resolution (or forced close). Auto-settles on resolution.
   */
  private async getGhostOrderStatus(orderId: string): Promise<OrderStatus> {
    const sim = this.ghosts.get(orderId);
    if (sim?.status === "canceled") {
      return {
        brokerOrderId: orderId,
        status: "closed",
        latestPrice: null,
        realizedPnlUsd: null,
      };
    }

    this.rehydrateGhostPosition(orderId);
    await this.promoteRestingIfFilled(orderId);

    const ghost = this.ghostPositions.get(orderId);
    if (!ghost) {
      return {
        brokerOrderId: orderId,
        status: "closed",
        latestPrice: null,
        realizedPnlUsd: null,
      };
    }

    if (ghost.resting) {
      return {
        brokerOrderId: orderId,
        status: "open",
        latestPrice: null,
        realizedPnlUsd: null,
      };
    }

    if (!ghost.open) {
      return {
        brokerOrderId: orderId,
        status: "closed",
        latestPrice: ghost.entryPrice,
        realizedPnlUsd: null,
      };
    }

    const readClient = this.getReadOnlyClient();
    const market = ghost.market
      ? await readClient.getMarket(ghost.market).catch(() => null)
      : null;
    const settlement = readResolutionSettlement(market, ghost.tokenId);

    if (settlement.resolved) {
      const closed = await this.closeGhostOrder(orderId);
      return {
        brokerOrderId: orderId,
        status: "closed",
        latestPrice: settlement.settlementPrice,
        realizedPnlUsd: closed.realizedPnlUsd,
      };
    }

    const latestPrice = await this.resolveOptionalPrice(
      readClient,
      ghost.tokenId,
    );
    return {
      brokerOrderId: orderId,
      status: "open",
      latestPrice,
      realizedPnlUsd: null,
    };
  }

  /** Re-check resting ghost against fresh quote; debit paper on fill. */
  private async promoteRestingIfFilled(orderId: string): Promise<void> {
    const pos = this.ghostPositions.get(orderId);
    if (!pos?.resting) return;
    const quote = await this.resolveGhostQuote(
      this.getReadOnlyClient(),
      pos.tokenId,
    );
    const receipt = this.ghosts.poll(orderId, quote);
    if (receipt?.status !== "filled" || receipt.filledAvgPrice == null) return;
    const sizeUsd = receipt.filledQty * receipt.filledAvgPrice;
    if (pos.side === "BUY") this.debitPaper(sizeUsd);
    pos.resting = false;
    pos.shares = receipt.filledQty;
    pos.entryPrice = receipt.filledAvgPrice;
    pos.sizeUsd = sizeUsd;
    pos.open = true;
    this.persistGhostPosition(orderId, pos);
    logger.info(
      {
        brokerOrderId: orderId,
        filledAvgPrice: receipt.filledAvgPrice,
        paperBalanceUsd: this.readPaperBalance(),
      },
      "polymarket ghost: resting limit filled on quote cross",
    );
  }

  /**
   * Rehydrate a ghost position from the persisted repo when the in-memory
   * map lost it (adapter rebuilt after a restart). Also re-seeds a still-
   * resting order into `this.ghosts` (purely in-memory) with its original
   * orderType/limitPrice/quantity, so a later quote cross is detected and
   * debited after the restart too — otherwise a fresh GhostFillSimulator has
   * no record of the order and treats every poll as a no-op forever. No-op
   * when the position is already tracked in memory, or when persistence
   * isn't configured.
   */
  private rehydrateGhostPosition(orderId: string): void {
    if (this.ghostPositions.has(orderId)) return;
    if (!this.paperPositions) return;
    const row = this.paperPositions.get(orderId);
    if (!row || !row.open) return;
    const metadata = row.metadata as {
      tokenId?: string;
      conditionId?: string;
      orderType?: BrokerOrderV2["orderType"];
      limitPrice?: number;
      stopPrice?: number;
      timeInForce?: BrokerOrderV2["timeInForce"];
      quantityKind?: "units" | "notional_usd";
      quantityValue?: number;
    };
    const tokenId = metadata.tokenId ?? "";
    const conditionId = metadata.conditionId ?? null;
    const order: BrokerOrderV2 = {
      clientOrderId: orderId,
      instrument: {
        symbol: row.instrumentSymbol,
        instrumentClass: "prediction_market",
      },
      side: row.side,
      quantity: {
        kind: metadata.quantityKind ?? "units",
        value: metadata.quantityValue ?? row.shares,
      },
      orderType: metadata.orderType ?? "market",
      timeInForce: metadata.timeInForce ?? "ioc",
      limitPrice: metadata.limitPrice,
      stopPrice: metadata.stopPrice,
    };
    this.ghostPositions.set(orderId, {
      tokenId,
      conditionId: conditionId ?? "",
      market: conditionId,
      side: row.side,
      sizeUsd: row.sizeUsd,
      shares: row.shares,
      entryPrice: row.entryPrice,
      open: row.open,
      resting: row.resting,
      order,
    });
    if (row.resting) this.ghosts.restoreResting(orderId, order, row.shares);
    logger.info(
      { brokerOrderId: orderId, resting: row.resting },
      "polymarket ghost: position rehydrated from persisted store after restart",
    );
  }

  /** Write-through: update in-memory map and (when configured) persist. */
  private setGhostPosition(orderId: string, position: GhostPosition): void {
    this.ghostPositions.set(orderId, position);
    this.persistGhostPosition(orderId, position);
  }

  private persistGhostPosition(orderId: string, position: GhostPosition): void {
    if (!this.paperPositions || !this.accountId) return;
    this.paperPositions.upsert({
      brokerOrderId: orderId,
      accountId: this.accountId,
      venue: "polymarket",
      instrumentSymbol: position.market
        ? `pm:${position.market}`
        : position.tokenId,
      side: position.side,
      shares: position.shares,
      entryPrice: position.entryPrice,
      sizeUsd: position.sizeUsd,
      open: position.open,
      resting: position.resting,
      metadata: {
        tokenId: position.tokenId,
        conditionId: position.conditionId,
        orderType: position.order.orderType,
        limitPrice: position.order.limitPrice,
        stopPrice: position.order.stopPrice,
        timeInForce: position.order.timeInForce,
        quantityKind: position.order.quantity.kind,
        quantityValue: position.order.quantity.value,
      },
    });
  }

  createOrderEventFeed(): OrderEventFeed {
    const handlers = new Set<(event: OrderEvent) => void>();
    const watched = new Set<string>();
    const fillEmitted = new Set<string>();
    const terminalEmitted = new Set<string>();
    let timer: ReturnType<typeof setInterval> | null = null;
    let polling = false;

    const emit = (event: OrderEvent): void => {
      for (const h of handlers) h(event);
    };

    const tick = async (): Promise<void> => {
      if (polling || watched.size === 0) return;
      polling = true;
      try {
        for (const orderId of [...watched]) {
          if (terminalEmitted.has(orderId)) {
            watched.delete(orderId);
            continue;
          }
          const before = this.ghostPositions.get(orderId);
          const wasResting = before?.resting === true;
          let status: OrderStatus;
          try {
            status = await this.getOrderStatus(orderId);
          } catch {
            continue;
          }
          const after = this.ghostPositions.get(orderId);
          if (
            wasResting &&
            after &&
            !after.resting &&
            !fillEmitted.has(orderId)
          ) {
            fillEmitted.add(orderId);
            emit({
              brokerOrderId: orderId,
              clientOrderId: after.order.clientOrderId,
              kind: "fill",
              ts: new Date().toISOString(),
              filledAvgPrice: after.entryPrice,
              filledQty: after.shares,
              remainingQty: 0,
            });
          }
          if (status.status === "closed") {
            terminalEmitted.add(orderId);
            watched.delete(orderId);
            const sim = this.ghosts.get(orderId);
            emit({
              brokerOrderId: orderId,
              kind: sim?.status === "canceled" ? "canceled" : "fill",
              ts: new Date().toISOString(),
              filledAvgPrice: status.latestPrice ?? undefined,
              realizedPnlUsd: status.realizedPnlUsd ?? undefined,
            });
          }
        }
      } finally {
        polling = false;
      }
    };

    return {
      async start() {
        if (timer) return;
        timer = setInterval(() => {
          void tick();
        }, 2_000);
        void tick();
      },
      async stop() {
        if (timer) clearInterval(timer);
        timer = null;
        handlers.clear();
        watched.clear();
      },
      onEvent(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      watchOrders(orderIds) {
        for (const id of orderIds) {
          if (!terminalEmitted.has(id)) watched.add(id);
        }
        if (!timer && watched.size > 0) {
          timer = setInterval(() => {
            void tick();
          }, 2_000);
          void tick();
        }
      },
    };
  }

  private readPaperBalance(): number {
    if (this.paperBalances && this.accountId) {
      return this.paperBalances.getBalance(this.accountId);
    }
    return this.memoryPaperBalanceUsd;
  }

  private debitPaper(amount: number): void {
    if (this.paperBalances && this.accountId) {
      this.paperBalances.debit(this.accountId, amount);
      return;
    }
    if (this.memoryPaperBalanceUsd < amount) {
      throw brokerError(
        "BROKER_INSUFFICIENT_FUNDS",
        `Insufficient paper balance: need $${amount.toFixed(2)}, have $${this.memoryPaperBalanceUsd.toFixed(2)}.`,
        { need: amount, have: this.memoryPaperBalanceUsd },
      );
    }
    this.memoryPaperBalanceUsd -= amount;
  }

  private creditPaper(amount: number): void {
    if (this.paperBalances && this.accountId) {
      this.paperBalances.credit(this.accountId, amount);
      return;
    }
    this.memoryPaperBalanceUsd += amount;
  }

  private async resolveGhostQuote(
    client: ClobClient,
    tokenId: string,
  ): Promise<GhostQuote> {
    const last = await this.resolveReferencePrice(client, tokenId);
    // Polymarket CLOB last-trade is the primary free quote; use a 1c band around mid.
    const half = 0.005;
    return {
      bid: Math.max(0.01, last - half),
      ask: Math.min(0.99, last + half),
      last,
    };
  }

  private async runParityCheck(
    metadata: PredictionInstrumentMetadata,
  ): Promise<void> {
    try {
      const url = `https://gamma-api.polymarket.com/markets?condition_ids=${encodeURIComponent(metadata.conditionId)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const message = `Polymarket parity check failed: gamma-api HTTP ${res.status}`;
        logger.warn(
          { conditionId: metadata.conditionId, status: res.status },
          message,
        );
        this.onParityWarning?.(message, {
          conditionId: metadata.conditionId,
          status: res.status,
        });
        return;
      }
      const rows = (await res.json()) as unknown;
      const markets = Array.isArray(rows) ? rows : [];
      const market = markets[0] as Record<string, unknown> | undefined;
      if (!market) {
        const message = `Polymarket parity check failed: market ${metadata.conditionId} not found on gamma-api`;
        logger.warn({ conditionId: metadata.conditionId }, message);
        this.onParityWarning?.(message, {
          conditionId: metadata.conditionId,
        });
        return;
      }
      const closed = Boolean(market.closed);
      const settlement = readResolutionSettlement(
        market,
        metadata.outcomeTokenId,
      );
      if (closed && settlement.resolved) {
        const message = `Polymarket parity check: market ${metadata.conditionId} already resolved — ghost trade may be incoherent`;
        logger.warn({ conditionId: metadata.conditionId }, message);
        this.onParityWarning?.(message, {
          conditionId: metadata.conditionId,
          closed: true,
        });
      }
    } catch (err) {
      const message = `Polymarket parity check failed: gamma-api unreachable (${err instanceof Error ? err.message : String(err)})`;
      logger.warn({ err, conditionId: metadata.conditionId }, message);
      this.onParityWarning?.(message, {
        conditionId: metadata.conditionId,
      });
    }
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

function resolveLimitSizeShares(order: BrokerOrderV2): number {
  if (order.quantity.kind === "units") {
    if (!(order.quantity.value > 0)) {
      throw new AppError(
        "Polymarket limit+units requires a positive size.",
        "VALIDATION_FAILED",
      );
    }
    return order.quantity.value;
  }
  const limitPrice = order.limitPrice ?? 0;
  if (!(limitPrice > 0) || !(order.quantity.value > 0)) {
    throw new AppError(
      "Polymarket limit+notional requires positive notional and limitPrice.",
      "VALIDATION_FAILED",
    );
  }
  return Number((order.quantity.value / limitPrice).toFixed(6));
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

/**
 * Read real resolution settlement for a ghost position's outcome token.
 * Only settles when the market is closed (or a token is explicitly marked
 * winner). Extreme prices alone on an open market are not enough.
 */
export function readResolutionSettlement(
  market: unknown,
  outcomeTokenId: string,
): { resolved: boolean; settlementPrice: number | null } {
  if (!market || typeof market !== "object") {
    return { resolved: false, settlementPrice: null };
  }
  const m = market as {
    closed?: unknown;
    tokens?: Array<{
      token_id?: unknown;
      tokenId?: unknown;
      outcome?: unknown;
      winner?: unknown;
      price?: unknown;
    }>;
  };
  const tokens = Array.isArray(m.tokens) ? m.tokens : [];
  const token = tokens.find((t) => {
    const id = String(t.token_id ?? t.tokenId ?? "");
    return id === outcomeTokenId;
  });
  const closed = m.closed === true;
  // Winner flags are authoritative only once the market is closed.
  if (closed && token?.winner === true) {
    return { resolved: true, settlementPrice: 1 };
  }
  if (closed && token?.winner === false) {
    return { resolved: true, settlementPrice: 0 };
  }
  if (closed && tokens.some((t) => t.winner === true) && token) {
    return { resolved: true, settlementPrice: 0 };
  }
  if (closed && token?.price != null) {
    const p = Number(token.price);
    if (Number.isFinite(p) && p >= 0.99) {
      return { resolved: true, settlementPrice: 1 };
    }
    if (Number.isFinite(p) && p <= 0.01) {
      return { resolved: true, settlementPrice: 0 };
    }
  }
  return { resolved: false, settlementPrice: null };
}
