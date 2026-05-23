import { describe, expect, it } from "vitest";
import {
  buildAnthropicReasoningOptions,
  buildOpenAiReasoningOptions,
  buildOpenRouterReasoningOptions,
} from "../reasoning-options";

describe("buildAnthropicReasoningOptions", () => {
  it("returns null for off or missing level", () => {
    expect(buildAnthropicReasoningOptions(undefined, false)).toBeNull();
    expect(buildAnthropicReasoningOptions("off", false)).toBeNull();
  });

  it("maps auto to adaptive regardless of tools", () => {
    expect(buildAnthropicReasoningOptions("auto", false)).toEqual({
      thinking: { type: "adaptive" },
    });
    expect(buildAnthropicReasoningOptions("auto", true)).toEqual({
      thinking: { type: "adaptive" },
    });
  });

  it("uses enabled budgets without tools and adaptive with tools", () => {
    expect(buildAnthropicReasoningOptions("low", false)).toEqual({
      thinking: { type: "enabled", budgetTokens: 2_000 },
    });
    expect(buildAnthropicReasoningOptions("low", true)).toEqual({
      thinking: { type: "adaptive" },
    });
    expect(buildAnthropicReasoningOptions("medium", false)).toEqual({
      thinking: { type: "enabled", budgetTokens: 8_000 },
    });
    expect(buildAnthropicReasoningOptions("high", false)).toEqual({
      thinking: { type: "enabled", budgetTokens: 16_000 },
    });
    expect(buildAnthropicReasoningOptions("max", false)).toEqual({
      thinking: { type: "enabled", budgetTokens: 32_000 },
    });
    expect(buildAnthropicReasoningOptions("max", true)).toEqual({
      thinking: { type: "adaptive" },
    });
  });
});

describe("buildOpenAiReasoningOptions", () => {
  it("returns null for off or missing level", () => {
    expect(buildOpenAiReasoningOptions(undefined)).toBeNull();
    expect(buildOpenAiReasoningOptions("off")).toBeNull();
  });

  it("maps abstract levels to OpenAI reasoning effort", () => {
    expect(buildOpenAiReasoningOptions("auto")).toBe("low");
    expect(buildOpenAiReasoningOptions("low")).toBe("low");
    expect(buildOpenAiReasoningOptions("medium")).toBe("medium");
    expect(buildOpenAiReasoningOptions("high")).toBe("high");
    expect(buildOpenAiReasoningOptions("max")).toBe("xhigh");
  });
});

describe("buildOpenRouterReasoningOptions", () => {
  it("returns null for off or missing level", () => {
    expect(buildOpenRouterReasoningOptions(undefined)).toBeNull();
    expect(buildOpenRouterReasoningOptions("off")).toBeNull();
  });

  it("maps abstract levels to OpenRouter effort", () => {
    expect(buildOpenRouterReasoningOptions("auto")).toEqual({ effort: "low" });
    expect(buildOpenRouterReasoningOptions("low")).toEqual({ effort: "low" });
    expect(buildOpenRouterReasoningOptions("medium")).toEqual({
      effort: "medium",
    });
    expect(buildOpenRouterReasoningOptions("high")).toEqual({ effort: "high" });
    expect(buildOpenRouterReasoningOptions("max")).toEqual({ effort: "high" });
  });
});
