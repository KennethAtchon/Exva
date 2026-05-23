import type { OpenAIProvider, OpenAIProviderSettings } from "@ai-sdk/openai";
import type {
  AgentRunOptions,
  GenerateObjectOptions,
  GenerateObjectResult,
  GenerateResult,
  GenerateTextOptions,
  ModelEntry,
  ProviderAdapter,
} from "./provider-adapter";
import { executeRunAgent } from "./run-agent-execute";
import { buildOpenRouterReasoningOptions } from "./reasoning-options";
import type { LLMCallTrace } from "../llm-types";

function readUsage(
  usage:
    | {
        inputTokens?: number;
        outputTokens?: number;
        promptTokens?: number;
        completionTokens?: number;
      }
    | undefined,
): {
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

  private async createClient(
    reasoning?: ReturnType<typeof buildOpenRouterReasoningOptions>,
  ): Promise<OpenAIProvider> {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const opts: OpenAIProviderSettings = {
      apiKey: this.apiKey,
      baseURL: this.baseUrl?.trim() || OpenRouterAdapter.DEFAULT_BASE_URL,
    };
    if (reasoning) {
      opts.fetch = async (url, init) => {
        if (init?.body && typeof init.body === "string") {
          try {
            const body = JSON.parse(init.body) as Record<string, unknown>;
            body.reasoning = reasoning;
            return fetch(url, { ...init, body: JSON.stringify(body) });
          } catch {
            // Fall through to the default fetch if the body is not JSON.
          }
        }
        return fetch(url, init);
      };
    }
    return createOpenAI(opts);
  }

  async runAgent<T = undefined>(
    opts: AgentRunOptions<T>,
  ): Promise<LLMCallTrace<T>> {
    const reasoning = buildOpenRouterReasoningOptions(opts.reasoningLevel);
    const client = await this.createClient(reasoning);
    return executeRunAgent({
      model: client.chat(opts.model),
      modelId: opts.model,
      providerType: this.providerType,
      role: opts.role,
      workerId: opts.workerId,
      workerName: opts.workerName,
      sessionId: opts.sessionId,
      cycleId: opts.cycleId,
      tradeId: opts.tradeId,
      messages: opts.messages,
      tools: opts.tools,
      maxSteps: opts.maxSteps,
      spendLimitUsd: opts.spendLimitUsd,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
      reasoningLevel: opts.reasoningLevel,
      abortSignal: opts.abortSignal,
      schema: opts.schema,
      terminalToolNames: opts.terminalToolNames,
      prepareStep: opts.prepareStep,
    });
  }

  async generateText(opts: GenerateTextOptions): Promise<GenerateResult> {
    const { generateText } = await import("ai");
    const client = await this.createClient();
    const started = Date.now();
    const result = await generateText({
      model: client.chat(opts.model),
      system: opts.systemPrompt,
      prompt: opts.userPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
      tools: opts.tools,
      maxRetries: 0,
    });
    const usage = readUsage(result.usage);
    return {
      text: result.text,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      durationMs: Date.now() - started,
    };
  }

  async generateObject<T>(
    opts: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<T>> {
    const { generateObject } = await import("ai");
    const client = await this.createClient();
    const started = Date.now();
    const result = await generateObject({
      model: client.chat(opts.model),
      system: opts.systemPrompt,
      prompt: opts.userPrompt,
      schema: opts.schema,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
      tools: opts.tools,
      maxRetries: 0,
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

  async listModels(): Promise<ModelEntry[]> {
    const baseURL = this.baseUrl?.trim() || OpenRouterAdapter.DEFAULT_BASE_URL;
    const res = await fetch(`${baseURL}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new Error(`OpenRouter models fetch failed: ${res.status}`);
    const json = (await res.json()) as {
      data: { id: string; name: string; context_length: number }[];
    };
    return json.data.map((m) => ({
      id: m.id,
      label: m.name,
      maxContextTokens: m.context_length ?? 0,
    }));
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.generateText({
        model: "google/gemma-4-31b-it",
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
