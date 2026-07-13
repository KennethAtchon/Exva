import { describe, expect, it } from "vitest";
import {
  cadenceLabel,
  cadenceShortLabel,
  cadenceToMs,
  parseCadence,
  parseLegacyCadenceLabel,
  serializeCadenceCanonical,
} from "../cadence";

// ---------------------------------------------------------------------------
// parseCadence — valid inputs
// ---------------------------------------------------------------------------

describe("parseCadence — valid", () => {
  it("accepts a minimal interval cadence", () => {
    const result = parseCadence({ kind: "interval", every: 15, unit: "minute" });
    expect(result).toMatchObject({ kind: "interval", every: 15, unit: "minute" });
  });

  it("accepts an interval cadence with explicit jitterPct", () => {
    const result = parseCadence({
      kind: "interval",
      every: 1,
      unit: "hour",
      jitterPct: 0.1,
    });
    expect(result).toMatchObject({ jitterPct: 0.1 });
  });

  it("defaults jitterPct to 0.05 when omitted", () => {
    const result = parseCadence({ kind: "interval", every: 4, unit: "hour" });
    if (result.kind !== "interval") throw new Error("wrong kind");
    expect(result.jitterPct).toBe(0.05);
  });

  it("accepts a cron cadence", () => {
    const result = parseCadence({
      kind: "cron",
      expression: "*/15 * * * *",
      timezone: "America/New_York",
    });
    expect(result).toMatchObject({ kind: "cron", expression: "*/15 * * * *" });
  });
});

// ---------------------------------------------------------------------------
// parseCadence — rejects malformed / zero / negative
// ---------------------------------------------------------------------------

