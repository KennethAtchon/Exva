import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { DataDoctorService } from "../data-doctor-service";
import { MarketDataService } from "../../marketdata/market-data-service";
import { EventBus } from "../../infra/event-bus";

describe("DataDoctorService", () => {
  it("detects a poked gap inside claimed coverage", () => {
    const db = createTestDb();
    const marketData = new MarketDataService(db);
    const doctor = new DataDoctorService({
      db,
      marketData,
      eventBus: new EventBus(),
    });

    const bars = [];
    for (let i = 0; i < 20; i++) {
      const ts = new Date(Date.UTC(2024, 0, 1, i)).toISOString();
      bars.push({
        ts,
        open: 100,
        high: 101,
        low: 99,
        close: 100 + i * 0.1,
        volume: 1000,
      });
    }
    marketData.writeBars("SPY", "stock", "1h", bars, "manual");

    const midFrom = bars[8]?.ts;
    const midTo = bars[12]?.ts;
    expect(midFrom && midTo).toBeTruthy();
    if (!midFrom || !midTo) return;
    const deleted = doctor.pokeGap("SPY", "1h", midFrom, midTo);
    expect(deleted).toBeGreaterThan(0);

    const gaps = doctor.detectGaps("SPY", "1h");
    expect(gaps.length).toBeGreaterThan(0);

    const matrix = doctor.coverageMatrix();
    const cell = matrix.find((c) => c.symbol === "SPY" && c.timeframe === "1h");
    expect(cell?.gapCount).toBeGreaterThan(0);
  });
});
