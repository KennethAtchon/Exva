import type { ToolSet } from "ai";
import type { z } from "zod";
import type { ProviderAdapter } from "../../llm/adapters/provider-adapter";
import type {
  LLMMessage,
  LLMCallTrace,
} from "../../llm/llm-types";

export type HarnessConfig<T = undefined> = {
  provider: ProviderAdapter;
  model: string;
  messages: LLMMessage[];
  tools?: ToolSet;
  safetyCapSteps: number;
  spendLimitUsd: number;
  sessionId: string;
  cycleId: string;
  temperature?: number;
  maxTokens?: number;
  schema?: z.ZodType<T>;
};

export async function executeToolUseHarness<T = undefined>(
  config: HarnessConfig<T>,
): Promise<LLMCallTrace<T>> {
  return config.provider.runAgent<T>({
    model: config.model,
    messages: config.messages,
    tools: config.tools,
    maxSteps: config.safetyCapSteps,
    spendLimitUsd: config.spendLimitUsd,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    schema: config.schema,
  });
}
