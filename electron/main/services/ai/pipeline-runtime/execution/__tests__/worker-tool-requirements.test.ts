import { describe, expect, it } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import type { WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import type { RunTrace } from "../../../ai-runtime/ai-runtime-types";
import { enforceWorkerToolRequirements, extractToolNamesUsed } from "../worker-tool-requirements";

function traceWithTools(tools: string[]): RunTrace {
  return {
    assistantText: "{}",
    messages: [],
    auditMessagesJson: "[]",
    steps: [
      {
        step: 0,
        toolCalls: tools.map((tool) => ({
          step: 0,
          tool,
          argsJson: "{}",
          resultJson: "{}",
          latencyMs: 1,
        })),
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      },
    ],
    finishReason: "stop",
    parseFallback: false,
    inputTokens: 1,
    outputTokens: 1,
    durationMs: 1,
  };
}

const marketValidator: WorkerDefinition = {
  id: "market-validator:NVDA",
  promptAssetPath: "selector-workers/market-validator",
  tools: ["get_quote", "get_ohlcv"],
  toolRequirements: { requiredAll: ["get_quote", "get_ohlcv"], minToolCalls: 2 },
  outputMode: "object",
};

describe("worker-tool-requirements", () => {
  it("extracts unique tool names from a run trace", () => {
    expect([...extractToolNamesUsed(traceWithTools(["get_quote", "get_ohlcv", "get_quote"]))]).toEqual([
      "get_quote",
      "get_ohlcv",
    ]);
  });

  it("rejects market-validator output with no tool calls", () => {
    expect(() => enforceWorkerToolRequirements(marketValidator, "selector", traceWithTools([]))).toThrow(AppError);
    try {
      enforceWorkerToolRequirements(marketValidator, "selector", traceWithTools([]));
    } catch (error) {
      expect((error as AppError).code).toBe("VALIDATION_FAILED");
      expect((error as AppError).message).toMatch(/get_quote/);
    }
  });

  it("rejects market-validator output missing get_ohlcv", () => {
    expect(() =>
      enforceWorkerToolRequirements(marketValidator, "selector", traceWithTools(["get_quote"])),
    ).toThrow(/get_ohlcv/);
  });

  it("accepts market-validator output with required tools", () => {
    expect(() =>
      enforceWorkerToolRequirements(marketValidator, "selector", traceWithTools(["get_quote", "get_ohlcv"])),
    ).not.toThrow();
  });

  it("accepts catalyst-extractor when any evidence tool was called", () => {
    const worker: WorkerDefinition = {
      id: "catalyst-extractor:PLTR",
      promptAssetPath: "selector-workers/catalyst-extractor",
      tools: ["get_news", "search_web", "fetch_url"],
      toolRequirements: { requiredAny: ["get_news", "search_web", "fetch_url"], minToolCalls: 1 },
      outputMode: "object",
    };
    expect(() => enforceWorkerToolRequirements(worker, "selector", traceWithTools(["search_web"]))).not.toThrow();
  });
});
