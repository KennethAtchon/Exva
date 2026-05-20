import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveStructuredWorkerOutput } from "../worker-structured-output";

const schema = z.object({
  score: z.number().min(0).max(1).default(0),
  label: z.string().default(""),
});

describe("resolveStructuredWorkerOutput", () => {
  const contract = {
    schema,
    strict: true as const,
    onValidationFailure: "retry_once" as const,
  };

  it("returns parsed output when validation succeeds", () => {
    const result = resolveStructuredWorkerOutput(
      contract,
      { score: 0.8, label: "ok" },
      false,
    );
    expect(result).toEqual({
      output: { score: 0.8, label: "ok" },
      parseFallback: false,
      retried: false,
    });
  });

  it("requests one retry when validation fails", () => {
    const result = resolveStructuredWorkerOutput(
      contract,
      { score: 2, label: "bad" },
      false,
    );
    expect(result).toEqual({ needsRetry: true, retried: true });
  });

  it("substitutes zero dimension after retry exhaustion", () => {
    const result = resolveStructuredWorkerOutput(
      contract,
      { score: 2, label: "bad" },
      true,
    );
    expect(result).toEqual({
      output: { score: 0, label: "" },
      parseFallback: true,
      retried: true,
    });
  });
});
