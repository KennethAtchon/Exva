import type { ToolSet } from "ai";
import type { z } from "zod";
import type { ProviderAdapter } from "./adapters/provider-adapter";
import type { RuntimeAgentMessage, RunTrace } from "./ai-runtime/ai-runtime-types";

export type HarnessConfig<T = undefined> = {
  provider: ProviderAdapter;
  model: string;
  messages: RuntimeAgentMessage[];
  tools?: ToolSet;
  safetyCapSteps: number;
  spendLimitUsd: number;
  sessionId: string;
  cycleId: string;
  temperature?: number;
  maxTokens?: number;
  schema?: z.ZodType<T>;
};

export async function executeToolUseHarness<T = undefined>(config: HarnessConfig<T>): Promise<RunTrace<T>> {
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
