import { describe, expect, it } from "vitest";
import {
  computeDedupeKey,
  isSignalExpired,
  parseTtlMs,
} from "../market-signal";
import { enrichSignalEvent } from "../signal-bridge";
import type { SignalEvent } from "../signals";

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

describe("enrichSignalEvent", () => {
  const base: SignalEvent = {
    id: "evt-1",
    sourceId: "src-1",
    sourceType: "edgar_8k",
    ticker: "AAPL",
    companyName: "Apple",
    documentUrl: "https://example.com/8k",
    accessionNumber: "0000320193-26-000001",
    payloadJson: { item: "2.02" },
    filedAt: "2026-07-11T10:00:00.000Z",
    detectedAt: "2026-07-11T10:05:00.000Z",
  };

  it("fills kind, ttl, dedupeKey, and occurredAt when missing", () => {
    const enriched = enrichSignalEvent(base);
    expect(enriched.kind).toBe("filing");
    expect(enriched.ttl).toBe("PT6H");
    expect(enriched.dedupeKey).toBe("0000320193-26-000001");
    expect(enriched.occurredAt).toBe("2026-07-11T10:00:00.000Z");
    expect(enriched.payloadV2).toEqual({ item: "2.02" });
  });

  it("is a no-op when kind, dedupeKey, and ttl are already set", () => {
    const already: SignalEvent = {
      ...base,
      kind: "news",
      ttl: "PT1H",
      dedupeKey: "custom",
    };
    expect(enrichSignalEvent(already)).toBe(already);
  });
});
