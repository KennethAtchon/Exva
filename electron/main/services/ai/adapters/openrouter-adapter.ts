import type {
  AgentRunOptions,
  GenerateObjectOptions,
  GenerateObjectResult,
  GenerateResult,
  GenerateTextOptions,
  ProviderAdapter,
} from "./provider-adapter";
import { executeRunAgent } from "./run-agent-execute";
import type { RunTrace } from "../ai-runtime/ai-runtime-types";

function readUsage(usage: { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number } | undefined): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
    outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
  };
}

export class OpenRouterAdapter implements ProviderAdapter {
  readonly providerType = "openrouter" as const;
  private static readonly DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl?: string,
  ) {}

  async runAgent<T = undefined>(opts: AgentRunOptions<T>): Promise<RunTrace<T>> {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const client = createOpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl?.trim() || OpenRouterAdapter.DEFAULT_BASE_URL,
    });
    return executeRunAgent({
      model: client(opts.model),
      modelId: opts.model,
      messages: opts.messages,
      tools: opts.tools,
      maxSteps: opts.maxSteps,
      spendLimitUsd: opts.spendLimitUsd,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
      abortSignal: opts.abortSignal,
      schema: opts.schema,
    });
  }

  async generateText(opts: GenerateTextOptions): Promise<GenerateResult> {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { generateText } = await import("ai");
    const client = createOpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl?.trim() || OpenRouterAdapter.DEFAULT_BASE_URL,
    });
    const started = Date.now();
    const result = await generateText({
      model: client(opts.model),
      system: opts.systemPrompt,
      prompt: opts.userPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
      tools: opts.tools,
    });
    const usage = readUsage(result.usage);
    return {
      text: result.text,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      durationMs: Date.now() - started,
    };
  }

  async generateObject<T>(opts: GenerateObjectOptions<T>): Promise<GenerateObjectResult<T>> {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { generateObject } = await import("ai");
    const client = createOpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl?.trim() || OpenRouterAdapter.DEFAULT_BASE_URL,
    });
    const started = Date.now();
    const result = await generateObject({
      model: client(opts.model),
      system: opts.systemPrompt,
      prompt: opts.userPrompt,
      schema: opts.schema,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
      tools: opts.tools,
    });
    const usage = readUsage(result.usage);
    return {
      object: result.object,
      text: JSON.stringify(result.object),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      durationMs: Date.now() - started,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.generateText({
        model: "openai/gpt-4o-mini",
        systemPrompt: "Reply with the single word: ok",
        userPrompt: "ping",
        temperature: 0,
        maxTokens: 4,
      });
      return { ok: true };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = raw.includes("platform.openai.com/account/api-keys")
        ? "OpenRouter authentication failed. Check that your key starts with `sk-or-` and that the base URL is `https://openrouter.ai/api/v1` (or left empty)."
        : raw;
      return { ok: false, error: message };
    }
  }
}
