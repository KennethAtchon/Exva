import { describe, expect, it } from "vitest";
import { DEFAULT_MOCK_SCENARIO, MockBrokerAdapter } from "./mock-adapter";

describe("MockBrokerAdapter", () => {
  it("defaults to a bullish scenario bias", () => {
    const adapter = new MockBrokerAdapter();

    expect(adapter.getScenarioBias()).toBe(DEFAULT_MOCK_SCENARIO.bias);
  });

  it("produces an uptrend over 30 bars by default", () => {
    const adapter = new MockBrokerAdapter();
    const bars = adapter.getMockOhlcv("NVDA", 30);

    expect(bars).toHaveLength(30);
    expect(bars.at(0)?.close ?? 0).toBeLessThan(bars.at(-1)?.close ?? 0);
  });
});
