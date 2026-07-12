import { describe, expect, it, vi } from "vitest";
import { BrokerService } from "../broker-service";
import type { BrokerRegistry } from "../broker-registry";

describe("BrokerService", () => {
  it("delegates closeOrder to the registry adapter", async () => {
    const closeOrder = vi.fn(async () => ({
      brokerOrderId: "order-1",
      realizedPnlUsd: 42.5,
    }));
    const registry = {
      get: vi.fn(async () => ({ closeOrder })),
    } as unknown as BrokerRegistry;

    const service = new BrokerService(registry);
    const result = await service.closeOrder("broker-1", "order-1");

    expect(registry.get).toHaveBeenCalledWith("broker-1");
    expect(closeOrder).toHaveBeenCalledWith("order-1");
    expect(result).toEqual({
      brokerOrderId: "order-1",
      realizedPnlUsd: 42.5,
    });
  });
});
