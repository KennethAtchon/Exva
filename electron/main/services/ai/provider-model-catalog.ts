import type { ProviderType } from "@/lib/types";

export type ModelEntry = {
  id: string;
  label: string;
  maxContextTokens: number;
};

export const MODEL_CATALOG: Record<ProviderType, ModelEntry[]> = {
  anthropic: [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", maxContextTokens: 200000 },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", maxContextTokens: 200000 },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", maxContextTokens: 200000 },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o", maxContextTokens: 128000 },
    { id: "gpt-4o-mini", label: "GPT-4o Mini", maxContextTokens: 128000 },
    { id: "o3-mini", label: "o3-mini", maxContextTokens: 200000 },
  ],
  openrouter: [],
};
