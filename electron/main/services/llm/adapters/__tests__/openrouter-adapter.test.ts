import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateTextMock = vi.fn();
const generateObjectMock = vi.fn();
const executeRunAgentMock = vi.fn();
const createOpenAIMock = vi.fn();

vi.mock("ai", () => ({
  generateText: generateTextMock,
  generateObject: generateObjectMock,
}));

vi.mock("../run-agent-execute", () => ({
  executeRunAgent: executeRunAgentMock,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: createOpenAIMock,
}));

describe("OpenRouterAdapter", () => {
  const fetchMock = vi.fn();
  const chatMock = vi.fn((modelId: string) => ({
    provider: "openrouter",
    modelId,
  }));

  beforeEach(() => {
    generateTextMock.mockReset();
    generateObjectMock.mockReset();
    executeRunAgentMock.mockReset();
    fetchMock.mockReset();
    chatMock.mockClear();
    createOpenAIMock.mockReset();
    createOpenAIMock.mockReturnValue({ chat: chatMock });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes generateText responses", async () => {
    generateTextMock.mockResolvedValue({
      text: "router-ok",
      usage: { inputTokens: 9, outputTokens: 3 },
    });
    const { OpenRouterAdapter } = await import("../openrouter-adapter");
    const adapter = new OpenRouterAdapter("sk-or-test");

    const result = await adapter.generateText({
      model: "google/gemma-4-31b-it",
      systemPrompt: "system",
      userPrompt: "ping",
      maxTokens: 16,
    });

    expect(result).toMatchObject({
      text: "router-ok",
      inputTokens: 9,
      outputTokens: 3,
      durationMs: expect.any(Number),
    });
    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-or-test",
        baseURL: "https://openrouter.ai/api/v1",
        fetch: expect.any(Function),
      }),
    );
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "openrouter", modelId: "google/gemma-4-31b-it" },
        maxRetries: 0,
      }),
    );
  });

  it("normalizes generateObject responses", async () => {
    generateObjectMock.mockResolvedValue({
      object: { ready: true },
      usage: { promptTokens: 7, completionTokens: 2 },
    });
    const { OpenRouterAdapter } = await import("../openrouter-adapter");
    const adapter = new OpenRouterAdapter("sk-or-test");
    const schema = z.object({ ready: z.boolean() });

    const result = await adapter.generateObject({
      model: "google/gemma-4-31b-it",
      systemPrompt: "system",
      userPrompt: "ping",
      schema,
    });

    expect(result).toMatchObject({
      object: { ready: true },
      text: JSON.stringify({ ready: true }),
      inputTokens: 7,
      outputTokens: 2,
    });
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0 }),
    );
  });

  it("uses a custom base URL for listModels", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "google/gemma-4-31b-it",
              name: "Gemma",
              context_length: 32000,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const { OpenRouterAdapter } = await import("../openrouter-adapter");
    const adapter = new OpenRouterAdapter(
      "sk-or-test",
      "https://openrouter.example/api/v1",
    );

    await expect(adapter.listModels()).resolves.toEqual([
      {
        id: "google/gemma-4-31b-it",
        label: "Gemma",
        maxContextTokens: 32000,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.example/api/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-or-test" },
      }),
    );
  });

  it("injects reasoning into OpenRouter fetch bodies when configured", async () => {
    const customFetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    createOpenAIMock.mockImplementation((opts: { fetch?: typeof fetch }) => {
      if (opts.fetch) {
        void opts.fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          body: JSON.stringify({ model: "google/gemma-4-31b-it" }),
        });
      }
      return { chat: chatMock };
    });
    executeRunAgentMock.mockResolvedValue({ text: "done", steps: [] });
    const { OpenRouterAdapter } = await import("../openrouter-adapter");
    const adapter = new OpenRouterAdapter("sk-or-test");

    await adapter.runAgent({
      model: "google/gemma-4-31b-it",
      messages: [{ role: "user", content: "hi" }],
      maxSteps: 2,
      spendLimitUsd: 1,
      reasoningLevel: "medium",
    });

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fetch: expect.any(Function),
      }),
    );
    expect(customFetch).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        body: JSON.stringify({
          model: "google/gemma-4-31b-it",
          usage: { include: true },
          reasoning: { effort: "medium" },
        }),
      }),
    );
  });

  it("requests usage.include on every OpenRouter call and folds the real cost into the trace", async () => {
    createOpenAIMock.mockImplementation((opts: { fetch?: typeof fetch }) => {
      if (opts.fetch) {
        void opts.fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          body: JSON.stringify({ model: "google/gemma-4-31b-it" }),
        });
      }
      return { chat: chatMock };
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "gen-1",
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.00042 },
        }),
        { status: 200 },
      ),
    );
    executeRunAgentMock.mockResolvedValue({
      text: "done",
      steps: [],
      costUsd: 0.01,
      costSource: "estimated",
    });
    const { OpenRouterAdapter } = await import("../openrouter-adapter");
    const adapter = new OpenRouterAdapter("sk-or-test");

    const trace = await adapter.runAgent({
      model: "google/gemma-4-31b-it",
      messages: [{ role: "user", content: "hi" }],
      maxSteps: 1,
      spendLimitUsd: 1,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        body: JSON.stringify({
          model: "google/gemma-4-31b-it",
          usage: { include: true },
        }),
      }),
    );
    expect(trace).toMatchObject({ costUsd: 0.00042, costSource: "provider" });
  });

  it("rewrites misleading OpenAI auth errors in testConnection", async () => {
    generateTextMock.mockRejectedValue(
      new Error(
        "Incorrect API key provided. You can find your API key at https://platform.openai.com/account/api-keys.",
      ),
    );
    const { OpenRouterAdapter } = await import("../openrouter-adapter");
    const adapter = new OpenRouterAdapter("sk-or-test");

    await expect(adapter.testConnection()).resolves.toEqual({
      ok: false,
      error:
        "OpenRouter authentication failed. Check that your key starts with `sk-or-` and that the base URL is `https://openrouter.ai/api/v1` (or left empty).",
    });
  });
});
