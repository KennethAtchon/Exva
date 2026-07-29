import { describe, expect, it } from "vitest";
import { produceOptionsFlowSignal } from "../options-flow-producer";
import type { OptionChainContract } from "../../broker/adapters/broker-adapter";

function contract(
  partial: Partial<OptionChainContract> &
    Pick<OptionChainContract, "symbol" | "type" | "strike">,
): OptionChainContract {
  return {
    expiry: "2026-08-21",
    delta: partial.type === "call" ? 0.45 : -0.45,
    impliedVolatility: 0.3,
    openInterest: 2000,
    dayVolume: 5000,
    bid: 2.1,
    ask: 2.3,
    ...partial,
  };
}

describe("produceOptionsFlowSignal", () => {
  it("selects a debit vertical with whole-contract legs on unusual call flow", () => {
    const chain: OptionChainContract[] = [
      contract({
        symbol: "AAPL260821C00150000",
        type: "call",
        strike: 150,
        delta: 0.55,
        bid: 4.0,
        ask: 4.2,
        dayVolume: 8000,
        openInterest: 1000,
      }),
      contract({
        symbol: "AAPL260821C00155000",
        type: "call",
        strike: 155,
        delta: 0.35,
        bid: 1.5,
        ask: 1.7,
        dayVolume: 2000,
        openInterest: 800,
      }),
      contract({
        symbol: "AAPL260821P00150000",
        type: "put",
        strike: 150,
        delta: -0.5,
        dayVolume: 100,
        openInterest: 1000,
      }),
    ];

    const result = produceOptionsFlowSignal({
      underlyingSymbol: "AAPL",
      chain,
      contracts: 2,
    });

    expect(result.kind).toBe("setup");
    if (result.kind !== "setup") return;
    expect(result.legs).toHaveLength(2);
    expect(result.legs[0]?.quantity).toBe(2);
    expect(result.legs[0]?.side).toBe("BUY");
    expect(result.legs[1]?.side).toBe("SELL");
    expect(result.fact.instrumentClass).toBe("options");
    expect(result.maxDebitUsd).toBeGreaterThan(0);
  });

  it("returns insufficient_chain when the chain is empty", () => {
    const result = produceOptionsFlowSignal({
      underlyingSymbol: "AAPL",
      chain: [],
    });
    expect(result.kind).toBe("insufficient_chain");
  });
});
