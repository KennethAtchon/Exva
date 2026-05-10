import { AppError } from "@electron/shared/errors";
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

export class AnthropicAdapter implements ProviderAdapter {
  readonly providerType = "anthropic" as const;

  constructor(private readonly apiKey: string) {}

  async generateText(opts: GenerateTextOptions): Promise<GenerateResult> {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const { generateText } = await import("ai");
    const client = createAnthropic({ apiKey: this.apiKey });
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

  async runAgent<T = undefined>(opts: AgentRunOptions<T>): Promise<RunTrace<T>> {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const client = createAnthropic({ apiKey: this.apiKey });
    return executeRunAgent({
      model: client(opts.model),
      modelId: opts.model,
      role: opts.role,
      messages: opts.messages,
      tools: opts.tools,
      maxSteps: opts.maxSteps,
      spendLimitUsd: opts.spendLimitUsd,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
      abortSignal: opts.abortSignal,
      schema: opts.schema,
      terminalToolNames: opts.terminalToolNames,
      prepareStep: opts.prepareStep,
    });
  }

  async generateObject<T>(opts: GenerateObjectOptions<T>): Promise<GenerateObjectResult<T>> {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const { generateObject } = await import("ai");
    const client = createAnthropic({ apiKey: this.apiKey });
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
        model: "claude-haiku-4-5-20251001",
        systemPrompt: "Reply with the single word: ok",
        userPrompt: "ping",
        temperature: 0,
        maxTokens: 4,
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof AppError) return { ok: false, error: error.message };
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async listModels(): Promise<ModelEntry[]> {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) throw new Error(`Anthropic models fetch failed: ${res.status}`);
    const json = await res.json() as { data: { id: string; display_name: string }[] };
    return json.data.map((m) => ({
      id: m.id,
      label: m.display_name,
      maxContextTokens: 200000,
    }));
  }
}
