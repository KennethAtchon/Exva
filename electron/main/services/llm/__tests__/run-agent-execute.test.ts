import { beforeEach, describe, expect, it, vi } from "vitest";

const infoSpy = vi.fn();
const debugSpy = vi.fn();
const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateText: generateTextMock,
  hasToolCall: vi.fn(() => vi.fn(() => false)),
  Output: {
    object: ({ schema }: { schema: unknown }) => ({ schema }),
  },
  stepCountIs: vi.fn(() => vi.fn(() => false)),
}));

vi.mock("../../infra/log", () => ({
  createLogger: () => ({
    info: infoSpy,
    debug: debugSpy,
  }),
}));

type MockStep = {
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: { symbol: string; instrumentClass: string };
  }>;
  toolResults: Array<{
    toolCallId: string;
    output: unknown;
  }>;
  usage: { inputTokens: number; outputTokens: number };
  text: string;
};

describe("executeRunAgent logging", () => {
  beforeEach(() => {
    infoSpy.mockReset();
    debugSpy.mockReset();
    generateTextMock.mockReset();
  });

  it("logs safe AI metadata without prompt, tool, reasoning, or response content", async () => {
    const { executeRunAgent } = await import("../adapters/run-agent-execute");

    const longPrompt = "P".repeat(700);
    const longResponse = "R".repeat(900);
    const toolResult = {
      instrumentSymbol: "SOL",
      detail: "D".repeat(600),
      nested: { ok: true },
    };

    const step: MockStep = {
      toolCalls: [
        {
          toolCallId: "tc-1",
          toolName: "get_quote",
          input: { symbol: "SOL", instrumentClass: "crypto" },
        },
      ],
      toolResults: [
        {
          toolCallId: "tc-1",
          output: toolResult,
        },
      ],
      usage: { inputTokens: 11, outputTokens: 7 },
      text: "",
    };

    generateTextMock.mockImplementation(
      async (args: { onStepFinish?: (step: MockStep) => void }) => {
        args.onStepFinish?.(step);
        return {
          text: longResponse,
          steps: [step],
          totalUsage: { inputTokens: 11, outputTokens: 7 },
          providerMetadata: {
            openrouter: {
              usage: { cost: 0.00042, totalTokens: 18 },
            },
          },
          response: {
            messages: [{ role: "assistant", content: longResponse }],
          },
          finishReason: "stop",
          reasoningText: undefined,
        };
      },
    );

    await executeRunAgent({
      model: {} as never,
      modelId: "google/gemma-4-31b-it",
      role: "selector",
      messages: [
        { role: "system", content: "System instructions" },
        { role: "user", content: longPrompt },
      ],
      tools: { get_quote: {} } as never,
      maxSteps: 4,
    });

    const startEntry = infoSpy.mock.calls.find(
      ([, message]) => message === "execute run agent start",
    )?.[0];
    const toolEntry = infoSpy.mock.calls.find(
      ([, message]) => message === "agent tool call",
    )?.[0];
    const completeEntry = infoSpy.mock.calls.find(
      ([, message]) => message === "execute run agent complete",
    )?.[0];

    expect(startEntry).not.toHaveProperty("systemPrompt");
    expect(startEntry).not.toHaveProperty("userPrompt");
    expect(startEntry).toMatchObject({
      role: "selector",
      modelId: "google/gemma-4-31b-it",
    });
    expect(toolEntry).toMatchObject({
      role: "selector",
      modelId: "google/gemma-4-31b-it",
      step: 1,
      tool: "get_quote",
      hasToolResult: true,
    });
    expect(toolEntry.toolArgsBytes).toBeGreaterThan(0);
    expect(toolEntry.toolResultBytes).toBeGreaterThan(0);

    expect(completeEntry).toMatchObject({
      role: "selector",
      modelId: "google/gemma-4-31b-it",
      responseChars: 900,
      costSource: "provider",
      totalCostUsd: 0.00042,
    });
    const serializedLogs = JSON.stringify(infoSpy.mock.calls);
    expect(serializedLogs).not.toContain("System instructions");
    expect(serializedLogs).not.toContain(longPrompt);
    expect(serializedLogs).not.toContain("D".repeat(100));
    expect(serializedLogs).not.toContain(longResponse);
    expect(
      infoSpy.mock.calls.find(
        ([, message]) => message === "selector attempt summary",
      ),
    ).toBeUndefined();
  });

  it("ignores late step and completion activity after the request aborts", async () => {
    const { executeRunAgent } = await import("../adapters/run-agent-execute");

    const lateStep: MockStep = {
      toolCalls: [
        {
          toolCallId: "tc-late",
          toolName: "get_quote",
          input: { symbol: "NVDA", instrumentClass: "stock" },
        },
      ],
      toolResults: [
        {
          toolCallId: "tc-late",
          output: { headline: "late result" },
        },
      ],
      usage: { inputTokens: 5, outputTokens: 3 },
      text: "late step",
    };

    generateTextMock.mockImplementation(
      async (args: {
        abortSignal?: AbortSignal;
        onStepFinish?: (step: MockStep) => void;
      }) => {
        (args.abortSignal as AbortSignal | undefined)?.dispatchEvent?.(
          new Event("abort"),
        );
        args.onStepFinish?.(lateStep);
        return {
          text: "late response",
          steps: [lateStep],
          totalUsage: { inputTokens: 5, outputTokens: 3 },
          response: {
            messages: [{ role: "assistant", content: "late response" }],
          },
          finishReason: "stop",
          reasoningText: "late reasoning",
        };
      },
    );

    const controller = new AbortController();
    controller.abort();

    await expect(
      executeRunAgent({
        model: {} as never,
        modelId: "google/gemma-4-31b-it",
        role: "selector",
        messages: [
          { role: "system", content: "System instructions" },
          { role: "user", content: "Prompt" },
        ],
        tools: { get_quote: {} } as never,
        maxSteps: 4,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow("AI request aborted");

    expect(
      infoSpy.mock.calls.find(([, message]) => message === "agent tool call"),
    ).toBeUndefined();
    expect(
      infoSpy.mock.calls.find(([, message]) => message === "agent step text"),
    ).toBeUndefined();
    expect(
      infoSpy.mock.calls.find(([, message]) => message === "agent reasoning"),
    ).toBeUndefined();
    expect(
      infoSpy.mock.calls.find(
        ([, message]) => message === "execute run agent complete",
      ),
    ).toBeUndefined();
  });
});
