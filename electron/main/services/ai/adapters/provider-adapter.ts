import type { ProviderType } from "@/lib/types";
import type { ToolSet } from "ai";
import type { z } from "zod";

export interface GenerateTextOptions {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSet;
}

export interface GenerateObjectOptions<T> extends GenerateTextOptions {
  schema: z.ZodType<T>;
}

export interface GenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface GenerateObjectResult<T> extends GenerateResult {
  object: T;
}

export interface ProviderAdapter {
  readonly providerType: ProviderType;
  generateText(opts: GenerateTextOptions): Promise<GenerateResult>;
  generateObject<T>(opts: GenerateObjectOptions<T>): Promise<GenerateObjectResult<T>>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}
