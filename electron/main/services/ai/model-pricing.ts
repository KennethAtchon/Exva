/**
 * Per-1M token USD rates for spend guards and persisted cost estimates.
 * Longest matching prefix wins (plan § Phase 0).
 */
export const MODEL_PRICING_USD_PER_1M: Array<{
  prefix: string;
  inputPer1M: number;
  outputPer1M: number;
}> = [
  // Anthropic (direct)
  { prefix: "claude-opus", inputPer1M: 15, outputPer1M: 75 },
  { prefix: "claude-sonnet", inputPer1M: 3, outputPer1M: 15 },
  { prefix: "claude-haiku", inputPer1M: 0.8, outputPer1M: 4 },
  // OpenAI (direct)
  { prefix: "gpt-4o-mini", inputPer1M: 0.15, outputPer1M: 0.6 },
  { prefix: "gpt-4o", inputPer1M: 2.5, outputPer1M: 10 },
  { prefix: "o3-mini", inputPer1M: 1.1, outputPer1M: 4.4 },
  { prefix: "o3", inputPer1M: 10, outputPer1M: 40 },
  // OpenRouter model IDs use provider/model prefixes.
  { prefix: "anthropic/claude-3-5-sonnet", inputPer1M: 3, outputPer1M: 15 },
  { prefix: "anthropic/claude-3-opus", inputPer1M: 15, outputPer1M: 75 },
  { prefix: "anthropic/claude-3-haiku", inputPer1M: 0.25, outputPer1M: 1.25 },
  { prefix: "openai/gpt-4o-mini", inputPer1M: 0.15, outputPer1M: 0.6 },
  { prefix: "openai/gpt-4o", inputPer1M: 2.5, outputPer1M: 10 },
  { prefix: "google/gemma-4", inputPer1M: 0.1, outputPer1M: 0.3 },
  { prefix: "google/gemma-3", inputPer1M: 0.1, outputPer1M: 0.3 },
  { prefix: "google/gemini-2.5-flash", inputPer1M: 0.15, outputPer1M: 0.6 },
  { prefix: "google/gemini-2.5-pro", inputPer1M: 1.25, outputPer1M: 10 },
  { prefix: "google/gemini-2.0-flash", inputPer1M: 0.1, outputPer1M: 0.4 },
  { prefix: "meta-llama/llama-4", inputPer1M: 0.2, outputPer1M: 0.6 },
  { prefix: "meta-llama/llama-3.3", inputPer1M: 0.2, outputPer1M: 0.6 },
  { prefix: "meta-llama/llama-3.1", inputPer1M: 0.15, outputPer1M: 0.15 },
  { prefix: "mistralai/mistral-large", inputPer1M: 2, outputPer1M: 6 },
  { prefix: "mistralai/mistral-small", inputPer1M: 0.1, outputPer1M: 0.3 },
  { prefix: "mistralai/mixtral", inputPer1M: 0.24, outputPer1M: 0.24 },
  { prefix: "deepseek/deepseek-r1", inputPer1M: 0.55, outputPer1M: 2.19 },
  { prefix: "deepseek/deepseek-chat", inputPer1M: 0.27, outputPer1M: 1.1 },
  { prefix: "qwen/qwen-2.5", inputPer1M: 0.07, outputPer1M: 0.2 },
  { prefix: "", inputPer1M: 1, outputPer1M: 1 },
];

export function resolveModelPricingRates(modelId: string): {
  inputPer1M: number;
  outputPer1M: number;
} {
  const lower = modelId.toLowerCase();
  let match = MODEL_PRICING_USD_PER_1M[MODEL_PRICING_USD_PER_1M.length - 1];
  for (const row of MODEL_PRICING_USD_PER_1M) {
    if (
      lower.startsWith(row.prefix) &&
      row.prefix.length >= (match?.prefix.length ?? 0)
    )
      match = row;
  }
  return match
    ? { inputPer1M: match.inputPer1M, outputPer1M: match.outputPer1M }
    : { inputPer1M: 1, outputPer1M: 1 };
}

export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const { inputPer1M, outputPer1M } = resolveModelPricingRates(modelId);
  const raw =
    (inputTokens / 1_000_000) * inputPer1M +
    (outputTokens / 1_000_000) * outputPer1M;
  return Number(raw.toFixed(6));
}
