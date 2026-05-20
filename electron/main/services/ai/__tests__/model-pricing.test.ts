import { describe, expect, it } from "vitest";
import { estimateCostUsd, resolveModelPricingRates } from "../model-pricing";

describe("model pricing", () => {
  it("resolves Gemma OpenRouter pricing", () => {
    expect(resolveModelPricingRates("google/gemma-4-31b-it")).toEqual({
      inputPer1M: 0.1,
      outputPer1M: 0.3,
    });
  });

  it("resolves Llama family pricing by prefix", () => {
    expect(
      resolveModelPricingRates("meta-llama/llama-3.3-70b-instruct"),
    ).toEqual({
      inputPer1M: 0.2,
      outputPer1M: 0.6,
    });
  });

  it("uses the wildcard fallback instead of claude-sonnet rates", () => {
    expect(resolveModelPricingRates("unknown-provider/model")).toEqual({
      inputPer1M: 1,
      outputPer1M: 1,
    });
  });

  it("keeps direct claude-sonnet pricing", () => {
    expect(resolveModelPricingRates("claude-sonnet-4")).toEqual({
      inputPer1M: 3,
      outputPer1M: 15,
    });
  });

  it("estimates Gemma cost from token counts", () => {
    expect(estimateCostUsd("google/gemma-4-31b-it", 30_514, 729)).toBe(0.00327);
  });
});
