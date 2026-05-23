import { describe, expect, it } from "vitest";
import { extractWorkerSubmission } from "../worker-executor";

function trace(calls: Array<{ tool?: string; argsJson?: string }>): {
  steps: Array<{ toolCalls: typeof calls }>;
} {
  return { steps: [{ toolCalls: calls }] };
}

describe("extractWorkerSubmission", () => {
  it("returns the parsed args of the terminal tool call", () => {
    const result = extractWorkerSubmission(
      trace([
        { tool: "search_web", argsJson: '{"query":"x"}' },
        { tool: "submit_result", argsJson: '{"score":0.5}' },
      ]),
      "submit_result",
    );
    expect(result).toEqual({ score: 0.5 });
  });

  it("returns undefined when the terminal tool was never called", () => {
    const result = extractWorkerSubmission(
      trace([{ tool: "search_web", argsJson: '{"query":"x"}' }]),
      "submit_result",
    );
    expect(result).toBeUndefined();
  });

  it("returns the last submission when called more than once", () => {
    const result = extractWorkerSubmission(
      trace([
        { tool: "submit_result", argsJson: '{"score":0.1}' },
        { tool: "submit_result", argsJson: '{"score":0.9}' },
      ]),
      "submit_result",
    );
    expect(result).toEqual({ score: 0.9 });
  });

  it("falls back to the raw string when args are not valid JSON", () => {
    const result = extractWorkerSubmission(
      trace([{ tool: "submit_result", argsJson: "not json" }]),
      "submit_result",
    );
    expect(result).toBe("not json");
  });
});
