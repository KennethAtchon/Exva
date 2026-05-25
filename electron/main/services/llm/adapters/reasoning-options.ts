import type { ReasoningLevel } from "@electron/shared/ai/ai-phase";

type AnthropicThinkingOption =
  | { type: "enabled"; budgetTokens: number }
  | { type: "adaptive" }
  | { type: "disabled" };

export type AnthropicReasoningOptions = {
  thinking: AnthropicThinkingOption;
};

export type OpenAiReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

type OpenRouterReasoningEffort = "low" | "medium" | "high";

export type OpenRouterReasoningOptions = {
  effort: OpenRouterReasoningEffort;
};

export function buildAnthropicReasoningOptions(
  level: ReasoningLevel | undefined,
  hasTools: boolean,
): AnthropicReasoningOptions | null {
  if (!level || level === "off") return null;

  if (level === "auto") {
    return { thinking: { type: "adaptive" } };
  }

  if (hasTools) {
    return { thinking: { type: "adaptive" } };
  }

  const budgetByLevel: Record<
    Exclude<ReasoningLevel, "off" | "auto">,
    number
  > = {
    low: 2_000,
    medium: 8_000,
    high: 16_000,
    max: 32_000,
  };

  return {
    thinking: {
      type: "enabled",
      budgetTokens: budgetByLevel[level],
    },
  };
}

export function buildOpenAiReasoningOptions(
  level: ReasoningLevel | undefined,
): OpenAiReasoningEffort | null {
  if (!level || level === "off") return null;

  const effortByLevel: Record<
    Exclude<ReasoningLevel, "off">,
    OpenAiReasoningEffort
  > = {
    auto: "low",
    low: "low",
    medium: "medium",
    high: "high",
    max: "xhigh",
  };

  return effortByLevel[level];
}

export function buildOpenRouterReasoningOptions(
  level: ReasoningLevel | undefined,
): OpenRouterReasoningOptions | null {
  if (!level || level === "off") return null;

  const effortByLevel: Record<
    Exclude<ReasoningLevel, "off" | "max">,
    OpenRouterReasoningEffort
  > = {
    auto: "low",
    low: "low",
    medium: "medium",
    high: "high",
  };

  if (level === "max") {
    return { effort: "high" };
  }

  return { effort: effortByLevel[level] };
}
