import { describe, expect, it } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import { instrumentSelectionSchema, instrumentSelectionToolInputSchema } from "@/lib/schemas";
import { parseInstrumentSelection } from "../instrument-selection-parser";

describe("instrument selection empty-state contract", () => {
  it("accepts an empty selector submission when no candidates fit", () => {
    const payload = { instruments: [] };

    expect(instrumentSelectionToolInputSchema.safeParse(payload).success).toBe(true);
    expect(instrumentSelectionSchema.safeParse(payload).success).toBe(true);
  });

  it("parses an empty submit_candidates result", () => {
    expect(
      parseInstrumentSelection({
        assistantText: "",
        auditMessagesJson: "[]",
        steps: [
          {
            step: 1,
            toolCalls: [
              {
                step: 1,
                tool: "submit_candidates",
                argsJson: JSON.stringify({ instruments: [] }),
                resultJson: JSON.stringify({ instruments: [] }),
                latencyMs: 1,
              },
            ],
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 1,
          },
        ],
        messages: [],
        finishReason: "stop",
        parseFallback: false,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 1,
      }),
    ).toEqual({ instruments: [] });
  });

  it("falls back to submit_candidates args when the provider trace has a null tool result", () => {
    expect(
      parseInstrumentSelection({
        assistantText: "",
        auditMessagesJson: "[]",
        steps: [
          {
            step: 1,
            toolCalls: [
              {
                step: 1,
                tool: "submit_candidates",
                argsJson: JSON.stringify({
                  instruments: [
                    {
                      symbol: "pltr",
                      instrumentClass: "stock",
                      instrumentDisplayName: "Palantir Technologies",
                      rationale: "Breakout setup with catalyst support.",
                    },
                  ],
                }),
                resultJson: "null",
                latencyMs: 1,
              },
            ],
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 1,
          },
        ],
        messages: [],
        finishReason: "stop",
        parseFallback: false,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 1,
      }),
    ).toEqual({
      instruments: [
        {
          symbol: "PLTR",
          instrumentClass: "stock",
          instrumentDisplayName: "Palantir Technologies",
          rationale: "Breakout setup with catalyst support.",
        },
      ],
    });
  });

  it("surfaces the exact invalid field when submit_candidates payload is malformed", () => {
    expect(() =>
      parseInstrumentSelection({
        assistantText: "",
        auditMessagesJson: "[]",
        steps: [
          {
            step: 1,
            toolCalls: [
              {
                step: 1,
                tool: "submit_candidates",
                argsJson: JSON.stringify({
                  instruments: [
                    {
                      symbol: "nvda",
                      instrumentClass: "stock",
                      instrumentDisplayName: "NVIDIA Corp",
                      predictionOutcome: "Bullish",
                      rationale: "Breakout above resistance with catalyst support.",
                    },
                  ],
                }),
                resultJson: "null",
                latencyMs: 1,
              },
            ],
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 1,
          },
        ],
        messages: [],
        finishReason: "stop",
        parseFallback: false,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 1,
      }),
    ).toThrowError(new AppError(
      "Instrument selector payload validation failed: submit_candidates args invalid: instruments.0.predictionOutcome: Invalid enum value. Expected 'YES' | 'NO', received 'Bullish'",
      "VALIDATION_FAILED",
    ));
  });
});
