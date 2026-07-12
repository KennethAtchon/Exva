import { describe, expect, it } from "vitest";
import { OrderPolicyGate } from "../order-policy-gate";
import type { PolicyGateInput } from "../order-policy-gate";

function makeInput(overrides: Partial<PolicyGateInput> = {}): PolicyGateInput {
  return {
    sessionId: "s1",
    cycleId: "c1",
    tradeId: "t1",
    brokerAccountId: "broker-1",
    existingOrderCheck: () => false,
    sessionIsPaused: () => false,
    decisionRiskInput: {
      config: {
        strategy: "momentum",
        max_concurrent_trades: 3,
        max_position_usd: 500,
        max_api_spend_usd: 5,
        human_approval_required: false,
      } as never,
      stats: {} as never,
      order: {
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 300,
      },
      confidence: 0.8,
      quoteSnapshot: {
        price: 100,
        bid: 99.9,
        ask: 100.1,
        spreadPct: 0.2,
        volume: 100000,
        timestamp: new Date().toISOString(),
      },
      exitPolicy: {
        stopLossPct: 2,
        takeProfitPct: 4,
        maxHoldDays: 5,
      },
      strategyRules: { sideBias: "both" },
    },
    ...overrides,
  };
}

describe("OrderPolicyGate - price_collar", () => {
  it("passes when placement quote is within collar", () => {
    const input = makeInput();
    input.decisionRiskInput.placementQuoteSnapshot = {
      price: 101,
      timestamp: new Date().toISOString(),
    };
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.allowed).toBe(true);
    expect(result.gatesFailed).not.toContain("price_collar");
  });

  it("fails when placement quote drifts beyond collar (stock = 2%)", () => {
    const input = makeInput();
    // stock collar is 2%; drift from 100 → 103 = 3%
    input.decisionRiskInput.placementQuoteSnapshot = {
      price: 103,
      timestamp: new Date().toISOString(),
    };
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.allowed).toBe(false);
    expect(result.gatesFailed).toContain("price_collar");
  });

  it("passes when no placementQuoteSnapshot is provided (collar not enforced)", () => {
    const input = makeInput();
    input.decisionRiskInput.placementQuoteSnapshot = undefined;
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.gatesFailed).not.toContain("price_collar");
  });
});

describe("OrderPolicyGate - strategy", () => {
  it("rejects SELL orders for long-only strategies", () => {
    const input = makeInput();
    input.decisionRiskInput.side = "SELL";
    input.decisionRiskInput.strategyRules = { sideBias: "long_only" };
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.allowed).toBe(false);
    expect(result.gatesFailed).toContain("strategy");
  });

  it("rejects BUY orders for short-only strategies", () => {
    const input = makeInput();
    input.decisionRiskInput.side = "BUY";
    input.decisionRiskInput.strategyRules = { sideBias: "short_only" };
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.allowed).toBe(false);
    expect(result.gatesFailed).toContain("strategy");
  });
});

describe("OrderPolicyGate - data_freshness", () => {
  it("rejects stale swing stock quotes after the configured max age", () => {
    const input = makeInput();
    input.decisionRiskInput.holdingStyle = "multi_day_swing";
    input.decisionRiskInput.quoteSnapshot = {
      price: 100,
      spreadPct: 0.2,
      timestamp: new Date(Date.now() - 301_000).toISOString(),
    };

    const result = new OrderPolicyGate().evaluate(input);

    expect(result.allowed).toBe(false);
    expect(result.gatesFailed).toContain("data_freshness");
    expect(result.reason).toContain("Quote is stale");
  });
});

describe("OrderPolicyGate - spread", () => {
  it("rejects stock quotes above the max spread", () => {
    const input = makeInput();
    input.decisionRiskInput.quoteSnapshot = {
      price: 100,
      spreadPct: 0.51,
      timestamp: new Date().toISOString(),
    };

    const result = new OrderPolicyGate().evaluate(input);

    expect(result.allowed).toBe(false);
    expect(result.gatesFailed).toContain("spread");
    expect(result.reason).toContain("Spread too wide");
  });
});

describe("OrderPolicyGate - capital", () => {
  it("rejects orders above the configured max position", () => {
    const input = makeInput();
    input.decisionRiskInput.order.sizeUsd = 501;

    const result = new OrderPolicyGate().evaluate(input);

    expect(result.allowed).toBe(false);
    expect(result.gatesFailed).toContain("capital");
  });
});