describe("parseCadence — invalid", () => {
  it("rejects a missing kind", () => {
    expect(() => parseCadence({ every: 15, unit: "minute" })).toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      parseCadence({ kind: "timer", every: 15, unit: "minute" }),
    ).toThrow();
  });

  it("rejects every = 0", () => {
    expect(() =>
      parseCadence({ kind: "interval", every: 0, unit: "minute" }),
    ).toThrow();
  });

  it("rejects every = -5", () => {
    expect(() =>
      parseCadence({ kind: "interval", every: -5, unit: "hour" }),
    ).toThrow();
  });

  it("rejects a fractional every value", () => {
    expect(() =>
      parseCadence({ kind: "interval", every: 1.5, unit: "hour" }),
    ).toThrow();
  });

  it("rejects an unsupported unit", () => {
    expect(() =>
      parseCadence({ kind: "interval", every: 5, unit: "week" }),
    ).toThrow();
  });

  it("rejects jitterPct above 0.25", () => {
    expect(() =>
      parseCadence({ kind: "interval", every: 15, unit: "minute", jitterPct: 0.5 }),
    ).toThrow();
  });

  it("rejects a cron with empty expression", () => {
    expect(() =>
      parseCadence({ kind: "cron", expression: "", timezone: "UTC" }),
    ).toThrow();
  });

  it("rejects a cron with empty timezone", () => {
    expect(() =>
      parseCadence({ kind: "cron", expression: "* * * * *", timezone: "" }),
    ).toThrow();
  });

  it("rejects null", () => {
    expect(() => parseCadence(null)).toThrow();
  });

  it("rejects a plain string", () => {
    expect(() => parseCadence("15m")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// serializeCadenceCanonical — stable and normalizing
// ---------------------------------------------------------------------------

describe("serializeCadenceCanonical", () => {
  it("produces the same string for semantically equal interval cadences", () => {
    const a = parseCadence({ kind: "interval", every: 60, unit: "minute" });
    const b = parseCadence({ kind: "interval", every: 1, unit: "hour" });
    expect(serializeCadenceCanonical(a)).toBe(serializeCadenceCanonical(b));
  });

  it("normalizes 24h to 1d", () => {
    const a = parseCadence({ kind: "interval", every: 24, unit: "hour" });
    const b = parseCadence({ kind: "interval", every: 1, unit: "day" });
    expect(serializeCadenceCanonical(a)).toBe(serializeCadenceCanonical(b));
  });

  it("produces the same string regardless of key insertion order", () => {
    const base = parseCadence({ kind: "interval", every: 15, unit: "minute" });
    const s1 = serializeCadenceCanonical(base);
    // Narrow to interval, then build a copy with a different key insertion order.
    if (base.kind !== "interval") throw new Error("expected interval");
    const { unit, every, jitterPct, kind } = base;
    const reordered = { unit, every, jitterPct, kind } as typeof base;
    const s2 = serializeCadenceCanonical(reordered);
    expect(s1).toBe(s2);
  });

  it("does not conflate distinct cadences", () => {
    const a = parseCadence({ kind: "interval", every: 15, unit: "minute" });
    const b = parseCadence({ kind: "interval", every: 1, unit: "hour" });
    expect(serializeCadenceCanonical(a)).not.toBe(serializeCadenceCanonical(b));
  });

  it("serializes cron cadences stably", () => {
    const c = parseCadence({
      kind: "cron",
      expression: "0 9 * * 1-5",
      timezone: "America/New_York",
    });
    expect(serializeCadenceCanonical(c)).toBe(serializeCadenceCanonical(c));
  });

  it("returns valid JSON", () => {
    const c = parseCadence({ kind: "interval", every: 4, unit: "hour" });
    expect(() => JSON.parse(serializeCadenceCanonical(c))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// cadenceToMs
// ---------------------------------------------------------------------------

describe("cadenceToMs", () => {
  it("converts 15 minutes to 900_000 ms", () => {
    const c = parseCadence({ kind: "interval", every: 15, unit: "minute" });
    expect(cadenceToMs(c)).toBe(900_000);
  });

  it("converts 1 hour to 3_600_000 ms", () => {
    const c = parseCadence({ kind: "interval", every: 1, unit: "hour" });
    expect(cadenceToMs(c)).toBe(3_600_000);
  });

  it("converts 1 day to 86_400_000 ms", () => {
    const c = parseCadence({ kind: "interval", every: 1, unit: "day" });
    expect(cadenceToMs(c)).toBe(86_400_000);
  });

  it("throws for cron cadences", () => {
    const c = parseCadence({
      kind: "cron",
      expression: "0 9 * * 1-5",
      timezone: "UTC",
    });
    expect(() => cadenceToMs(c)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// cadenceLabel / cadenceShortLabel
// ---------------------------------------------------------------------------

describe("cadenceLabel", () => {
  it("labels a 15-minute cadence", () => {
    const c = parseCadence({ kind: "interval", every: 15, unit: "minute" });
    expect(cadenceLabel(c)).toBe("every 15m");
  });

  it("labels a 1-hour cadence", () => {
    const c = parseCadence({ kind: "interval", every: 1, unit: "hour" });
    expect(cadenceLabel(c)).toBe("every 1h");
  });

  it("normalizes 60 minutes to 1h in label", () => {
    const c = parseCadence({ kind: "interval", every: 60, unit: "minute" });
    expect(cadenceLabel(c)).toBe("every 1h");
  });

  it("labels a cron cadence", () => {
    const c = parseCadence({
      kind: "cron",
      expression: "0 9 * * 1-5",
      timezone: "America/New_York",
    });
    expect(cadenceLabel(c)).toContain("0 9 * * 1-5");
    expect(cadenceLabel(c)).toContain("America/New_York");
  });
});

describe("cadenceShortLabel", () => {
  it("returns 15m for 15-minute cadence", () => {
    const c = parseCadence({ kind: "interval", every: 15, unit: "minute" });
    expect(cadenceShortLabel(c)).toBe("15m");
  });

  it("returns 4h for 4-hour cadence", () => {
    const c = parseCadence({ kind: "interval", every: 4, unit: "hour" });
    expect(cadenceShortLabel(c)).toBe("4h");
  });

  it("returns 1h for 60-minute cadence after normalization", () => {
    const c = parseCadence({ kind: "interval", every: 60, unit: "minute" });
    expect(cadenceShortLabel(c)).toBe("1h");
  });
});

// ---------------------------------------------------------------------------
// parseLegacyCadenceLabel
// ---------------------------------------------------------------------------

describe("parseLegacyCadenceLabel", () => {
  it('parses "15m"', () => {
    const result = parseLegacyCadenceLabel("15m");
    expect(result).toMatchObject({ kind: "interval", every: 15, unit: "minute" });
  });

  it('parses "1h"', () => {
    const result = parseLegacyCadenceLabel("1h");
    expect(result).toMatchObject({ kind: "interval", every: 1, unit: "hour" });
  });

  it('parses "4h"', () => {
    const result = parseLegacyCadenceLabel("4h");
    expect(result).toMatchObject({ kind: "interval", every: 4, unit: "hour" });
  });

  it('parses "1d"', () => {
    const result = parseLegacyCadenceLabel("1d");
    expect(result).toMatchObject({ kind: "interval", every: 1, unit: "day" });
  });

  it("trims surrounding whitespace", () => {
    const result = parseLegacyCadenceLabel("  30m  ");
    expect(result).toMatchObject({ kind: "interval", every: 30, unit: "minute" });
  });

  it("rejects empty string", () => {
    expect(() => parseLegacyCadenceLabel("")).toThrow();
  });

  it("rejects '0m'", () => {
    // parseCadence rejects every=0
    expect(() => parseLegacyCadenceLabel("0m")).toThrow();
  });

  it("rejects negative-like strings", () => {
    expect(() => parseLegacyCadenceLabel("-15m")).toThrow();
  });

  it("rejects a bare number", () => {
    expect(() => parseLegacyCadenceLabel("15")).toThrow();
  });

  it("rejects an unknown suffix", () => {
    expect(() => parseLegacyCadenceLabel("15w")).toThrow();
  });

  it("rejects 'timer'", () => {
    expect(() => parseLegacyCadenceLabel("timer")).toThrow();
  });

  it("rejects ISO-8601 duration strings", () => {
    expect(() => parseLegacyCadenceLabel("PT15M")).toThrow();
  });
});
