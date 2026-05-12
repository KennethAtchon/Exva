import { describe, expect, it } from "vitest";
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
});
