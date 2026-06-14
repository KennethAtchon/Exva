import { describe, expect, it } from "vitest";
import type { Trade } from "@/lib/types";
import { computeWalkForwardReport } from "../walk-forward-report";

function makeClosedTrade(index: number, pnl: number, closedAt: string): Trade {
  return {
    id: `trade-${index}`,
    sessionId: "session-1",
    brokerAccountId: null,
    instrumentSymbol: "AAPL",
    instrumentDisplayName: null,
    predictionOutcome: null,
    instrumentMetadataJson: null,
    instrumentType: "stock",
    side: "BUY",
    entry_price: 100,
    position_size_usd: 1000,
    stop_loss_price: null,
    take_profit_price: null,
    strategy: "momentum",
    execution_strategy: null,
    status: "closed",
    opened_at: closedAt,
    closed_at: closedAt,
    final_pnl_usd: pnl,
    ai_cost_usd: 0,
    confidence_score: null,
    broker_order_id: null,
    high_water_mark_price: null,
    low_water_mark_price: null,
    exit_reason: null,
    client_order_id: null,
    close_market_snapshot_json: null,
    created_at: closedAt,
  };
}

describe("computeWalkForwardReport", () => {
  it("returns null when fewer than 10 closed trades", () => {
    const trades = Array.from({ length: 9 }, (_, index) =>
      makeClosedTrade(
        index,
        10,
        `2024-01-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
      ),
    );

    expect(computeWalkForwardReport(trades)).toBeNull();
  });

  it("splits trades 70/30 by closed_at and computes slice metrics", () => {
    const pnls = [50, 50, -30, 50, -30, 50, -30, 50, -30, 50];
    const trades = pnls.map((pnl, index) =>
      makeClosedTrade(
        index,
        pnl,
        `2024-01-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
      ),
    );

    const report = computeWalkForwardReport(trades);

    expect(report).not.toBeNull();
    if (!report) throw new Error("expected walk-forward report");

    expect(report.splitRatio).toBe(0.7);
    expect(report.splitIndex).toBe(7);
    expect(report.inSample.tradeCount).toBe(7);
    expect(report.outOfSample.tradeCount).toBe(3);
    expect(report.inSample.label).toBe("in_sample");
    expect(report.outOfSample.label).toBe("out_of_sample");

    const inSampleWins = 4;
    expect(report.inSample.winRate).toBeCloseTo(inSampleWins / 7);
    expect(report.inSample.netPnlUsd).toBeCloseTo(
      50 + 50 - 30 + 50 - 30 + 50 - 30,
    );

    const outSampleWins = 2;
    expect(report.outOfSample.winRate).toBeCloseTo(outSampleWins / 3);
    expect(report.outOfSample.netPnlUsd).toBeCloseTo(50 - 30 + 50);
    expect(report.outOfSample.expectancy).toBeCloseTo(
      (outSampleWins / 3) * 50 - (1 / 3) * 30,
    );
  });

  it("ignores trades without closed_at timestamps", () => {
    const closed = Array.from({ length: 10 }, (_, index) =>
      makeClosedTrade(
        index,
        10,
        `2024-02-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
      ),
    );
    const openTrade = makeClosedTrade(99, 100, "2024-02-11T12:00:00Z");
    openTrade.closed_at = null;

    expect(computeWalkForwardReport([...closed, openTrade])).not.toBeNull();
    expect(computeWalkForwardReport([openTrade])).toBeNull();
  });
});
