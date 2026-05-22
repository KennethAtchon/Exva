import { estimateCostUsd } from "./model-pricing";

export type CostSource = "provider" | "estimated";

export function extractOpenRouterReportedCost(
  providerMetadata: unknown,
): number | null {
  if (!providerMetadata || typeof providerMetadata !== "object") return null;
  const openrouter = (providerMetadata as Record<string, unknown>).openrouter;
  if (!openrouter || typeof openrouter !== "object") return null;
  const usage = (openrouter as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return null;
  const cost = (usage as Record<string, unknown>).cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? cost
    : null;
}

export function resolveRunCostUsd(input: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  providerReportedCostUsd?: number | null;
}): { costUsd: number; costSource: CostSource } {
  if (
    input.providerReportedCostUsd != null &&
    Number.isFinite(input.providerReportedCostUsd) &&
    input.providerReportedCostUsd >= 0
  ) {
    return {
      costUsd: Number(input.providerReportedCostUsd.toFixed(6)),
      costSource: "provider",
    };
  }

  return {
    costUsd: estimateCostUsd(
      input.modelId,
      input.inputTokens,
      input.outputTokens,
    ),
    costSource: "estimated",
  };
}
