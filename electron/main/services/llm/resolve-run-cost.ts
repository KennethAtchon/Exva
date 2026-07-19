import { estimateCostUsd } from "./model-pricing";

export type CostSource = "provider" | "estimated";

function readUsageCost(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const cost = (usage as Record<string, unknown>).cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? cost
    : null;
}

export function extractOpenRouterReportedCost(
  providerMetadata: unknown,
): number | null {
  if (!providerMetadata || typeof providerMetadata !== "object") return null;
  const openrouter = (providerMetadata as Record<string, unknown>).openrouter;
  if (!openrouter || typeof openrouter !== "object") return null;
  return readUsageCost((openrouter as Record<string, unknown>).usage);
}

export function extractDirectProviderReportedCost(
  providerMetadata: unknown,
  providerType?: string,
): number | null {
  if (!providerMetadata || typeof providerMetadata !== "object") return null;
  const meta = providerMetadata as Record<string, unknown>;

  if (providerType) {
    const providerBlock = meta[providerType];
    if (providerBlock && typeof providerBlock === "object") {
      const cost = readUsageCost(
        (providerBlock as Record<string, unknown>).usage,
      );
      if (cost != null) return cost;
    }
  }

  if (!meta.openrouter) {
    return readUsageCost(meta.usage);
  }

  return null;
}

/**
 * OpenRouter returns actual per-request cost as a top-level `usage.cost`
 * field on the raw chat-completion response body — but only when the
 * request opts in with `usage: { include: true }`. The AI SDK's generic
 * OpenAI-compatible client (@ai-sdk/openai) doesn't know this field exists,
 * so it never reaches `providerMetadata`; callers must read the raw fetch
 * response JSON directly (see openrouter-adapter.ts's fetch override).
 */
export function extractOpenRouterRawResponseCost(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  return readUsageCost((json as Record<string, unknown>).usage);
}

export function extractProviderReportedCost(
  providerMetadata: unknown,
  providerType?: string,
): number | null {
  return (
    extractOpenRouterReportedCost(providerMetadata) ??
    extractDirectProviderReportedCost(providerMetadata, providerType)
  );
}

export function resolveRunCostUsd(input: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  providerReportedCostUsd?: number | null;
  providerMetadata?: unknown;
  providerType?: string;
}): { costUsd: number; costSource: CostSource } {
  const reported =
    input.providerReportedCostUsd ??
    extractProviderReportedCost(input.providerMetadata, input.providerType);

  if (reported != null && Number.isFinite(reported) && reported >= 0) {
    return {
      costUsd: Number(reported.toFixed(6)),
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
