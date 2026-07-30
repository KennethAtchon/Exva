import { asc, eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import {
  backtestEquityPoints,
  backtestFills,
  backtestRunSpecsV2,
  backtestTradesV2,
} from "../../schema";
import type { BacktestEquityPoint } from "@electron/shared/domain/backtest-v2";
import { backtestRunSpecV2Schema } from "@electron/shared/domain/backtest-v2";
import { safeJsonParse } from "../../../services/infra/safe-json-parse";

export interface BacktestFillRow {
  id: string;
  orderId: string;
  ts: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  feeUsd: number;
}

export interface BacktestTradeRow {
  id: string;
  symbol: string;
  side: string;
  entryTs: string;
  exitTs: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  realizedPnlUsd: number;
  feesUsd: number;
  returnBps: number | null;
}

export interface BacktestRunDetail {
  runId: string;
  spec: ReturnType<typeof backtestRunSpecV2Schema.parse> | null;
  specHash: string | null;
  datasetHash: string | null;
  researchContractHash: string | null;
  equity: BacktestEquityPoint[];
  trades: BacktestTradeRow[];
  fills: BacktestFillRow[];
}

export class BacktestDetailRepo {
  constructor(private readonly client: DbClient) {}

  getDetail(runId: string): BacktestRunDetail | null {
    const specRow = this.client.db
      .select()
      .from(backtestRunSpecsV2)
      .where(eq(backtestRunSpecsV2.runId, runId))
      .get();

    const spec = specRow?.specJson
      ? safeJsonParse(specRow.specJson, undefined, "backtest-detail.spec")
      : null;
    const parsedSpec = spec ? backtestRunSpecV2Schema.safeParse(spec) : null;

    const equityRows = this.client.db
      .select()
      .from(backtestEquityPoints)
      .where(eq(backtestEquityPoints.runId, runId))
      .orderBy(asc(backtestEquityPoints.ts))
      .all();

    const tradeRows = this.client.db
      .select()
      .from(backtestTradesV2)
      .where(eq(backtestTradesV2.runId, runId))
      .orderBy(asc(backtestTradesV2.entryTs))
      .all();

    const fillRows = this.client.db
      .select()
      .from(backtestFills)
      .where(eq(backtestFills.runId, runId))
      .orderBy(asc(backtestFills.ts))
      .all();

    if (
      !specRow &&
      equityRows.length === 0 &&
      tradeRows.length === 0 &&
      fillRows.length === 0
    ) {
      return null;
    }

    return {
      runId,
      spec: parsedSpec?.success ? parsedSpec.data : null,
      specHash: specRow?.specHash ?? null,
      datasetHash: specRow?.datasetHash ?? null,
      researchContractHash: specRow?.researchContractHash ?? null,
      equity: equityRows.map((row) => ({
        ts: row.ts,
        cashUsd: row.cashUsd,
        grossMarketValueUsd: row.grossMarketValueUsd,
        netMarketValueUsd: row.netMarketValueUsd,
        realizedPnlUsd: row.realizedPnlUsd,
        unrealizedPnlUsd: row.unrealizedPnlUsd,
        feesUsd: row.feesUsd,
        equityUsd: row.equityUsd,
        drawdownUsd: row.drawdownUsd,
        drawdownPct: row.drawdownPct,
      })),
      trades: tradeRows.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        side: row.side,
        entryTs: row.entryTs,
        exitTs: row.exitTs,
        entryPrice: row.entryPrice,
        exitPrice: row.exitPrice,
        quantity: row.quantity,
        realizedPnlUsd: row.realizedPnlUsd,
        feesUsd: row.feesUsd,
        returnBps: row.returnBps,
      })),
      fills: fillRows.map((row) => ({
        id: row.id,
        orderId: row.orderId,
        ts: row.ts,
        symbol: row.symbol,
        side: row.side,
        quantity: row.quantity,
        price: row.price,
        feeUsd: row.feeUsd,
      })),
    };
  }
}
