import { describe, expect, it } from "vitest";
import {
  getUsEquitySession,
  isEquityTradable,
  nextEquityMarketOpen,
} from "../us-equity-session";

describe("getUsEquitySession", () => {
  it("classifies regular trading hours", () => {
    // Friday 2026-06-12, 10:00 ET.
    expect(getUsEquitySession(new Date("2026-06-12T14:00:00Z"))).toBe(
      "regular",
    );
  });

  it("classifies the pre-market extended window", () => {
    // Friday 2026-06-12, 05:00 ET.
    expect(getUsEquitySession(new Date("2026-06-12T09:00:00Z"))).toBe(
      "extended",
    );
  });

  it("classifies the post-market extended window", () => {
    // Friday 2026-06-12, 18:00 ET.
    expect(getUsEquitySession(new Date("2026-06-12T22:00:00Z"))).toBe(
      "extended",
    );
  });

  it("treats the overnight gap as closed", () => {
    // Friday 2026-06-12, 02:00 ET.
    expect(getUsEquitySession(new Date("2026-06-12T06:00:00Z"))).toBe("closed");
  });

  it("treats weekends as closed", () => {
    // Saturday 2026-06-13, 10:00 ET.
    expect(getUsEquitySession(new Date("2026-06-13T14:00:00Z"))).toBe("closed");
  });

  it("treats US market holidays as closed even during regular hours", () => {
    // Juneteenth (observed) 2026-06-19, 11:00 ET.
    expect(getUsEquitySession(new Date("2026-06-19T15:00:00Z"))).toBe("closed");
  });
});

describe("isEquityTradable", () => {
  it("is tradable during regular hours regardless of policy", () => {
    // Friday 2026-06-12, 10:00 ET.
    const regular = new Date("2026-06-12T14:00:00Z");
    expect(isEquityTradable(regular)).toBe(true);
    expect(isEquityTradable(regular, "extended_hours")).toBe(true);
  });

  it("is tradable in the extended window only with extended_hours", () => {
    // Friday 2026-06-12, 05:00 ET (pre-market).
    const extended = new Date("2026-06-12T09:00:00Z");
    expect(isEquityTradable(extended)).toBe(false);
    expect(isEquityTradable(extended, "extended_hours")).toBe(true);
  });

  it("is never tradable while closed", () => {
    // Saturday 2026-06-13, 10:00 ET.
    const closed = new Date("2026-06-13T14:00:00Z");
    expect(isEquityTradable(closed)).toBe(false);
    expect(isEquityTradable(closed, "extended_hours")).toBe(false);
  });
});

describe("nextEquityMarketOpen", () => {
  it("returns the same instant when already tradable", () => {
    // Friday 2026-06-12, 10:00 ET — regular hours.
    const now = new Date("2026-06-12T14:00:00Z");
    expect(nextEquityMarketOpen(now)?.toISOString()).toBe(
      "2026-06-12T14:00:00.000Z",
    );
  });

  it("waits for the same-day regular open from the overnight gap", () => {
    // Friday 2026-06-12, 02:00 ET (closed) → regular open 09:30 ET.
    const now = new Date("2026-06-12T06:00:00Z");
    expect(nextEquityMarketOpen(now)?.toISOString()).toBe(
      "2026-06-12T13:30:00.000Z",
    );
  });

  it("skips the weekend to Monday's regular open", () => {
    // Saturday 2026-06-13, 10:00 ET → Monday 2026-06-15, 09:30 ET.
    const now = new Date("2026-06-13T14:00:00Z");
    expect(nextEquityMarketOpen(now)?.toISOString()).toBe(
      "2026-06-15T13:30:00.000Z",
    );
  });

  it("skips a holiday to the next trading day's open", () => {
    // Thursday 2026-06-18, 17:00 ET; Fri 06-19 is Juneteenth (holiday) →
    // Monday 2026-06-22, 09:30 ET.
    const now = new Date("2026-06-18T21:00:00Z");
    expect(nextEquityMarketOpen(now)?.toISOString()).toBe(
      "2026-06-22T13:30:00.000Z",
    );
  });

  it("waits for the extended pre-market open when off-hours is enabled", () => {
    // Friday 2026-06-12, 02:00 ET (closed) → extended open 04:00 ET.
    const now = new Date("2026-06-12T06:00:00Z");
    expect(nextEquityMarketOpen(now, "extended_hours")?.toISOString()).toBe(
      "2026-06-12T08:00:00.000Z",
    );
  });
});
