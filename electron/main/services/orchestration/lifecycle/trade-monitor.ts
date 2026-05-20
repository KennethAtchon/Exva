import type { StatsRepo } from "../../../db/repositories/system/stats-repo";
import type { TradesRepo } from "../../../db/repositories/trades/trades-repo";
import type { SessionStrategyContextService } from "../../session/session-strategy-context-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import type { EventBus } from "../../infra/event-bus";
import type { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import type { CapitalReservationService } from "../../risk/capital-reservation-service";
import type { HoldingStyle, InstrumentClass } from "@/lib/types";
import type { InstrumentNormalizer } from "../../broker/instrument-normalizer";
import {
  ExitPolicyEvaluator,
  type ExitReason,
} from "../../risk/exit-policy-evaluator";

const POLL_INTERVAL_MS: Record<HoldingStyle, number> = {
  intraday_flat: 5_000,
  multi_day_swing: 60_000,
  weeks_position: 300_000,
  custom: 300_000,
};

export class TradeMonitor {
  private timer: NodeJS.Timeout | null = null;
  private pollIntervalMs = POLL_INTERVAL_MS.multi_day_swing;
  private readonly exitEvaluator = new ExitPolicyEvaluator();

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
  ) {}

  start(): void {
    if (this.timer) return;
    this.pollIntervalMs = this.resolvePollIntervalMs();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const openTrades = this.tradesRepo
      .listOpenAndPending(this.sessionId)
      .filter((trade) => trade.status === "open");
    const strategyContext = this.strategyContextService.get(this.sessionId);
    this.ensurePollInterval(strategyContext.timeframe.holdingStyle);

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

      const adapter = await this.brokerRegistry.get(trade.brokerAccountId);
      const wireSymbol = this.instrumentNormalizer
        ? this.instrumentNormalizer.toBrokerSymbol({
            symbol: trade.instrumentSymbol,
            instrumentClass: trade.instrumentType as InstrumentClass,
            brokerType: adapter.brokerType,
          })
        : trade.instrumentSymbol;
      const snapshot = await adapter.getMarketSnapshot(wireSymbol);
      const currentPrice = snapshot.price;

      // Update high-water-mark before evaluating (conditional: only moves up for longs)
      this.tradesRepo.updateHighWaterMark(trade.id, currentPrice);

      // Get OHLCV for ATR — uses getOhlcv if available; falls back to empty for adapters that don't implement it
      const ohlcvTimeframe = this.resolveOhlcvTimeframe(
        strategyContext.timeframe.holdingStyle,
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
        continue;
      }

      // Fallback: check if broker already closed the order externally
      const status = await adapter.getOrderStatus(trade.broker_order_id);
      if (status.status === "closed") {
        this.closeTrade(trade.id, status.realizedPnlUsd ?? 0, "broker_closed");
      }
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
      this.closeTrade(trade.id, result.realizedPnlUsd, exitReason);
    } catch {
      // broker close failure: log is handled by caller context; trade stays open for retry next tick
    }
  }

  private resolveOhlcvTimeframe(holdingStyle: string): "1h" | "4h" | "1d" {
    if (holdingStyle === "intraday_flat") return "1h";
    if (holdingStyle === "multi_day_swing") return "4h";
    return "1d";
  }

  private closeTrade(tradeId: string, pnl: number, exitReason?: string) {
    const closed = this.tradesRepo.updateStatus(
      tradeId,
      "closed",
      pnl,
      exitReason,
    );
    this.capitalReservation.releaseOnClose(tradeId);
    this.eventBus.emit("trade_closed", closed);
    return closed;
  }

  private resolvePollIntervalMs(): number {
    const holdingStyle = this.strategyContextService.get(this.sessionId)
      .timeframe.holdingStyle;
    return POLL_INTERVAL_MS[holdingStyle] ?? POLL_INTERVAL_MS.multi_day_swing;
  }

  private ensurePollInterval(holdingStyle: HoldingStyle): void {
    const next =
      POLL_INTERVAL_MS[holdingStyle] ?? POLL_INTERVAL_MS.multi_day_swing;
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

// Re-export for callers that need the ExitReason type
export type { ExitReason };
