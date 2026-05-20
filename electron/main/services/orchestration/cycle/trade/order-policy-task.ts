import type { DashboardStats, SessionConfig } from "@/lib/types";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { OrderRequest } from "../../../broker/adapters/broker-adapter";
import type { DecisionRiskInput } from "../../../risk/risk-engine";
import type { PolicyGateInput } from "../../policy/order-policy-gate";

interface BuildOrderPolicyTaskInput {
  sessionId: string;
  cycleId: string;
  tradeId: string;
  brokerAccountId: string;
  config: SessionConfig;
  stats: DashboardStats;
  order: OrderRequest;
  confidence: number;
  side?: "BUY" | "SELL";
  strategy: SessionStrategyContext;
  existingOrderCheck: PolicyGateInput["existingOrderCheck"];
  sessionIsPaused: PolicyGateInput["sessionIsPaused"];
  brokerSupportsClass: boolean;
  quoteSnapshot?: DecisionRiskInput["quoteSnapshot"];
  placementQuoteSnapshot?: DecisionRiskInput["placementQuoteSnapshot"];
  marketIsOpen?: boolean;
  totalBrokerExposureUsd?: number;
}

export function buildOrderPolicyTask(
  input: BuildOrderPolicyTaskInput,
): PolicyGateInput {
  return {
    sessionId: input.sessionId,
    cycleId: input.cycleId,
    tradeId: input.tradeId,
    brokerAccountId: input.brokerAccountId,
    existingOrderCheck: input.existingOrderCheck,
    sessionIsPaused: input.sessionIsPaused,
    decisionRiskInput: {
      config: input.config,
      stats: input.stats,
      order: input.order,
      confidence: input.confidence,
      quoteSnapshot: input.quoteSnapshot,
      placementQuoteSnapshot: input.placementQuoteSnapshot,
      side: input.side,
      holdingStyle: input.strategy.timeframe.holdingStyle,
      exitPolicy: {
        stopLossPct: input.strategy.riskConfig.stopLossPct,
        atrStopMultiplier: input.strategy.riskConfig.atrStopMultiplier,
        takeProfitPct: input.strategy.riskConfig.takeProfitPct,
        maxHoldDays: input.strategy.timeframe.maxHoldDays,
      },
      totalBrokerExposureUsd: input.totalBrokerExposureUsd,
      strategyRules: { sideBias: input.strategy.rules.sideBias },
      brokerSupportsClass: input.brokerSupportsClass,
      marketIsOpen: input.marketIsOpen,
    },
  };
}
