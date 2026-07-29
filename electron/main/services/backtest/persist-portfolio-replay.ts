import type { DbClient } from "../../db/client";
import {
  backtestDataInputs,
  backtestEquityPoints,
  backtestFills,
  backtestOrders,
  backtestRunSpecsV2,
  backtestTradesV2,
} from "../../db/schema";
import type { BacktestRunSpecV2 } from "@electron/shared/domain/backtest-v2";
import type { PortfolioReplayResult } from "./portfolio-replay-engine";

/** Persist normalized V2 portfolio detail (Solution 03). */
export function persistPortfolioReplayDetail(
  db: DbClient,
  input: {
    runId: string;
    spec: BacktestRunSpecV2;
    specHash: string;
    datasetHash: string;
    researchContractHash: string | null;
    portfolio: PortfolioReplayResult;
    barsBySymbol: Map<string, { length: number }>;
  },
): void {
  const now = new Date().toISOString();
  db.db
    .insert(backtestRunSpecsV2)
    .values({
      runId: input.runId,
      specJson: JSON.stringify(input.spec),
      specHash: input.specHash,
      datasetHash: input.datasetHash,
      researchContractHash: input.researchContractHash,
      createdAt: now,
    })
    .run();

  for (const instrument of input.spec.instruments) {
    const bars = input.barsBySymbol.get(instrument.symbol);
    db.db
      .insert(backtestDataInputs)
      .values({
        id: crypto.randomUUID(),
        runId: input.runId,
        symbol: instrument.symbol,
        timeframe: instrument.timeframe,
        provider: null,
        rowCount: bars?.length ?? 0,
        windowStart: input.spec.window.start,
        windowEnd: input.spec.window.end,
        datasetHash: input.datasetHash,
      })
      .run();
  }

  for (const order of input.portfolio.orders) {
    db.db
      .insert(backtestOrders)
      .values({
        id: order.id,
        runId: input.runId,
        ts: order.ts,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        status: order.status,
      })
      .run();
  }

  for (const fill of input.portfolio.fills) {
    db.db
      .insert(backtestFills)
      .values({
        id: crypto.randomUUID(),
        runId: input.runId,
        orderId: fill.orderId,
        ts: fill.ts,
        symbol: fill.symbol,
        side: fill.side,
        quantity: fill.quantity,
        price: fill.price,
        feeUsd: fill.feeUsd,
      })
      .run();
  }

  for (const trade of input.portfolio.trades) {
    db.db
      .insert(backtestTradesV2)
      .values({
        id: trade.id,
        runId: input.runId,
        symbol: trade.symbol,
        side: trade.side,
        entryTs: trade.entryTs,
        exitTs: trade.exitTs,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        quantity: trade.quantity,
        realizedPnlUsd: trade.realizedPnlUsd,
        feesUsd: trade.feesUsd,
        returnBps: trade.returnBps,
      })
      .run();
  }

  for (const point of input.portfolio.equity) {
    db.db
      .insert(backtestEquityPoints)
      .values({
        id: crypto.randomUUID(),
        runId: input.runId,
        ts: point.ts,
        cashUsd: point.cashUsd,
        grossMarketValueUsd: point.grossMarketValueUsd,
        netMarketValueUsd: point.netMarketValueUsd,
        realizedPnlUsd: point.realizedPnlUsd,
        unrealizedPnlUsd: point.unrealizedPnlUsd,
        feesUsd: point.feesUsd,
        equityUsd: point.equityUsd,
        drawdownUsd: point.drawdownUsd,
        drawdownPct: point.drawdownPct,
      })
      .run();
  }
}
