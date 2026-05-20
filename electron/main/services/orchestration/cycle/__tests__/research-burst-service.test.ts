import { describe, expect, it } from "vitest";
import { ResearchBurstService } from "../research-burst-service";
import { MarketHoursService } from "../market-hours-service";

describe("research-burst-service", () => {
  it("filters non-tradable instruments and keeps tradable ones", async () => {
    const resolvedRows = [
      { symbol: "AAPL", instrumentClass: "stock" as const },
      { symbol: "BTC-USD", instrumentClass: "crypto" as const },
    ];
    const orchestrator = {
      resolveInstrumentsForBurst: async () => resolvedRows,
    };
    const marketHours = {
      filterTradable: (rows: Array<{ symbol: string }>) => rows.filter((r) => r.symbol === "BTC-USD"),
    };

    const service = new ResearchBurstService(orchestrator as never, marketHours as unknown as MarketHoursService);
    const out = await service.resolve({} as never, {} as never);

    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe("BTC-USD");
  });

  it("returns empty list when burst resolves to no tradable instruments", async () => {
    const service = new ResearchBurstService(
      { resolveInstrumentsForBurst: async () => [] } as never,
      { filterTradable: () => [] } as unknown as MarketHoursService,
    );
    await expect(service.resolve({} as never, {} as never)).resolves.toEqual([]);
  });
});
