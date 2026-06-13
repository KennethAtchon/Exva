import { describe, expect, it } from "vitest";
import { MarketHoursService } from "../market-hours-service";

describe("MarketHoursService", () => {
  const service = new MarketHoursService();
  const stock = { symbol: "AAPL", instrumentClass: "stock" as const };
  const crypto = { symbol: "BTC-USD", instrumentClass: "crypto" as const };

  // Thursday 2026-06-11 22:00 ET — weekday UTC, after the 16:00 ET close.
  const afterHoursEt = new Date("2026-06-12T02:00:00.000Z");

  it("blocks stocks outside exchange hours for live sessions", () => {
    const { tradable, excluded } = service.partitionByTradability(
      [stock],
      afterHoursEt,
    );
    expect(tradable).toHaveLength(0);
    expect(excluded[0]?.reason).toBe("exchange_closed");
  });

  it("allows mock stocks outside exchange hours when override is set", () => {
    const { tradable, excluded } = service.partitionByTradability(
      [stock],
      afterHoursEt,
      { skipExchangeHoursFilter: true },
    );
    expect(tradable).toEqual([stock]);
    expect(excluded).toHaveLength(0);
  });

  it("still blocks live stocks on UTC weekends", () => {
    const saturday = new Date("2026-06-13T12:00:00.000Z");
    const { excluded } = service.partitionByTradability([stock], saturday);
    expect(excluded[0]?.reason).toBe("weekend_utc_market_closed");
  });

  it("allows mock stocks on UTC weekends when override is set", () => {
    const saturday = new Date("2026-06-13T12:00:00.000Z");
    const { tradable } = service.partitionByTradability([stock], saturday, {
      skipWeekendFilter: true,
      skipExchangeHoursFilter: true,
    });
    expect(tradable).toEqual([stock]);
  });

  it("does not apply exchange-hours filter to crypto", () => {
    const { tradable } = service.partitionByTradability([crypto], afterHoursEt);
    expect(tradable).toEqual([crypto]);
  });
});
