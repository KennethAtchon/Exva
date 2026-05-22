import { describe, expect, it } from "vitest";
import {
  extractOpenRouterReportedCost,
  resolveRunCostUsd,
} from "../resolve-run-cost";

describe("resolveRunCostUsd", () => {
  it("prefers provider-reported OpenRouter cost", () => {
    const result = resolveRunCostUsd({
      modelId: "deepseek/deepseek-v4-flash",
      inputTokens: 30_000,
      outputTokens: 800,
      providerReportedCostUsd: 0.0001714,
    });

    expect(result).toEqual({
      costUsd: 0.000171,
      costSource: "provider",
    });
  });

  it("falls back to pricing-table estimate when provider cost is missing", () => {
    const result = resolveRunCostUsd({
      modelId: "deepseek/deepseek-v4-flash",
      inputTokens: 1_000,
      outputTokens: 200,
      providerReportedCostUsd: null,
    });

    expect(result.costSource).toBe("estimated");
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("extracts OpenRouter usage.cost from providerMetadata", () => {
    expect(
      extractOpenRouterReportedCost({
        openrouter: {
          usage: {
            cost: 0.0015,
            totalTokens: 30,
          },
        },
      }),
    ).toBe(0.0015);
  });
});
