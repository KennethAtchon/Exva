import type { ProviderType } from "@/lib/types";
import type { ToolSet } from "ai";
import type { z } from "zod";
import type { RuntimeAgentMessage, RunTrace } from "../ai-runtime-types";

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

export interface AgentRunOptions<T = undefined> {
  model: string;
  messages: RuntimeAgentMessage[];
  tools?: ToolSet;
  maxSteps: number;
  spendLimitUsd: number;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  schema?: z.ZodType<T>;
}

export interface ProviderAdapter {
  readonly providerType: ProviderType;
  generateText(opts: GenerateTextOptions): Promise<GenerateResult>;
  generateObject<T>(opts: GenerateObjectOptions<T>): Promise<GenerateObjectResult<T>>;
  runAgent<T = undefined>(opts: AgentRunOptions<T>): Promise<RunTrace<T>>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}
