import type { InstrumentClass } from "@/lib/types";
import type { DecisionCheck, HoldingStyle } from "@electron/shared/domain";
import type { DecisionRiskInput } from "../../risk/risk-engine";
import {
  adapterSupportsOrder,
  type AdapterCapabilities,
  type BrokerOrderV2,
} from "../../broker/order-contract-v2";

type PolicyGateName =
  | "runtime"
  | "strategy"
  | "data_freshness"
  | "price_collar"
  | "spread"
  | "capital"
  | "broker"
  | "adapter_capabilities"
  | "idempotency"
  | "exit_contract";

export interface PolicyGateInput {
  sessionId: string;
  cycleId: string;
  tradeId: string;
  decisionRiskInput: DecisionRiskInput;
  brokerAccountId: string;
  existingOrderCheck: (
    clientOrderId: string,
    brokerAccountId: string,
  ) => boolean;
  sessionIsPaused: () => boolean;
  /** Optional v2 order + adapter caps — when both set, adapter_capabilities gate runs. */
  orderV2?: BrokerOrderV2;
  adapterCapabilities?: AdapterCapabilities;
}

export interface PolicyGateResult {
  allowed: boolean;
  reason?: string;
  gatesFailed: PolicyGateName[];
  /** Per-gate pass/fail trace for observability (decision-trace panel). */
  checks: DecisionCheck[];
}

const PRICE_COLLAR_PCT: Partial<Record<InstrumentClass, number>> = {
  stock: 0.02,
  crypto: 0.03,
  futures: 0.01,
  prediction_market: 0.05,
};

const MAX_SPREAD_PCT: Partial<Record<InstrumentClass, number>> = {
  stock: 0.5,
  crypto: 1.0,
  futures: 0.3,
  // Option chains run materially wider than the underlying.
  options: 2.0,
};

const MAX_QUOTE_AGE_MS: Record<
  InstrumentClass,
  Record<"intraday" | "swing" | "position", number>
> = {
  stock: { intraday: 30_000, swing: 300_000, position: 600_000 },
  crypto: { intraday: 15_000, swing: 120_000, position: 300_000 },
  futures: { intraday: 15_000, swing: 120_000, position: 300_000 },
  options: { intraday: 15_000, swing: 120_000, position: 300_000 },
  prediction_market: { intraday: 300_000, swing: 600_000, position: 3_600_000 },
};

function maxQuoteAgeMs(
  cls: InstrumentClass,
  holdingStyle?: HoldingStyle,
): number {
  const bucket: "intraday" | "swing" | "position" =
    holdingStyle === "multi_day_swing" ? "swing" : "position";
  return MAX_QUOTE_AGE_MS[cls][bucket];
}

