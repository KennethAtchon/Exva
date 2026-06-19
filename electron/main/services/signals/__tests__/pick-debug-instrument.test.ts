import { describe, expect, it } from "vitest";
import type { InstrumentClass } from "@/lib/types";
import { pickDebugInstrument } from "../signal-bus";

const supports =
  (...classes: InstrumentClass[]) =>
  () =>
    classes;

describe("pickDebugInstrument", () => {
  it("prefers crypto (BTC-USD) so the debug trade fills 24/7", () => {
    // A broker that supports both stock and crypto must resolve to crypto:
    // a stock market order placed off-hours only queues and never fills.
    expect(pickDebugInstrument(["b1"], supports("stock", "crypto"))).toEqual({
      instrumentClass: "crypto",
      symbol: "BTC-USD",
    });
  });

  it("falls back to stock (SPY) when crypto is unavailable", () => {
    expect(pickDebugInstrument(["b1"], supports("stock"))).toEqual({
      instrumentClass: "stock",
      symbol: "SPY",
    });
  });

  it("throws when no broker supports a class with a safe default", () => {
    expect(() =>
      pickDebugInstrument(["b1"], supports("futures", "options")),
    ).toThrow(/no safe default symbol/i);
  });
});
