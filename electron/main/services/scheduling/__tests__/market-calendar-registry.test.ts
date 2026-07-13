import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  MarketCalendarRegistry,
  getMarketCalendarRegistry,
} from "../market-calendar-registry";

describe("MarketCalendarRegistry", () => {
  it("registers and retrieves a calendar", () => {
    const registry = new MarketCalendarRegistry();
    registry.register({ id: "test", isOpen: () => true });
    expect(registry.get("test")).not.toBeNull();
    expect(registry.get("test")?.isOpen()).toBe(true);
  });

  it("returns null for unknown calendar", () => {
    const registry = new MarketCalendarRegistry();
    expect(registry.get("nonexistent")).toBeNull();
  });

  it("throws on duplicate registration", () => {
    const registry = new MarketCalendarRegistry();
    registry.register({ id: "dup", isOpen: () => true });
    expect(() =>
      registry.register({ id: "dup", isOpen: () => false }),
    ).toThrow(/already registered/i);
  });

  it("require() returns a registered calendar", () => {
    const registry = new MarketCalendarRegistry();
    registry.register({ id: "cal", isOpen: () => false });
    expect(() => registry.require("cal")).not.toThrow();
  });

  it("require() throws for unknown id", () => {
    const registry = new MarketCalendarRegistry();
    expect(() => registry.require("ghost")).toThrow(/not found/i);
  });

  it("list() returns all registered calendars", () => {
    const registry = new MarketCalendarRegistry();
    registry.register({ id: "a", isOpen: () => true });
    registry.register({ id: "b", isOpen: () => false });
    const ids = registry.list().map((c) => c.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });
});

describe("getMarketCalendarRegistry — built-in calendars", () => {
  it("has nyse-regular, nyse-extended, always-open", () => {
    const registry = getMarketCalendarRegistry();
    expect(registry.get("nyse-regular")).not.toBeNull();
    expect(registry.get("nyse-extended")).not.toBeNull();
    expect(registry.get("always-open")).not.toBeNull();
  });

  it("always-open is always open regardless of time", () => {
    const registry = getMarketCalendarRegistry();
    const cal = registry.require("always-open");
    // Test several arbitrary times
    expect(cal.isOpen(new Date("2024-01-06T03:00:00Z"))).toBe(true); // Saturday UTC
    expect(cal.isOpen(new Date("2024-01-07T03:00:00Z"))).toBe(true); // Sunday UTC
    expect(cal.isOpen(new Date("2024-01-08T09:00:00Z"))).toBe(true); // Monday
  });

  it("nyse-regular is closed on weekends (ET)", () => {
    const registry = getMarketCalendarRegistry();
    const cal = registry.require("nyse-regular");
    // Saturday 12:00 ET
    const saturday = new Date("2024-01-06T17:00:00Z"); // 12:00 ET (UTC-5)
    expect(cal.isOpen(saturday)).toBe(false);
    // Sunday 12:00 ET
    const sunday = new Date("2024-01-07T17:00:00Z");
    expect(cal.isOpen(sunday)).toBe(false);
  });

  it("nyse-regular is open on a weekday during regular hours", () => {
    const registry = getMarketCalendarRegistry();
    const cal = registry.require("nyse-regular");
    // Monday 10:00 ET = 15:00 UTC (in January, UTC-5)
    const mondayMorning = new Date("2024-01-08T15:00:00Z");
    expect(cal.isOpen(mondayMorning)).toBe(true);
  });

  it("nyse-regular is closed before market open (08:00 ET)", () => {
    const registry = getMarketCalendarRegistry();
    const cal = registry.require("nyse-regular");
    // Monday 08:00 ET = 13:00 UTC
    const preOpen = new Date("2024-01-08T13:00:00Z");
    expect(cal.isOpen(preOpen)).toBe(false);
  });

  it("nyse-extended is open during extended hours", () => {
    const registry = getMarketCalendarRegistry();
    const cal = registry.require("nyse-extended");
    // Monday 05:30 ET = 10:30 UTC (pre-market)
    const preMarket = new Date("2024-01-08T10:30:00Z");
    expect(cal.isOpen(preMarket)).toBe(true);
  });

  it("returns the same singleton on repeated calls", () => {
    expect(getMarketCalendarRegistry()).toBe(getMarketCalendarRegistry());
  });
});
