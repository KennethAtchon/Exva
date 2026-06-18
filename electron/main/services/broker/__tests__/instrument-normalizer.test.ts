import { describe, expect, it } from "vitest";
import {
  InstrumentNormalizer,
  resolveCanonicalSymbol,
} from "../instrument-normalizer";

describe("resolveCanonicalSymbol", () => {
  it("normalizes crypto aliases and quote suffixes", () => {
    expect(resolveCanonicalSymbol("bitcoin", "crypto")).toBe("BTC");
    expect(resolveCanonicalSymbol("eth-usd", "crypto")).toBe("ETH");
    expect(resolveCanonicalSymbol("SOLUSDT", "crypto")).toBe("SOL");
  });

  it("uppercases stock symbols and preserves prediction market slugs", () => {
    expect(resolveCanonicalSymbol("aapl", "stock")).toBe("AAPL");
    expect(resolveCanonicalSymbol(" pm:cond-123 ", "prediction_market")).toBe(
      "pm:cond-123",
    );
  });
});

describe("InstrumentNormalizer", () => {
  const normalizer = new InstrumentNormalizer();

  it("formats broker wire symbols per adapter", () => {
    expect(
      normalizer.toBrokerSymbol({
        symbol: "brk-b",
        instrumentClass: "stock",
        brokerType: "alpaca",
      }),
    ).toBe("BRKB");
    expect(
      normalizer.toBrokerSymbol({
        symbol: "btc",
        instrumentClass: "crypto",
        brokerType: "coinbase_advanced_trade",
      }),
    ).toBe("BTC-USD");
    expect(
      normalizer.toBrokerSymbol({
        symbol: "btc-usd",
        instrumentClass: "crypto",
        brokerType: "alpaca",
      }),
    ).toBe("BTC/USD");
    expect(
      normalizer.toBrokerSymbol({
        symbol: "ES",
        instrumentClass: "futures",
        brokerType: "tradovate",
      }),
    ).toBe("ES");
    expect(
      normalizer.toBrokerSymbol({
        symbol: "NVDA",
        instrumentClass: "stock",
        brokerType: "mock",
      }),
    ).toBe("NVDA");
  });

  it("rejects instrument class mismatches for specialized brokers", () => {
    expect(() =>
      normalizer.toBrokerSymbol({
        symbol: "ES",
        instrumentClass: "futures",
        brokerType: "alpaca",
      }),
    ).toThrow(/unsupported instrument/i);
    expect(() =>
      normalizer.toBrokerSymbol({
        symbol: "AAPL",
        instrumentClass: "stock",
        brokerType: "coinbase_advanced_trade",
      }),
    ).toThrow(/non-crypto/i);
    expect(() =>
      normalizer.toBrokerSymbol({
        symbol: "AAPL",
        instrumentClass: "stock",
        brokerType: "tradovate",
      }),
    ).toThrow(/non-futures/i);
  });
});
