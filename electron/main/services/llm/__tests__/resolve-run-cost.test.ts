import { describe, expect, it } from "vitest";
import {
  extractDirectProviderReportedCost,
  extractOpenRouterRawResponseCost,
  extractOpenRouterReportedCost,
  extractProviderReportedCost,
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

  it("prefers OpenRouter cost over direct-provider metadata", () => {
    expect(
      extractProviderReportedCost(
        {
          openrouter: { usage: { cost: 0.002 } },
          anthropic: { usage: { cost: 0.009 } },
        },
        "anthropic",
      ),
    ).toBe(0.002);
  });

  it("extracts direct-provider billed cost when OpenRouter metadata is absent", () => {
    expect(
      extractDirectProviderReportedCost(
        {
          anthropic: {
            usage: {
              cost: 0.0042,
            },
          },
        },
        "anthropic",
      ),
    ).toBe(0.0042);
  });

  it("resolves direct-provider cost through resolveRunCostUsd", () => {
    const result = resolveRunCostUsd({
      modelId: "claude-sonnet-4-20250514",
      inputTokens: 10_000,
      outputTokens: 500,
      providerMetadata: {
        anthropic: {
          usage: {
            cost: 0.0315,
          },
        },
      },
      providerType: "anthropic",
    });

    expect(result).toEqual({
      costUsd: 0.0315,
      costSource: "provider",
    });
  });

  it("extracts cost from a raw OpenRouter chat-completion response body (regression: cost telemetry used to always fall back to estimates)", () => {
    expect(
      extractOpenRouterRawResponseCost({
        id: "gen-123",
        usage: {
          prompt_tokens: 500,
          completion_tokens: 120,
          total_tokens: 620,
          cost: 0.00034,
        },
      }),
    ).toBe(0.00034);
  });

  it("returns null when the raw response has no usage.cost", () => {
    expect(extractOpenRouterRawResponseCost({ id: "gen-123" })).toBeNull();
    expect(extractOpenRouterRawResponseCost(null)).toBeNull();
  });
});
