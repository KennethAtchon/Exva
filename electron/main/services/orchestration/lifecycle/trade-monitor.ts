import type { StatsRepo } from "../../../db/repositories/system/stats-repo";
import type { TradesRepo } from "../../../db/repositories/trades/trades-repo";
import type { SessionStrategyContextService } from "../../session/session-strategy-context-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import type { EventBus } from "../../infra/event-bus";
import { createLogger } from "../../infra/log";
import type { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import type { CapitalReservationService } from "../../risk/capital-reservation-service";
import type { HoldingStyle, InstrumentClass } from "@/lib/types";
import type { InstrumentNormalizer } from "../../broker/instrument-normalizer";
import { ExitPolicyEvaluator } from "../../risk/exit-policy-evaluator";
import {
  computeExecutionCostUsd,
  computeMfeMaeUsd,
  computeTimeToLevelMs,
  estimateBorrowUsd,
  estimateCommissionUsd,
} from "@electron/shared/instruments/trade-exit-analytics";
import { runWithProviderCallScopeAsync } from "../../infra/provider-call-log";
import { createPollOrderEventFeed } from "../../broker/order-event-feed";
import type {
  OrderEvent,
  OrderEventFeed,
} from "../../broker/order-contract-v2";

const logger = createLogger("trade-monitor");

const POLL_INTERVAL_MS: Record<HoldingStyle, number> = {
  multi_day_swing: 60_000,
  weeks_position: 300_000,
  custom: 300_000,
};

/** Fast poll for 15m/30m primary bars — prompt stop/TP reaction (audit §8.2). */
const INTRADAY_POLL_MS = 15_000;

export const MOCK_POLL_INTERVAL_MS = 10_000;

export class TradeMonitor {
  private timer: NodeJS.Timeout | null = null;
  private pollIntervalMs = POLL_INTERVAL_MS.multi_day_swing;
  private readonly exitEvaluator = new ExitPolicyEvaluator();
  /** Optional order-event feeds keyed by broker account (stream or poll). */
  private readonly orderFeeds = new Map<string, OrderEventFeed>();
  /** Accounts that already have an onEvent handler registered (avoid duplicates). */
  private readonly feedHandlerUnsubs = new Map<string, () => void>();
  /** Optional hook when a streaming order feed falls back to poll. */
  private onFeedDegraded: ((reason: string) => void) | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly tradesRepo: TradesRepo,
    private readonly statsRepo: StatsRepo,
    private readonly sessionRepo: SessionRepo,
    private readonly brokerRegistry: BrokerRegistry,
    private readonly strategyContextService: SessionStrategyContextService,
    private readonly capitalReservation: CapitalReservationService,
    private readonly portfolioValue: () => number,
    private readonly eventBus: EventBus,
    private readonly getMaxAiSpendUsd: () => number,
    private readonly uptimeMin: () => number = () => 0,
    private readonly instrumentNormalizer?: InstrumentNormalizer,
    private readonly overridePollIntervalMs?: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.pollIntervalMs = this.resolvePollIntervalMs();
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  /** Wire supervisor (or tests) to hear websocket→poll fallbacks. */
  setFeedDegradedHandler(handler: (reason: string) => void): void {
    this.onFeedDegraded = handler;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const unsub of this.feedHandlerUnsubs.values()) unsub();
    this.feedHandlerUnsubs.clear();
    for (const feed of this.orderFeeds.values()) {
      void feed.stop();
    }
    this.orderFeeds.clear();
  }

  /**
   * Prefer adapter streaming feed when available; otherwise poll getOrderStatus.
   * Complements the snapshot poll loop (does not replace it yet).
   */
  async ensureOrderEventFeed(
    brokerAccountId: string,
    orderIds: readonly string[],
  ): Promise<OrderEventFeed> {
    const existing = this.orderFeeds.get(brokerAccountId);
    if (existing) {
      existing.watchOrders?.(orderIds);
      return existing;
    }
    const adapter = await this.brokerRegistry.get(brokerAccountId);
    const feed =
      adapter.createOrderEventFeed?.({
        onFallbackToPoll: (reason) => {
          logger.error(
            { sessionId: this.sessionId, brokerAccountId, reason },
            "order event websocket fell back to poll",
          );
          this.onFeedDegraded?.(reason);
          this.eventBus.emit("notification", {
            title: "Order feed degraded",
            body: `Websocket order feed fell back to poll (${brokerAccountId}): ${reason}`,
            level: "WARN",
          });
        },
      }) ?? createPollOrderEventFeed(adapter, orderIds, this.pollIntervalMs);
    feed.watchOrders?.(orderIds);
    this.orderFeeds.set(brokerAccountId, feed);
    await feed.start();
    return feed;
  }

  private async syncOrderEventFeeds(
    openTrades: ReturnType<TradesRepo["listOpenAndPending"]>,
  ): Promise<void> {
    const byAccount = new Map<string, string[]>();
    for (const trade of openTrades) {
      if (!trade.brokerAccountId || !trade.broker_order_id) continue;
      const list = byAccount.get(trade.brokerAccountId) ?? [];
      list.push(trade.broker_order_id);
      byAccount.set(trade.brokerAccountId, list);
    }

    for (const [brokerAccountId, orderIds] of byAccount) {
      try {
        const feed = await this.ensureOrderEventFeed(brokerAccountId, orderIds);
        if (!this.feedHandlerUnsubs.has(brokerAccountId)) {
          const unsub = feed.onEvent(
            (event) => void this.onOrderEvent(brokerAccountId, event),
          );
          this.feedHandlerUnsubs.set(brokerAccountId, unsub);
        }
      } catch (err) {
        logger.warn(
          { err, sessionId: this.sessionId, brokerAccountId },
          "failed to ensure order event feed",
        );
      }
    }
  }

  /**
   * React to a terminal order-lifecycle push (fill/cancel/reject) the moment
   * it arrives instead of waiting for the next poll tick's `getOrderStatus`
   * fallback (previously the only path that ever closed a trade this way).
   * `event.brokerOrderId` is the *entry* order this app placed — a terminal
   * event on it while the trade is still `open` means the broker closed the
   * position out-of-band (bracket/stop, expiration, liquidation, etc.), so
   * we confirm via `getOrderStatus` and close immediately, tagged
   * `closureSource: "stream"` so it's distinguishable from a poll-detected
   * close in trade history.
   */
  private async onOrderEvent(
    brokerAccountId: string,
    event: OrderEvent,
  ): Promise<void> {
    if (
      event.kind !== "fill" &&
      event.kind !== "canceled" &&
      event.kind !== "rejected"
    ) {
      return;
    }
    logger.info(
      {
        sessionId: this.sessionId,
        brokerAccountId,
        brokerOrderId: event.brokerOrderId,
        kind: event.kind,
        filledAvgPrice: event.filledAvgPrice,
        realizedPnlUsd: event.realizedPnlUsd,
        message: event.message,
      },
      "order event feed update",
    );

    const trade = this.tradesRepo.findOpenByBrokerOrderId(
      brokerAccountId,
      event.brokerOrderId,
    );
    if (!trade) return;

    try {
      const adapter = await this.brokerRegistry.get(brokerAccountId);
      const status = await adapter.getOrderStatus(event.brokerOrderId);
      if (status.status !== "closed") return;
      // Re-fetch: the poll tick may have raced us and already closed this trade.
      const fresh = this.tradesRepo.find(trade.id);
      if (!fresh || fresh.status !== "open") return;
      this.closeTrade(
        trade.id,
        status.realizedPnlUsd ?? 0,
        "broker_closed",
        status.latestPrice ?? undefined,
        "stream",
      );
    } catch (err) {
      logger.warn(
        {
          err,
          sessionId: this.sessionId,
          brokerAccountId,
          brokerOrderId: event.brokerOrderId,
        },
        "failed to process terminal order stream event",
      );
    }
  }

  private async tick(): Promise<void> {
    const openTrades = this.tradesRepo
      .listOpenAndPending(this.sessionId)
      .filter((trade) => trade.status === "open");
    const strategyContext = this.strategyContextService.get(this.sessionId);
    this.ensurePollInterval(strategyContext.timeframe);

    await this.syncOrderEventFeeds(openTrades);

    await this.enforceMaxHoldDays(
      openTrades,
      strategyContext.timeframe.maxHoldDays,
    );
    await this.enforcePredictionMarketPolicy(
      openTrades,
      strategyContext.riskConfig.maxExposureUsd,
    );

    const remainingOpenTrades = this.tradesRepo
      .listOpenAndPending(this.sessionId)
      .filter((trade) => trade.status === "open");
    for (const trade of remainingOpenTrades) {
      if (!trade.broker_order_id || !trade.brokerAccountId) continue;

      await runWithProviderCallScopeAsync(
        {
          sessionId: this.sessionId,
          tradeId: trade.id,
        },
        async () => {
          const brokerAccountId = trade.brokerAccountId;
          if (!brokerAccountId || !trade.broker_order_id) return;
          const adapter = await this.brokerRegistry.get(brokerAccountId);
          const wireSymbol = this.instrumentNormalizer
            ? this.instrumentNormalizer.toBrokerSymbol({
                symbol: trade.instrumentSymbol,
                instrumentClass: trade.instrumentType as InstrumentClass,
                brokerType: adapter.brokerType,
              })
            : trade.instrumentSymbol;
          const snapshot = await adapter.getMarketSnapshot(wireSymbol);
          const currentPrice = snapshot.price;

          // Update price extremes before evaluating exits.
          this.tradesRepo.updatePriceExtremes(trade.id, currentPrice);

          const side = trade.side as "BUY" | "SELL";
          const openedAt = trade.opened_at ?? trade.created_at;
          const tpTouch =
            trade.take_profit_price != null
              ? computeTimeToLevelMs({
                  openedAt,
                  nowMs: Date.now(),
                  currentPrice,
                  targetPrice: trade.take_profit_price,
                  side,
                  previouslyTouchedAt: trade.take_profit_touched_at ?? null,
                })
              : (trade.take_profit_touched_at ?? null);
          const stopTouch =
            trade.stop_loss_price != null
              ? computeTimeToLevelMs({
                  openedAt,
                  nowMs: Date.now(),
                  currentPrice,
                  targetPrice: trade.stop_loss_price,
                  side,
                  previouslyTouchedAt: trade.stop_touched_at ?? null,
                })
              : (trade.stop_touched_at ?? null);
          if (
            tpTouch !== (trade.take_profit_touched_at ?? null) ||
            stopTouch !== (trade.stop_touched_at ?? null)
          ) {
            this.tradesRepo.updateLevelTouchTimes(trade.id, {
              takeProfitTouchedAt: tpTouch,
              stopTouchedAt: stopTouch,
            });
          }

          // Get OHLCV for ATR — uses getOhlcv if available; falls back to empty for adapters that don't implement it
          const ohlcvTimeframe = this.resolveOhlcvTimeframe(
            strategyContext.timeframe,
          );
          let bars: { high: number; low: number; close: number }[] = [];
          if (adapter.getOhlcv) {
            try {
              bars = await adapter.getOhlcv(wireSymbol, ohlcvTimeframe, 20);
            } catch {
              // ATR exits skipped this tick; fixed stops/TP/max-hold still run
            }
          }

          const exitDecision = this.exitEvaluator.evaluate({
            trade: {
              id: trade.id,
              entryPrice: trade.entry_price ?? trade.position_size_usd,
              side: trade.side as "BUY" | "SELL",
              instrumentType: trade.instrumentType,
              highWaterMarkPrice: trade.high_water_mark_price,
            },
            currentPrice,
            ohlcvBars: bars,
            riskConfig: strategyContext.riskConfig,
          });

          if (exitDecision.shouldExit) {
            await this.closeTradeAtBroker(trade, exitDecision.reason, {
              price: currentPrice,
              timestamp: snapshot.timestamp,
            });
            return;
          }

          // Fallback: check if broker already closed the order externally
          const brokerOrderId = trade.broker_order_id;
          if (!brokerOrderId) return;
          const status = await adapter.getOrderStatus(brokerOrderId);
          if (status.status === "closed") {
            this.closeTrade(
              trade.id,
              status.realizedPnlUsd ?? 0,
              "broker_closed",
              currentPrice,
              "poll",
            );
          }
        },
      );
    }

    this.eventBus.emit(
      "stats_update",
      this.statsRepo.dashboardStats(
        this.sessionId,
        this.sessionRepo.getStatus(this.sessionId),
        this.portfolioValue(),
        this.uptimeMin(),
        this.getMaxAiSpendUsd(),
      ),
    );
  }

  private async enforcePredictionMarketPolicy(
    openTrades: ReturnType<TradesRepo["listOpenAndPending"]>,
    maxExposureUsd: number | null,
  ): Promise<void> {
    const predictionTrades = openTrades
      .filter((trade) => trade.instrumentType === "prediction_market")
      .sort((a, b) => {
        const at = new Date(a.opened_at ?? a.created_at).getTime();
        const bt = new Date(b.opened_at ?? b.created_at).getTime();
        return at - bt;
      });

    for (const trade of predictionTrades) {
      const resolutionTime = readResolutionTime(trade.instrumentMetadataJson);
      if (resolutionTime && resolutionTime.getTime() <= Date.now()) {
        await this.closeTradeAtBroker(trade, "event_resolution");
      }
    }

    if (maxExposureUsd != null) {
      const remaining = this.tradesRepo
        .listOpenAndPending(this.sessionId)
        .filter(
          (trade) =>
            trade.status === "open" &&
            trade.instrumentType === "prediction_market",
        );
      let exposure = remaining.reduce(
        (sum, trade) => sum + trade.position_size_usd,
        0,
      );
      for (const trade of remaining.sort(
        (a, b) =>
          new Date(a.opened_at ?? a.created_at).getTime() -
          new Date(b.opened_at ?? b.created_at).getTime(),
      )) {
        if (exposure <= maxExposureUsd) break;
        await this.closeTradeAtBroker(trade, "event_resolution");
        exposure -= trade.position_size_usd;
      }
    }
  }

  private async enforceMaxHoldDays(
    openTrades: ReturnType<TradesRepo["listOpenAndPending"]>,
    maxHoldDays: number | null,
  ): Promise<void> {
    if (maxHoldDays == null) return;
    for (const trade of openTrades) {
      const openedAt = new Date(trade.opened_at ?? trade.created_at).getTime();
      const ageDays = (Date.now() - openedAt) / (1000 * 60 * 60 * 24);
      if (ageDays > maxHoldDays) {
        await this.closeTradeAtBroker(trade, "max_hold_days");
      }
    }
  }

  private async closeTradeAtBroker(
    trade: ReturnType<TradesRepo["require"]>,
    exitReason?: string,
    closeSnapshot?: { price: number; timestamp: string },
  ): Promise<void> {
    if (!trade.broker_order_id || !trade.brokerAccountId) return;
    try {
      const adapter = await this.brokerRegistry.get(trade.brokerAccountId);
      const result = await adapter.closeOrder(trade.broker_order_id);
      if (closeSnapshot) {
        this.tradesRepo.updateCloseSnapshot(
          trade.id,
          JSON.stringify(closeSnapshot),
        );
      }
      this.closeTrade(
        trade.id,
        result.realizedPnlUsd,
        exitReason,
        closeSnapshot?.price,
      );
    } catch {
      // broker close failure: log is handled by caller context; trade stays open for retry next tick
    }
  }

  private resolveOhlcvTimeframe(timeframe: {
    holdingStyle: string;
    primaryTradingTimeframe?: string;
  }): "15m" | "30m" | "1h" | "4h" | "1d" {
    const primary = timeframe.primaryTradingTimeframe;
    if (primary === "15m" || primary === "30m") return primary;
    if (timeframe.holdingStyle === "multi_day_swing") return "4h";
    return "1d";
  }

  private closeTrade(
    tradeId: string,
    pnl: number,
    exitReason?: string,
    exitPrice?: number,
    closureSource?: "stream" | "poll",
  ) {
    const current = this.tradesRepo.require(tradeId);
    if (
      exitPrice != null &&
      current.entry_price != null &&
      current.entry_price > 0
    ) {
      const { mfeUsd, maeUsd } = computeMfeMaeUsd({
        side: current.side as "BUY" | "SELL",
        entryPrice: current.entry_price,
        positionSizeUsd: current.position_size_usd,
        highWaterMarkPrice: current.high_water_mark_price,
        lowWaterMarkPrice: current.low_water_mark_price,
        exitPrice,
      });
      const openedAt = current.opened_at ?? current.created_at;
      const closedAt = new Date().toISOString();
      const holdHours =
        (new Date(closedAt).getTime() - new Date(openedAt).getTime()) /
        (1000 * 60 * 60);
      const commissionUsd = estimateCommissionUsd({
        sizeUsd: current.position_size_usd,
      });
      const borrowCostUsd = estimateBorrowUsd({
        side: current.side as "BUY" | "SELL",
        holdHours,
        sizeUsd: current.position_size_usd,
      });
      const executionCostUsd = computeExecutionCostUsd({
        spreadAtEntryBps: current.spread_at_entry_bps,
        slippageBps: current.slippage_bps,
        commissionUsd,
        borrowCostUsd,
        sizeUsd: current.position_size_usd,
      });
      this.tradesRepo.updateExitAnalytics(tradeId, {
        mfeUsd,
        maeUsd,
        commissionUsd,
        borrowCostUsd,
        executionCostUsd,
      });
    }
    const closed = this.tradesRepo.updateStatus(
      tradeId,
      "closed",
      pnl,
      exitReason,
      closureSource,
    );
    this.capitalReservation.releaseOnClose(tradeId);
    this.eventBus.emit("trade_closed", closed);
    return closed;
  }

  private resolvePollIntervalMs(): number {
    if (this.overridePollIntervalMs != null) return this.overridePollIntervalMs;
    return this.pollIntervalForTimeframe(
      this.strategyContextService.get(this.sessionId).timeframe,
    );
  }

  private pollIntervalForTimeframe(timeframe: {
    holdingStyle: HoldingStyle;
    primaryTradingTimeframe?: string;
  }): number {
    const primary = timeframe.primaryTradingTimeframe;
    if (primary === "15m" || primary === "30m") return INTRADAY_POLL_MS;
    return (
      POLL_INTERVAL_MS[timeframe.holdingStyle] ??
      POLL_INTERVAL_MS.multi_day_swing
    );
  }

  private ensurePollInterval(timeframe: {
    holdingStyle: HoldingStyle;
    primaryTradingTimeframe?: string;
  }): void {
    const next = this.pollIntervalForTimeframe(timeframe);
    if (next === this.pollIntervalMs || !this.timer) return;
    clearInterval(this.timer);
    this.pollIntervalMs = next;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }
}

function readResolutionTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { resolutionTime?: string | null };
    if (!parsed.resolutionTime) return null;
    const date = new Date(parsed.resolutionTime);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}
