import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseWorkerOutput } from "../worker-structured-output";
import { candidateOutputSchema } from "../../definitions/selector.schemas";
import { recoverBareCandidateArray } from "../worker-executor";

const schema = z.object({
  score: z.number().min(0).max(1).default(0),
  label: z.string().default(""),
});

describe("parseWorkerOutput", () => {
  const contract = {
    schema,
    strict: true as const,
    onValidationFailure: "retry_once" as const,
  };

  it("returns parsed output when validation succeeds", () => {
    const result = parseWorkerOutput(
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
    const result = parseWorkerOutput(
      contract,
      { score: 2, label: "bad" },
      false,
    );
    expect(result).toEqual({ needsRetry: true, retried: true });
  });

  it("substitutes zero dimension after retry exhaustion", () => {
    const result = parseWorkerOutput(
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

  it("recovers a valid bare discovery candidate array before retrying", () => {
    const result = parseWorkerOutput(
      {
        schema: candidateOutputSchema,
        strict: true as const,
        onValidationFailure: "retry_once" as const,
      },
      [
        {
          symbol: "pm:condition-1",
          instrumentClass: "prediction_market",
          source: ["event-prediction-scout"],
        },
      ],
      false,
      recoverBareCandidateArray,
    );

    expect(result).toMatchObject({
      output: { candidates: [{ symbol: "pm:condition-1" }] },
      parseFallback: false,
      retried: false,
    });
  });

  it("does not recover invalid bare candidate arrays", () => {
    const result = parseWorkerOutput(
      {
        schema: candidateOutputSchema,
        strict: true as const,
        onValidationFailure: "retry_once" as const,
      },
      [{ symbol: "pm:condition-1" }],
      false,
      recoverBareCandidateArray,
    );

    expect(result).toEqual({ needsRetry: true, retried: true });
  });
});
