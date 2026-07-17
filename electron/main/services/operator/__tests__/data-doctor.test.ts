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
    db.sqlite.close();
  });

  it("marks providers with zero calls as fully degraded", () => {
    const db = createTestDb();
    const doctor = new DataDoctorService({
      db,
      marketData: new MarketDataService(db),
      eventBus: new EventBus(),
    });
    const health = doctor.providerHealth();
    const alpaca = health.find((p) => p.provider === "alpaca");
    expect(alpaca).toBeTruthy();
    expect(alpaca?.successCount24h).toBe(0);
    expect(alpaca?.errorRate).toBe(1);
    db.sqlite.close();
  });

  it("does not flag Fri→Mon daily spans as gaps", () => {
    const db = createTestDb();
    const marketData = new MarketDataService(db);
    const doctor = new DataDoctorService({
      db,
      marketData,
      eventBus: new EventBus(),
    });
    const bars = [
      {
        ts: "2024-01-05T00:00:00.000Z", // Fri
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
      },
      {
        ts: "2024-01-08T00:00:00.000Z", // Mon
        open: 100,
        high: 101,
        low: 99,
        close: 101,
        volume: 1000,
      },
    ];
    marketData.writeBars("SPY", "stock", "1d", bars, "manual");
    expect(doctor.detectGaps("SPY", "1d")).toHaveLength(0);
    db.sqlite.close();
  });
});
