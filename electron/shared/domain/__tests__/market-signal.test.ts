import { describe, expect, it } from "vitest";
import {
  computeDedupeKey,
  isSignalExpired,
  parseTtlMs,
} from "../market-signal";

describe("parseTtlMs", () => {
  it("parses ISO-8601 PnDTnHnMnS durations", () => {
    expect(parseTtlMs("PT2H")).toBe(2 * 3_600_000);
    expect(parseTtlMs("PT15M")).toBe(15 * 60_000);
    expect(parseTtlMs("P1DT6H")).toBe((24 + 6) * 3_600_000);
    expect(parseTtlMs("PT30S")).toBe(30_000);
  });

  it("parses cadence-style strings", () => {
    expect(parseTtlMs("4h")).toBe(4 * 3_600_000);
    expect(parseTtlMs("15m")).toBe(15 * 60_000);
    expect(parseTtlMs("1d")).toBe(86_400_000);
  });

  it("falls back to 4h for unparseable input", () => {
    expect(parseTtlMs("nope")).toBe(4 * 3_600_000);
  });
});

describe("isSignalExpired", () => {
  const detectedAt = "2026-07-11T12:00:00.000Z";
  const detectedMs = Date.parse(detectedAt);

  it("is false before TTL elapses", () => {
    expect(isSignalExpired(detectedAt, "PT1H", detectedMs + 30 * 60_000)).toBe(
      false,
    );
  });

  it("is true after TTL elapses", () => {
    expect(isSignalExpired(detectedAt, "PT1H", detectedMs + 61 * 60_000)).toBe(
      true,
    );
  });
});

describe("computeDedupeKey", () => {
  it("orders parts stably by key", () => {
    expect(computeDedupeKey("filing", { accession: "a", ticker: "AAPL" })).toBe(
      computeDedupeKey("filing", { ticker: "AAPL", accession: "a" }),
    );
    expect(computeDedupeKey("scan_hit", { symbol: "SPY", z: 2 })).toBe(
      "scan_hit:symbol=SPY|z=2",
    );
  });

  it("treats null/undefined as empty", () => {
    expect(computeDedupeKey("manual", { note: null, id: undefined })).toBe(
      "manual:id=|note=",
    );
  });
});
