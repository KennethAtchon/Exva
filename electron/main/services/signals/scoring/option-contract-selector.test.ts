import { describe, expect, it } from "vitest";
import {
  selectOptionContract,
  type OptionContract,
} from "./option-contract-selector";

function contract(over: Partial<OptionContract>): OptionContract {
  return {
    symbol: "NVDA250117C00150000",
    type: "call",
    delta: 0.4,
    openInterest: 1000,
    bid: 4.9,
    ask: 5.1,
    daysToExpiry: 21,
    ...over,
  };
}

describe("selectOptionContract", () => {
  it("picks the contract with delta closest to target", () => {
    const chain = [
      contract({ symbol: "A", delta: 0.2 }),
      contract({ symbol: "B", delta: 0.42 }),
      contract({ symbol: "C", delta: 0.7 }),
    ];
    const res = selectOptionContract(chain, "buy");
    expect(res.contract?.symbol).toBe("B");
  });

  it("filters illiquid, wide-spread, and out-of-window contracts", () => {
    const chain = [
      contract({ symbol: "lowOI", openInterest: 10 }),
      contract({ symbol: "wide", bid: 1, ask: 3 }), // 100% spread
      contract({ symbol: "tooSoon", daysToExpiry: 2 }),
      contract({ symbol: "tooFar", daysToExpiry: 120 }),
      contract({ symbol: "good", delta: 0.39 }),
    ];
    const res = selectOptionContract(chain, "buy");
    expect(res.contract?.symbol).toBe("good");
  });

  it("selects puts for a bearish direction", () => {
    const chain = [
      contract({ symbol: "call", type: "call" }),
      contract({ symbol: "put", type: "put" }),
    ];
    const res = selectOptionContract(chain, "sell");
    expect(res.contract?.type).toBe("put");
  });

  it("returns null with a reason when nothing is eligible", () => {
    const chain = [contract({ openInterest: 1 })];
    const res = selectOptionContract(chain, "buy");
    expect(res.contract).toBeNull();
    expect(res.reason).toMatch(/no liquid call/i);
  });

  it("breaks delta ties by higher open interest", () => {
    const chain = [
      contract({ symbol: "thin", delta: 0.4, openInterest: 600 }),
      contract({ symbol: "thick", delta: 0.4, openInterest: 9000 }),
    ];
    // identical delta -> genuine tie -> prefer higher open interest
    const res = selectOptionContract(chain, "buy");
    expect(res.contract?.symbol).toBe("thick");
  });
});
