import { describe, expect, it } from "vitest";
import type { SessionConfig } from "@/lib/types";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { buildOrderPolicyTask } from "../order-policy-task";

describe("buildOrderPolicyTask", () => {
  it("maps session, order, and strategy fields into PolicyGateInput", () => {
    const config = {
      strategy: "momentum",
      max_position_usd: 500,
      max_api_spend_usd: 5,
      human_approval_required: false,
    } as SessionConfig;
    const strategy = {
      timeframe: {
        holdingStyle: "multi_day_swing",
        maxHoldDays: 5,
      },
      riskConfig: {
        stopLossPct: 2,
        atrStopMultiplier: 1.5,
        takeProfitPct: 4,
      },
      rules: { sideBias: "long_only" },
    } as SessionStrategyContext;
    const order = {
      instrumentSymbol: "AAPL",
      instrumentType: "stock" as const,
      side: "BUY" as const,
      sizeUsd: 300,
    };

    const task = buildOrderPolicyTask({
      sessionId: "session-1",
      cycleId: "cycle-1",
      tradeId: "trade-1",
      brokerAccountId: "broker-1",
      config,
      stats: { daily_api_spend: 1 } as never,
      order,
      confidence: 0.82,
      side: "BUY",
      strategy,
      existingOrderCheck: () => false,
      sessionIsPaused: () => false,
      brokerSupportsClass: true,
      quoteSnapshot: { price: 100, timestamp: new Date().toISOString() },
      placementQuoteSnapshot: {
        price: 100.5,
        timestamp: new Date().toISOString(),
      },
      marketIsOpen: true,
      totalBrokerExposureUsd: 1200,
    });

    expect(task).toMatchObject({
      sessionId: "session-1",
      cycleId: "cycle-1",
      tradeId: "trade-1",
      brokerAccountId: "broker-1",
      decisionRiskInput: {
        config,
        order,
        confidence: 0.82,
        side: "BUY",
        holdingStyle: "multi_day_swing",
        totalBrokerExposureUsd: 1200,
        brokerSupportsClass: true,
        marketIsOpen: true,
        exitPolicy: {
          stopLossPct: 2,
          atrStopMultiplier: 1.5,
          takeProfitPct: 4,
          maxHoldDays: 5,
        },
        strategyRules: { sideBias: "long_only" },
      },
    });
  });
});
