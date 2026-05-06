/**
 * Per-1M token USD rates for spend guards and persisted cost estimates.
 * Longest matching prefix wins (plan § Phase 0).
 */
export const MODEL_PRICING_USD_PER_1M: Array<{ prefix: string; inputPer1M: number; outputPer1M: number }> = [
  { prefix: "claude-opus", inputPer1M: 15, outputPer1M: 75 },
  { prefix: "claude-sonnet", inputPer1M: 3, outputPer1M: 15 },
  { prefix: "claude-haiku", inputPer1M: 0.8, outputPer1M: 4 },
  { prefix: "gpt-4o-mini", inputPer1M: 0.15, outputPer1M: 0.6 },
  { prefix: "gpt-4o", inputPer1M: 2.5, outputPer1M: 10 },
];

const DEFAULT_RATE = { inputPer1M: 3, outputPer1M: 15 };

export function resolveModelPricingRates(modelId: string): { inputPer1M: number; outputPer1M: number } {
  const lower = modelId.toLowerCase();
  for (let i = MODEL_PRICING_USD_PER_1M.length - 1; i >= 0; i--) {
    const row = MODEL_PRICING_USD_PER_1M[i];
    if (row && lower.startsWith(row.prefix)) return row;
  }
  return DEFAULT_RATE;
}

export function estimateCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const { inputPer1M, outputPer1M } = resolveModelPricingRates(modelId);
  const raw = (inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M;
  return Number(raw.toFixed(6));
}