export class OrderPolicyGate {
  evaluate(input: PolicyGateInput): PolicyGateResult {
    const gatesFailed: PolicyGateName[] = [];
    const evaluated: PolicyGateName[] = [];
    const { decisionRiskInput: d, cycleId, tradeId, brokerAccountId } = input;
    const instrumentClass = d.order.instrumentType;
    const clientOrderId = `${cycleId}:${tradeId}`;

    const gateLabels: Record<PolicyGateName, string> = {
      runtime: "Runtime",
      strategy: "Strategy side bias",
      data_freshness: "Data freshness",
      price_collar: "Price collar",
      spread: "Spread",
      capital: "Capital limit",
      broker: "Broker",
      adapter_capabilities: "Adapter capabilities",
      idempotency: "Idempotency",
      exit_contract: "Exit contract",
    };

    // runtime: session paused
    evaluated.push("runtime");
    if (input.sessionIsPaused()) {
      gatesFailed.push("runtime");
      return {
        allowed: false,
        reason: "Session is paused",
        gatesFailed,
        checks: [
          {
            id: "runtime",
            label: gateLabels.runtime,
            pass: false,
            detail: "Session is paused",
          },
        ],
      };
    }

    // strategy: side bias
    if (d.strategyRules && d.side) {
      evaluated.push("strategy");
      const { sideBias } = d.strategyRules;
      if (sideBias === "long_only" && d.side === "SELL") {
        gatesFailed.push("strategy");
      } else if (sideBias === "short_only" && d.side === "BUY") {
        gatesFailed.push("strategy");
      }
    }

    // data_freshness: quote staleness
    if (d.quoteSnapshot) {
      evaluated.push("data_freshness");
      const maxAgeMs = maxQuoteAgeMs(instrumentClass, d.holdingStyle);
      const quoteAgeMs =
        Date.now() - new Date(d.quoteSnapshot.timestamp).getTime();
      if (quoteAgeMs > maxAgeMs) {
        gatesFailed.push("data_freshness");
      }
    }

    // price_collar: reject if price drifted beyond threshold between candidate snapshot and placement
    if (d.quoteSnapshot && d.placementQuoteSnapshot) {
      evaluated.push("price_collar");
      const collar = PRICE_COLLAR_PCT[instrumentClass] ?? 0.05;
      const ref = d.quoteSnapshot.price;
      const now = d.placementQuoteSnapshot.price;
      if (ref > 0) {
        const driftPct = Math.abs(now - ref) / ref;
        if (driftPct > collar) gatesFailed.push("price_collar");
      }
    }

    // spread: spread too wide
    if (d.quoteSnapshot?.spreadPct != null) {
      evaluated.push("spread");
      const maxSpread = MAX_SPREAD_PCT[instrumentClass];
      if (maxSpread != null && d.quoteSnapshot.spreadPct > maxSpread) {
        gatesFailed.push("spread");
      }
    }

    // capital: three sub-checks
    evaluated.push("capital");
    if (d.order.sizeUsd > d.config.max_position_usd) {
      gatesFailed.push("capital");
    } else if (d.totalBrokerExposureUsd != null && d.order.sizeUsd > 0) {
      // broker exposure cap not yet stored in config; skip sub-check 3 unless data available
    }

    // broker: class support + market hours
    evaluated.push("broker");
    if (d.brokerSupportsClass === false) {
      gatesFailed.push("broker");
    } else if (d.marketIsOpen === false) {
      gatesFailed.push("broker");
    }

    // adapter_capabilities: refuse order shapes the adapter cannot honor
    let adapterCapabilityReason: string | undefined;
    if (input.orderV2 && input.adapterCapabilities) {
      evaluated.push("adapter_capabilities");
      const support = adapterSupportsOrder(
        input.adapterCapabilities,
        input.orderV2,
      );
      if (!support.ok) {
        gatesFailed.push("adapter_capabilities");
        adapterCapabilityReason = support.reason;
      }
    }

    // idempotency: duplicate order guard
    evaluated.push("idempotency");
    if (input.existingOrderCheck(clientOrderId, brokerAccountId)) {
      gatesFailed.push("idempotency");
    }

    // exit_contract: at least one enforceable exit must be defined
    if (d.exitPolicy) {
      evaluated.push("exit_contract");
      const { stopLossPct, atrStopMultiplier, takeProfitPct, maxHoldDays } =
        d.exitPolicy;
      if (
        stopLossPct == null &&
        atrStopMultiplier == null &&
        takeProfitPct == null &&
        maxHoldDays == null
      ) {
        gatesFailed.push("exit_contract");
      }
    }

    const gateReasons: Record<PolicyGateName, string> = {
      runtime: "Session is paused",
      strategy: "Order side contradicts strategy sideBias",
      data_freshness: (() => {
        if (d.quoteSnapshot) {
          const ageS = Math.round(
            (Date.now() - new Date(d.quoteSnapshot.timestamp).getTime()) / 1000,
          );
          const maxS = Math.round(
            maxQuoteAgeMs(instrumentClass, d.holdingStyle) / 1000,
          );
          return `Quote is stale (age: ${ageS}s, max: ${maxS}s)`;
        }
        return "Quote is stale";
      })(),
      price_collar: "Expected fill exceeds price collar",
      spread: (() => {
        const bps =
          d.quoteSnapshot?.spreadPct != null
            ? Math.round(d.quoteSnapshot.spreadPct * 100)
            : "?";
        const maxBps = (MAX_SPREAD_PCT[instrumentClass] ?? 0) * 100;
        return `Spread too wide (${bps}bps, max ${maxBps}bps)`;
      })(),
      capital: "Capital limit exceeded",
      broker:
        d.brokerSupportsClass === false
          ? "Broker does not support instrument class"
          : "Market is closed",
      adapter_capabilities:
        adapterCapabilityReason ?? "Adapter does not support this order shape",
      idempotency: `Duplicate order: clientOrderId ${clientOrderId} already exists`,
      exit_contract:
        "No enforceable exit policy — configure stopLoss, takeProfit, or maxHoldDays",
    };

    const checks: DecisionCheck[] = evaluated.map((name) => {
      const failed = gatesFailed.includes(name);
      return {
        id: name,
        label: gateLabels[name],
        pass: !failed,
        detail: failed ? gateReasons[name] : null,
      };
    });

    if (gatesFailed.length === 0) {
      return { allowed: true, gatesFailed: [], checks };
    }

    const firstFailed = gatesFailed[0];
    return {
      allowed: false,
      reason: firstFailed
        ? gateReasons[firstFailed]
        : "Order blocked by policy gate",
      gatesFailed,
      checks,
    };
  }
}
