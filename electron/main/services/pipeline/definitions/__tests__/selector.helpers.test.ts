import { describe, expect, it } from "vitest";
import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import type { LLMRunResult } from "../../../llm/llm-types";
import {
  applyVerificationResults,
  type SelectorCandidate,
} from "../selector.helpers";
import { candidateIdentityKey } from "../../../signals/scoring/selector-candidate-merger";
import type { verificationOutputSchema } from "../selector.schemas";
import type { z } from "zod";

type VerificationOutput = z.infer<typeof verificationOutputSchema>;

function candidate(
  overrides: Partial<SelectorCandidate> &
    Pick<SelectorCandidate, "symbol" | "instrumentClass">,
): SelectorCandidate {
  return {
    instrumentDisplayName: null,
    predictionOutcome: null,
    instrumentMetadataJson: null,
    hypeScore: null,
    volumeScore: null,
    liquidityScore: null,
    catalystScore: null,
    catalystSummary: null,
    rationale: null,
    riskFlags: [],
    finalScore: null,
    source: ["event-prediction-scout"],
    selectorEvidence: null,
    selectorTraces: [],
    ...overrides,
  };
}

describe("applyVerificationResults", () => {
  it("merges quote traces using worker identity even when the model omits predictionOutcome", () => {
    const yes = candidate({
      symbol: "pm:cond-1",
      instrumentClass: "prediction_market",
      predictionOutcome: "YES",
    });
    const identity = candidateIdentityKey(yes);
    const results = [
      {
        worker: {
          id: `liquidity-gate:${identity}`,
        } as WorkerDefinition,
        result: {
          output: {
            candidate: {
              symbol: "pm:cond-1",
              instrumentClass: "prediction_market",
              // Model forgot predictionOutcome — old keying would miss.
              predictionOutcome: null,
              volumeScore: 0.8,
              liquidityScore: 0.9,
              catalystScore: null,
              catalystSummary: null,
              rationale: "liquid",
            },
          },
          message: {
            tool_calls_json: JSON.stringify([
              {
                step: 1,
                toolCalls: [
                  {
                    step: 1,
                    tool: "get_quote",
                    argsJson: "{}",
                    resultJson: JSON.stringify({ mid: 0.42 }),
                  },
                ],
              },
            ]),
          },
        } as unknown as LLMRunResult<VerificationOutput>,
      },
    ];

    const verified = applyVerificationResults([yes], results);
    expect(verified).toHaveLength(1);
    expect(verified[0]?.predictionOutcome).toBe("YES");
    expect(verified[0]?.liquidityScore).toBe(0.9);
    expect(verified[0]?.source).toContain("liquidity-gate");
    expect(verified[0]?.selectorTraces).toHaveLength(1);
  });
});
