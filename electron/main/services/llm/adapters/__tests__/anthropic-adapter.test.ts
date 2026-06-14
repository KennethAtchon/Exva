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

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => (modelId: string) => ({
    provider: "anthropic",
    modelId,
  })),
}));

describe("AnthropicAdapter", () => {
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
      text: "hello",
      usage: { inputTokens: 12, outputTokens: 4 },
    });
    const { AnthropicAdapter } = await import("../anthropic-adapter");
    const adapter = new AnthropicAdapter("sk-ant-test");

    const result = await adapter.generateText({
      model: "claude-sonnet-4",
      systemPrompt: "system",
      userPrompt: "user",
      temperature: 0.2,
      maxTokens: 64,
    });

    expect(result).toMatchObject({
      text: "hello",
      inputTokens: 12,
      outputTokens: 4,
      durationMs: expect.any(Number),
    });
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "anthropic", modelId: "claude-sonnet-4" },
        system: "system",
        prompt: "user",
        temperature: 0.2,
        maxOutputTokens: 64,
      }),
    );
  });

  it("normalizes generateObject responses", async () => {
    generateObjectMock.mockResolvedValue({
      object: { ok: true },
      usage: { promptTokens: 8, completionTokens: 3 },
    });
    const { AnthropicAdapter } = await import("../anthropic-adapter");
    const adapter = new AnthropicAdapter("sk-ant-test");
    const schema = z.object({ ok: z.boolean() });

    const result = await adapter.generateObject({
      model: "claude-sonnet-4",
      systemPrompt: "system",
      userPrompt: "user",
      schema,
    });

    expect(result).toMatchObject({
      object: { ok: true },
      text: JSON.stringify({ ok: true }),
      inputTokens: 8,
      outputTokens: 3,
      durationMs: expect.any(Number),
    });
  });

  it("delegates runAgent to executeRunAgent with anthropic provider options", async () => {
    executeRunAgentMock.mockResolvedValue({ text: "done", steps: [] });
    const { AnthropicAdapter } = await import("../anthropic-adapter");
    const adapter = new AnthropicAdapter("sk-ant-test");

    await adapter.runAgent({
      model: "claude-sonnet-4",
      role: "selector",
      messages: [{ role: "user", content: "hi" }],
      maxSteps: 3,
      spendLimitUsd: 1,
      reasoningLevel: "low",
      tools: { search_web: {} } as never,
    });

    expect(executeRunAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "anthropic", modelId: "claude-sonnet-4" },
        providerType: "anthropic",
        role: "selector",
        providerOptions: {
          anthropic: { thinking: { type: "adaptive" } },
        },
      }),
    );
  });

  it("maps listModels from the Anthropic models API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-sonnet-4", display_name: "Claude Sonnet 4" }],
        }),
        { status: 200 },
      ),
    );
    const { AnthropicAdapter } = await import("../anthropic-adapter");
    const adapter = new AnthropicAdapter("sk-ant-test");

    await expect(adapter.listModels()).resolves.toEqual([
      {
        id: "claude-sonnet-4",
        label: "Claude Sonnet 4",
        maxContextTokens: 200000,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models?limit=100",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "sk-ant-test",
        }),
      }),
    );
  });

  it("reports testConnection success after a minimal generateText call", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-sonnet-4", display_name: "Claude Sonnet 4" }],
        }),
        { status: 200 },
      ),
    );
    generateTextMock.mockResolvedValue({
      text: "ok",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { AnthropicAdapter } = await import("../anthropic-adapter");
    const adapter = new AnthropicAdapter("sk-ant-test");

    await expect(adapter.testConnection()).resolves.toEqual({ ok: true });
  });
});
