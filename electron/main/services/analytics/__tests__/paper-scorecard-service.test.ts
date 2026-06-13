import { describe, expect, it, vi } from "vitest";
import {
  PaperScorecardService,
  meetsPromotionCriteria,
} from "../paper-scorecard-service";
import type { Trade } from "@/lib/types";

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    sessionId: "s1",
    instrumentSymbol: "AAPL",
    instrumentType: "stock",
    side: "BUY",
    entry_price: 100,
    position_size_usd: 1000,
    stop_loss_price: null,
    take_profit_price: null,
    strategy: "momentum",
    status: "closed",
    opened_at: "2024-01-01T09:00:00Z",
    closed_at: "2024-01-01T10:00:00Z",
    final_pnl_usd: 50,
    ai_cost_usd: 0,
    confidence_score: null,
    broker_order_id: null,
    high_water_mark_price: null,
    low_water_mark_price: null,
    exit_reason: null,
    created_at: "2024-01-01T09:00:00Z",
    ...overrides,
  };
}

function makeService(trades: Trade[]) {
  const tradesRepo = {
    listClosed: vi.fn().mockReturnValue(trades),
  };
  const apiCallLog = {
    listByScope: vi.fn().mockReturnValue([]),
  };
  const session = {
    get: vi.fn().mockReturnValue({ id: "s1", name: "Test Session" }),
  };
  const sessionExecutionSteps = {
    getLatestBySession: vi.fn().mockReturnValue([]),
  };
  const brokerAccounts = {
    find: vi.fn().mockReturnValue({ brokerType: "alpaca" }),
  };
  return new PaperScorecardService({
    trades: tradesRepo as never,
    brokerAccounts: brokerAccounts as never,
    apiCallLog: apiCallLog as never,
    session: session as never,
    sessionExecutionSteps: sessionExecutionSteps as never,
  });
}

describe("PaperScorecardService.generate", () => {
  it("10 trades: 6 wins $50, 4 losses $30 → winRate=0.6, expectancy=18", () => {
    const trades = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeTrade({ id: `w${i}`, final_pnl_usd: 50 }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makeTrade({ id: `l${i}`, final_pnl_usd: -30 }),
      ),
    ];
    const scorecard = makeService(trades).generate("s1");

    expect(scorecard.tradeCount).toBe(10);
    expect(scorecard.winCount).toBe(6);
    expect(scorecard.lossCount).toBe(4);
    expect(scorecard.winRate).toBeCloseTo(0.6);
    expect(scorecard.expectancy).toBeCloseTo(18); // (0.6*50) - (0.4*30)
  });

  it("profitFactor = (6*50)/(4*30) = 300/120 = 2.5", () => {
    const trades = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeTrade({ id: `w${i}`, final_pnl_usd: 50 }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makeTrade({ id: `l${i}`, final_pnl_usd: -30 }),
      ),
    ];
    const scorecard = makeService(trades).generate("s1");

    expect(scorecard.profitFactor).toBeCloseTo(2.5);
  });

  it("maxDrawdown: [50,100,70,120,90,140,110,160,130,180] → maxDrawdown=30", () => {
    // Cumulative PnL: 50,100,70,120,90,140,110,160,130,180
    // PnL diffs: 50,50,-30,50,-30,50,-30,50,-30,50
    const pnls = [50, 50, -30, 50, -30, 50, -30, 50, -30, 50];
    const trades = pnls.map((pnl, i) =>
      makeTrade({ id: `t${i}`, final_pnl_usd: pnl }),
    );
    const scorecard = makeService(trades).generate("s1");

    expect(scorecard.maxDrawdownUsd).toBeCloseTo(30);
  });

  it("netPnlAfterCostsUsd = netPnlUsd - (aiSpend + dataSpend)", () => {
    const tradesRepo = {
      listClosed: vi.fn().mockReturnValue([makeTrade({ final_pnl_usd: 100 })]),
    };
    const apiCallLog = {
      listByScope: vi.fn().mockReturnValue([
        { call_type: "ai", cost_usd: 5 },
        { call_type: "data", cost_usd: 3 },
      ]),
    };
    const session = { get: vi.fn().mockReturnValue({ name: "s" }) };
    const sessionExecutionSteps = {
      getLatestBySession: vi.fn().mockReturnValue([]),
    };
    const svc = new PaperScorecardService({
      trades: tradesRepo as never,
      brokerAccounts: {
        find: vi.fn().mockReturnValue({ brokerType: "alpaca" }),
      } as never,
      apiCallLog: apiCallLog as never,
      session: session as never,
      sessionExecutionSteps: sessionExecutionSteps as never,
    });

    const scorecard = svc.generate("s1");
    expect(scorecard.netPnlUsd).toBeCloseTo(100);
    expect(scorecard.totalAiSpendUsd).toBeCloseTo(5);
    expect(scorecard.totalDataSpendUsd).toBeCloseTo(3);
    expect(scorecard.netPnlAfterCostsUsd).toBeCloseTo(92);
  });

  it("no losses → profitFactor = Infinity", () => {
    const trades = Array.from({ length: 3 }, (_, i) =>
      makeTrade({ id: `w${i}`, final_pnl_usd: 50 }),
    );
    const scorecard = makeService(trades).generate("s1");

    expect(scorecard.profitFactor).toBe(Infinity);
  });

  it("zero trades → all zero scorecard", () => {
    const scorecard = makeService([]).generate("s1");

    expect(scorecard.tradeCount).toBe(0);
    expect(scorecard.winRate).toBe(0);
    expect(scorecard.expectancy).toBe(0);
    expect(scorecard.maxDrawdownUsd).toBe(0);
  });
});

