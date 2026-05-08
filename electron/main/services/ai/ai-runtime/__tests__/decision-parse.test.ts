import { describe, expect, it } from "vitest";
import { tryParseDecisionFromText } from "../decision-parse";

const validDecision = {
  action: "no_trade",
  instrumentSymbol: "AAPL",
  confidence: 0.42,
  reasoning: "No clean setup.",
};

describe("tryParseDecisionFromText", () => {
  it("parses a raw JSON trade decision", () => {
    expect(tryParseDecisionFromText(JSON.stringify(validDecision))).toMatchObject(validDecision);
  });

  it("parses JSON embedded in prose", () => {
    expect(tryParseDecisionFromText(`Here is the decision:\n${JSON.stringify(validDecision)}\nDone.`)).toMatchObject(
      validDecision,
    );
  });

  it("parses JSON embedded in a fenced block", () => {
    expect(tryParseDecisionFromText(`\`\`\`json\n${JSON.stringify(validDecision)}\n\`\`\``)).toMatchObject(
      validDecision,
    );
  });

  it("returns null for garbage text", () => {
    expect(tryParseDecisionFromText("not json at all")).toBeNull();
  });

  it("returns null when schema validation fails", () => {
    expect(tryParseDecisionFromText(JSON.stringify({ confidence: 0.4, reasoning: "Missing action." }))).toBeNull();
  });
});
