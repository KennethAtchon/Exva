import type { AgentRole, ProviderType } from "@/lib/types";
import type { PrepareStepFunction, ToolSet } from "ai";
import type { z } from "zod";
import type { ReasoningLevel } from "@electron/shared/ai/ai-phase";
import type {
  LLMMessage,
  LLMCallTrace,
} from "../llm-types";

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
  messages: LLMMessage[];
  tools?: ToolSet;
  maxSteps: number;
  spendLimitUsd: number;
  temperature?: number;
  maxTokens?: number;
  reasoningLevel?: ReasoningLevel;
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
  runAgent<T = undefined>(opts: AgentRunOptions<T>): Promise<LLMCallTrace<T>>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  listModels(): Promise<ModelEntry[]>;
}