describe("OrderPolicyGate - idempotency", () => {
  it("passes when existingOrderCheck returns false", () => {
    const input = makeInput({ existingOrderCheck: () => false });
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.gatesFailed).not.toContain("idempotency");
  });

  it("rejects duplicate order when existingOrderCheck returns true", () => {
    const input = makeInput({ existingOrderCheck: () => true });
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.allowed).toBe(false);
    expect(result.gatesFailed).toContain("idempotency");
  });
});

describe("OrderPolicyGate - broker capability", () => {
  it("rejects when broker does not support instrument class", () => {
    const input = makeInput();
    input.decisionRiskInput.brokerSupportsClass = false;
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.allowed).toBe(false);
    expect(result.gatesFailed).toContain("broker");
  });

  it("passes when broker supports instrument class", () => {
    const input = makeInput();
    input.decisionRiskInput.brokerSupportsClass = true;
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.gatesFailed).not.toContain("broker");
  });

  it("rejects when the market is closed", () => {
    const input = makeInput();
    input.decisionRiskInput.marketIsOpen = false;
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.allowed).toBe(false);
    expect(result.gatesFailed).toContain("broker");
    expect(result.reason).toBe("Market is closed");
  });
});

describe("OrderPolicyGate - session paused", () => {
  it("immediately returns runtime failure when session is paused", () => {
    const input = makeInput({ sessionIsPaused: () => true });
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.allowed).toBe(false);
    expect(result.gatesFailed).toContain("runtime");
  });
});

describe("OrderPolicyGate - exit_contract", () => {
  it("fails when no exit policy is defined", () => {
    const input = makeInput();
    input.decisionRiskInput.exitPolicy = {
      stopLossPct: null,
      atrStopMultiplier: null,
      takeProfitPct: null,
      maxHoldDays: null,
    };
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.gatesFailed).toContain("exit_contract");
  });

  it("passes when at least one exit policy is defined", () => {
    const input = makeInput();
    input.decisionRiskInput.exitPolicy = {
      maxHoldDays: 5,
      stopLossPct: null,
      takeProfitPct: null,
      atrStopMultiplier: null,
    };
    const result = new OrderPolicyGate().evaluate(input);
    expect(result.gatesFailed).not.toContain("exit_contract");
  });
});

describe("OrderPolicyGate - adapter_capabilities", () => {
  const marketOrder = {
    clientOrderId: "c1:t1",
    instrument: { symbol: "AAPL", instrumentClass: "stock" as const },
    side: "BUY" as const,
    quantity: { kind: "notional_usd" as const, value: 300 },
    orderType: "market" as const,
    timeInForce: "day" as const,
  };

  const marketOnlyCaps = {
    supportsLimit: false,
    supportsStop: false,
    supportsStopLimit: false,
    supportsBracket: true,
    supportsStreaming: false,
    quantityKinds: ["notional_usd" as const],
    timeInForce: ["day" as const],
    orderTypes: ["market" as const],
  };

  it("skips the gate when orderV2 or capabilities are omitted", () => {
    const result = new OrderPolicyGate().evaluate(makeInput());
    expect(result.gatesFailed).not.toContain("adapter_capabilities");
    expect(
      result.checks.find((c) => c.id === "adapter_capabilities"),
    ).toBeUndefined();
  });

  it("passes when the adapter supports the order shape", () => {
    const result = new OrderPolicyGate().evaluate(
      makeInput({
        orderV2: marketOrder,
        adapterCapabilities: marketOnlyCaps,
      }),
    );
    expect(result.gatesFailed).not.toContain("adapter_capabilities");
    expect(
      result.checks.find((c) => c.id === "adapter_capabilities")?.pass,
    ).toBe(true);
  });

  it("fails when the adapter cannot honor the order type", () => {
    const result = new OrderPolicyGate().evaluate(
      makeInput({
        orderV2: {
          ...marketOrder,
          orderType: "limit",
          limitPrice: 100,
        },
        adapterCapabilities: marketOnlyCaps,
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.gatesFailed).toContain("adapter_capabilities");
    expect(result.reason).toMatch(/orderType|limit/i);
  });
});
