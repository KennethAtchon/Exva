import { describe, expect, it } from "vitest";
import type { SessionRiskConfig } from "@electron/shared/domain";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { buildOrderPolicyTask } from "../order-policy-task";

describe("buildOrderPolicyTask", () => {
  it("maps session, order, and strategy fields into PolicyGateInput", () => {
    const riskConfig = {
      maxPositionUsd: 500,
      maxAiSpendUsd: 5,
      humanApprovalRequired: false,
    } as SessionRiskConfig;
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
      riskConfig,
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
        riskConfig,
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