describe("meetsPromotionCriteria", () => {
  function makeScorecard(
    overrides: Partial<Parameters<typeof meetsPromotionCriteria>[0]> = {},
  ) {
    return {
      sessionId: "s1",
      strategyPresetLabel: "test",
      generatedAt: new Date().toISOString(),
      tradeCount: 100,
      winCount: 50,
      lossCount: 50,
      winRate: 0.5,
      avgWinUsd: 50,
      avgLossUsd: 30,
      expectancy: 10,
      profitFactor: 2,
      netPnlUsd: 500,
      netPnlAfterCostsUsd: 400,
      totalAiSpendUsd: 50,
      totalDataSpendUsd: 50,
      maxDrawdownUsd: 100,
      maxDrawdownPct: 0.1,
      tradeFrequency: 5,
      avgHoldHours: 2,
      exitReasonBreakdown: {},
      rejectionReasonBreakdown: {},
      scenarioCoverage: { clean_breakout: 10, failed_breakout: 5 },
      ...overrides,
    };
  }

  it("tradeCount < 100 → failedCriteria includes 'minTradeCount'", () => {
    const result = meetsPromotionCriteria(makeScorecard({ tradeCount: 50 }), {
      minTradeCount: 100,
      minWinRate: 0.4,
      minExpectancy: 0,
      maxDrawdownPct: 0.2,
      requiredScenarioCoverage: [],
    });
    expect(result.meets).toBe(false);
    expect(result.failedCriteria).toContain("minTradeCount");
  });

  it("expectancy < 0 → failedCriteria includes 'minExpectancy'", () => {
    const result = meetsPromotionCriteria(makeScorecard({ expectancy: -5 }), {
      minTradeCount: 100,
      minWinRate: 0.4,
      minExpectancy: 0,
      maxDrawdownPct: 0.2,
      requiredScenarioCoverage: [],
    });
    expect(result.meets).toBe(false);
    expect(result.failedCriteria).toContain("minExpectancy");
  });

  it("maxDrawdownPct > 0.20 → failedCriteria includes 'maxDrawdownPct'", () => {
    const result = meetsPromotionCriteria(
      makeScorecard({ maxDrawdownPct: 0.25 }),
      {
        minTradeCount: 100,
        minWinRate: 0.4,
        minExpectancy: 0,
        maxDrawdownPct: 0.2,
        requiredScenarioCoverage: [],
      },
    );
    expect(result.meets).toBe(false);
    expect(result.failedCriteria).toContain("maxDrawdownPct");
  });

  it("missing scenario coverage → failedCriteria includes the missing scenario kind", () => {
    const result = meetsPromotionCriteria(
      makeScorecard({ scenarioCoverage: { clean_breakout: 5 } }),
      {
        minTradeCount: 100,
        minWinRate: 0.4,
        minExpectancy: 0,
        maxDrawdownPct: 0.2,
        requiredScenarioCoverage: ["clean_breakout", "news_reversal"],
      },
    );
    expect(result.meets).toBe(false);
    expect(result.failedCriteria).toContain("news_reversal");
    expect(result.failedCriteria).not.toContain("clean_breakout");
  });

  it("all criteria met → meets=true, failedCriteria=[]", () => {
    const result = meetsPromotionCriteria(makeScorecard(), {
      minTradeCount: 100,
      minWinRate: 0.4,
      minExpectancy: 0,
      maxDrawdownPct: 0.2,
      requiredScenarioCoverage: ["clean_breakout"],
    });
    expect(result.meets).toBe(true);
    expect(result.failedCriteria).toEqual([]);
  });
});

