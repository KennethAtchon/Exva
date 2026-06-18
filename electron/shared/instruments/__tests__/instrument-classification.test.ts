import { describe, expect, it } from "vitest";
import {
  classifyInstrumentBySymbol,
  isInstrumentClass,
} from "../instrument-classification";

describe("classifyInstrumentBySymbol", () => {
  it("reads the symbol's shape, not any session context", () => {
    expect(classifyInstrumentBySymbol("AAPL")).toBe("stock");
    // Dashed equity tickers must not be mistaken for crypto pairs.
    expect(classifyInstrumentBySymbol("BRK-B")).toBe("stock");
    expect(classifyInstrumentBySymbol("BTC-USD")).toBe("crypto");
    expect(classifyInstrumentBySymbol("BTC/USD")).toBe("crypto");
    expect(classifyInstrumentBySymbol("eth-usdt")).toBe("crypto");
    expect(classifyInstrumentBySymbol("ESH5")).toBe("futures");
    expect(classifyInstrumentBySymbol("AAPL250117C00150000")).toBe("options");
    expect(classifyInstrumentBySymbol("pm:will-it-rain")).toBe(
      "prediction_market",
    );
  });
});

describe("isInstrumentClass", () => {
  it("accepts known classes and rejects everything else", () => {
    expect(isInstrumentClass("options")).toBe(true);
    expect(isInstrumentClass("crypto")).toBe(true);
    expect(isInstrumentClass("equity")).toBe(false);
    expect(isInstrumentClass(undefined)).toBe(false);
    expect(isInstrumentClass(42)).toBe(false);
  });
});
