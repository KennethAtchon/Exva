import type { AgentRole, ProviderType } from "@/lib/types";
import type { PrepareStepFunction, ToolSet } from "ai";
import type { z } from "zod";
import type {
  RuntimeAgentMessage,
  RunTrace,
} from "../ai-runtime/ai-runtime-types";

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
  role?: AgentRole;
  workerId?: string;
  workerName?: string;
  sessionId?: string;
  cycleId?: string | null;
  tradeId?: string | null;
  messages: RuntimeAgentMessage[];
  tools?: ToolSet;
  maxSteps: number;
  spendLimitUsd: number;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  schema?: z.ZodType<T>;
  terminalToolNames?: string[];
  prepareStep?: PrepareStepFunction<ToolSet>;
}

export interface ModelEntry {
  id: string;
  label: string;
  maxContextTokens: number;
}

export interface ProviderAdapter {
  readonly providerType: ProviderType;
  generateText(opts: GenerateTextOptions): Promise<GenerateResult>;
  generateObject<T>(
    opts: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<T>>;
  runAgent<T = undefined>(opts: AgentRunOptions<T>): Promise<RunTrace<T>>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  listModels(): Promise<ModelEntry[]>;
}