describe("PaperScorecardService - scenarioCoverage", () => {
  it("counts classified trades by mock scenario kind", () => {
    const trades = [
      makeTrade({
        id: "t1",
        instrumentMetadataJson: JSON.stringify({
          mockScenarioKind: "clean_breakout",
        }),
        final_pnl_usd: 20,
      }),
      makeTrade({
        id: "t2",
        instrumentMetadataJson: JSON.stringify({
          mockScenarioKind: "clean_breakout",
        }),
        final_pnl_usd: -10,
      }),
      makeTrade({
        id: "t3",
        instrumentMetadataJson: JSON.stringify({
          mockScenarioKind: "failed_breakout",
        }),
        final_pnl_usd: -15,
      }),
    ];
    const scorecard = makeService(trades).generate("s1");

    expect(scorecard.scenarioCoverage.clean_breakout).toBe(2);
    expect(scorecard.scenarioCoverage.failed_breakout).toBe(1);
  });

  it("ignores trades with no instrumentMetadataJson", () => {
    const trades = [
      makeTrade({ id: "t1", instrumentMetadataJson: null, final_pnl_usd: 10 }),
      makeTrade({
        id: "t2",
        instrumentMetadataJson: JSON.stringify({
          mockScenarioKind: "news_reversal",
        }),
        final_pnl_usd: 10,
      }),
    ];
    const scorecard = makeService(trades).generate("s1");

    expect(scorecard.scenarioCoverage.news_reversal).toBe(1);
    expect(Object.keys(scorecard.scenarioCoverage)).toHaveLength(1);
  });

  it("ignores invalid/unknown scenario kind values", () => {
    const trades = [
      makeTrade({
        id: "t1",
        instrumentMetadataJson: JSON.stringify({
          mockScenarioKind: "not_a_real_scenario",
        }),
        final_pnl_usd: 10,
      }),
    ];
    const scorecard = makeService(trades).generate("s1");

    expect(Object.keys(scorecard.scenarioCoverage)).toHaveLength(0);
  });

  it("meetsPromotionCriteria fails when required scenario has 0 coverage", () => {
    const scorecard = makeService([
      makeTrade({
        id: "t1",
        instrumentMetadataJson: JSON.stringify({
          mockScenarioKind: "clean_breakout",
        }),
        final_pnl_usd: 10,
      }),
    ]).generate("s1");

    const result = meetsPromotionCriteria(
      {
        ...scorecard,
        tradeCount: 100,
        winRate: 0.5,
        expectancy: 5,
        maxDrawdownPct: 0.1,
      },
      {
        minTradeCount: 1,
        minWinRate: 0.4,
        minExpectancy: 0,
        maxDrawdownPct: 0.2,
        requiredScenarioCoverage: ["clean_breakout", "news_reversal"],
      },
    );

    expect(result.meets).toBe(false);
    expect(result.failedCriteria).toContain("news_reversal");
    expect(result.failedCriteria).not.toContain("clean_breakout");
  });
});
