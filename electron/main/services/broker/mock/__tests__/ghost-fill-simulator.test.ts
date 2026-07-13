import { describe, expect, it } from "vitest";
import { GhostFillSimulator } from "../ghost-fill-simulator";
import type { BrokerOrderV2 } from "../../order-contract-v2";

function order(
  partial: Partial<BrokerOrderV2> & Pick<BrokerOrderV2, "orderType">,
): BrokerOrderV2 {
  return {
    clientOrderId: partial.clientOrderId ?? "c1",
    instrument: {
      symbol: "BTC/USD",
      instrumentClass: "crypto",
    },
    side: partial.side ?? "BUY",
    quantity: partial.quantity ?? { kind: "units", value: 1 },
    orderType: partial.orderType,
    limitPrice: partial.limitPrice,
    stopPrice: partial.stopPrice,
    timeInForce: "gtc",
  };
}

describe("GhostFillSimulator", () => {
  it("fills market orders at mid", () => {
    const sim = new GhostFillSimulator();
    const receipt = sim.simulateFill(order({ orderType: "market" }), {
      bid: 100,
      ask: 102,
      last: 101,
    });
    expect(receipt.status).toBe("filled");
    expect(receipt.filledAvgPrice).toBe(101);
  });

  it("rests non-marketable limits until quote crosses", () => {
    const sim = new GhostFillSimulator();
    const o = order({
      orderType: "limit",
      limitPrice: 90,
      side: "BUY",
    });
    const open = sim.simulateFill(o, { bid: 100, ask: 102, last: 101 });
    expect(open.status).toBe("open");
    const still = sim.poll(open.ghostOrderId, {
      bid: 100,
      ask: 102,
      last: 101,
    });
    expect(still?.status).toBe("open");
    const filled = sim.poll(open.ghostOrderId, {
      bid: 88,
      ask: 89,
      last: 88.5,
    });
    expect(filled?.status).toBe("filled");
  });

  it("cancels resting ghosts", () => {
    const sim = new GhostFillSimulator();
    const open = sim.simulateFill(
      order({ orderType: "limit", limitPrice: 50, side: "BUY" }),
      { bid: 100, ask: 102, last: 101 },
    );
    const canceled = sim.cancel(open.ghostOrderId);
    expect(canceled?.status).toBe("canceled");
  });

  it("fills marketable buy limits immediately at ask (or better)", () => {
    const sim = new GhostFillSimulator();
    const receipt = sim.simulateFill(
      order({ orderType: "limit", limitPrice: 105, side: "BUY" }),
      { bid: 100, ask: 102, last: 101 },
    );
    expect(receipt.status).toBe("filled");
    expect(receipt.filledAvgPrice).toBe(102);
  });

  it("fills sell limits when bid crosses the limit", () => {
    const sim = new GhostFillSimulator();
    const open = sim.simulateFill(
      order({ orderType: "limit", limitPrice: 110, side: "SELL" }),
      { bid: 100, ask: 102, last: 101 },
    );
    expect(open.status).toBe("open");
    expect(sim.listOpen()).toHaveLength(1);
    const filled = sim.poll(open.ghostOrderId, {
      bid: 111,
      ask: 112,
      last: 111.5,
    });
    expect(filled?.status).toBe("filled");
    expect(filled?.filledAvgPrice).toBe(111);
    expect(sim.listOpen()).toHaveLength(0);
  });
});
