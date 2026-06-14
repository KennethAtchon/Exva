import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateTextMock = vi.fn();
const generateObjectMock = vi.fn();
const executeRunAgentMock = vi.fn();

vi.mock("ai", () => ({
  generateText: generateTextMock,
  generateObject: generateObjectMock,
}));

vi.mock("../run-agent-execute", () => ({
  executeRunAgent: executeRunAgentMock,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    provider: "openai",
    modelId,
  })),
}));

describe("OpenAiAdapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    generateTextMock.mockReset();
    generateObjectMock.mockReset();
    executeRunAgentMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes generateText responses", async () => {
    generateTextMock.mockResolvedValue({
      text: "pong",
      usage: { promptTokens: 5, completionTokens: 2 },
    });
    const { OpenAiAdapter } = await import("../openai-adapter");
    const adapter = new OpenAiAdapter("sk-openai-test");

    const result = await adapter.generateText({
      model: "gpt-4o-mini",
      systemPrompt: "system",
      userPrompt: "ping",
      maxTokens: 8,
    });

    expect(result).toMatchObject({
      text: "pong",
      inputTokens: 5,
      outputTokens: 2,
      durationMs: expect.any(Number),
    });
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "openai", modelId: "gpt-4o-mini" },
        system: "system",
        prompt: "ping",
        maxOutputTokens: 8,
      }),
    );
  });

  it("normalizes generateObject responses", async () => {
    generateObjectMock.mockResolvedValue({
      object: { score: 0.8 },
      usage: { inputTokens: 10, outputTokens: 6 },
    });
    const { OpenAiAdapter } = await import("../openai-adapter");
    const adapter = new OpenAiAdapter("sk-openai-test");
    const schema = z.object({ score: z.number() });

    const result = await adapter.generateObject({
      model: "gpt-4o-mini",
      systemPrompt: "system",
      userPrompt: "score",
      schema,
    });

    expect(result).toMatchObject({
      object: { score: 0.8 },
      text: JSON.stringify({ score: 0.8 }),
      inputTokens: 10,
      outputTokens: 6,
    });
  });

  it("delegates runAgent with OpenAI reasoning options", async () => {
    executeRunAgentMock.mockResolvedValue({ text: "done", steps: [] });
    const { OpenAiAdapter } = await import("../openai-adapter");
    const adapter = new OpenAiAdapter("sk-openai-test");

    await adapter.runAgent({
      model: "o3-mini",
      messages: [{ role: "user", content: "analyze" }],
      maxSteps: 2,
      spendLimitUsd: 0.5,
      reasoningLevel: "high",
    });

    expect(executeRunAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: "openai",
        providerOptions: { openai: { reasoningEffort: "high" } },
      }),
    );
  });

  it("filters and maps listModels from the OpenAI models API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "gpt-4o-mini" },
            { id: "gpt-3.5-turbo-instruct" },
            { id: "whisper-1" },
            { id: "o3-mini" },
          ],
        }),
        { status: 200 },
      ),
    );
    const { OpenAiAdapter } = await import("../openai-adapter");
    const adapter = new OpenAiAdapter("sk-openai-test");

    await expect(adapter.listModels()).resolves.toEqual([
      { id: "gpt-4o-mini", label: "gpt-4o-mini", maxContextTokens: 0 },
      { id: "o3-mini", label: "o3-mini", maxContextTokens: 0 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-openai-test" },
      }),
    );
  });

  it("reports testConnection success after a minimal generateText call", async () => {
    generateTextMock.mockResolvedValue({
      text: "ok",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { OpenAiAdapter } = await import("../openai-adapter");
    const adapter = new OpenAiAdapter("sk-openai-test");

    await expect(adapter.testConnection()).resolves.toEqual({ ok: true });
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "openai", modelId: "gpt-4o-mini" },
      }),
    );
  });
});
