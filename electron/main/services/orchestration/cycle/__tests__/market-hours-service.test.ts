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

  it("blocks stocks on US market holidays", () => {
    const independenceDay = new Date("2026-07-03T14:00:00.000Z");
    const { excluded } = service.partitionByTradability(
      [stock],
      independenceDay,
    );
    expect(excluded[0]?.reason).toBe("market_holiday");
  });

  it("does not apply exchange-hours filter to crypto", () => {
    const { tradable } = service.partitionByTradability([crypto], afterHoursEt);
    expect(tradable).toEqual([crypto]);
  });

  // Thursday 2026-06-11 18:00 ET — inside the post-market extended window.
  const extendedHoursEt = new Date("2026-06-11T22:00:00.000Z");

  it("allows stocks in the extended window when the session opts in", () => {
    const { tradable, excluded } = service.partitionByTradability(
      [stock],
      extendedHoursEt,
      { offHoursTrading: "extended_hours" },
    );
    expect(tradable).toEqual([stock]);
    expect(excluded).toHaveLength(0);
  });

  it("blocks stocks in the extended window when off-hours trading is disabled", () => {
    const { excluded } = service.partitionByTradability(
      [stock],
      extendedHoursEt,
      { offHoursTrading: "disabled" },
    );
    expect(excluded[0]?.reason).toBe("exchange_closed");
  });

  it("blocks stocks fully overnight even when extended hours are enabled", () => {
    const { excluded } = service.partitionByTradability([stock], afterHoursEt, {
      offHoursTrading: "extended_hours",
    });
    expect(excluded[0]?.reason).toBe("exchange_closed");
  });

  describe("nextTradableAt", () => {
    it("returns the next regular open for a market-hours exclusion", () => {
      // afterHoursEt = Thursday 2026-06-11 22:00 ET → Friday 09:30 ET open.
      const { excluded } = service.partitionByTradability(
        [stock],
        afterHoursEt,
      );
      expect(
        service.nextTradableAt(excluded, afterHoursEt)?.toISOString(),
      ).toBe("2026-06-12T13:30:00.000Z");
    });

    it("honors the extended-hours policy", () => {
      const { excluded } = service.partitionByTradability(
        [stock],
        afterHoursEt,
      );
      expect(
        service
          .nextTradableAt(excluded, afterHoursEt, {
            offHoursTrading: "extended_hours",
          })
          ?.toISOString(),
      ).toBe("2026-06-12T08:00:00.000Z");
    });

    it("returns null when nothing was excluded by market hours", () => {
      expect(service.nextTradableAt([], afterHoursEt)).toBeNull();
    });
  });
});
