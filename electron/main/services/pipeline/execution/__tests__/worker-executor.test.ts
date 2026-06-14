import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractWorkerSubmission } from "../worker-executor";

describe("worker-executor", () => {
  describe("extractWorkerSubmission", () => {
    it("returns the last terminal tool submission across steps", () => {
      const trace = {
        steps: [
          {
            toolCalls: [
              {
                tool: "submit_result",
                argsJson: JSON.stringify({ score: 0.2 }),
              },
            ],
          },
          {
            toolCalls: [
              {
                tool: "submit_result",
                argsJson: JSON.stringify({ score: 0.9, label: "final" }),
              },
            ],
          },
        ],
      };

      expect(extractWorkerSubmission(trace, "submit_result")).toEqual({
        score: 0.9,
        label: "final",
      });
    });

    it("returns undefined when the terminal tool was never called", () => {
      const trace = {
        steps: [{ toolCalls: [{ tool: "get_quote", argsJson: "{}" }] }],
      };

      expect(extractWorkerSubmission(trace, "submit_result")).toBeUndefined();
    });

    it("falls back to raw args when JSON parsing fails", () => {
      const trace = {
        steps: [
          {
            toolCalls: [{ tool: "submit_result", argsJson: "not-json" }],
          },
        ],
      };

      expect(extractWorkerSubmission(trace, "submit_result")).toBe("not-json");
    });
  });

  it("documents the output schema contract used by scripted workers", () => {
    const schema = z.object({
      score: z.number(),
      label: z.string().default(""),
    });
    expect(schema.safeParse({ score: 0.5 }).success).toBe(true);
    expect(schema.safeParse({ score: "bad" }).success).toBe(false);
  });
});
