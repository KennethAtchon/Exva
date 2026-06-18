import { describe, expect, it } from "vitest";
import type { SelectorEvidence } from "@electron/shared/ai/selector-candidate";
import { CandidateValidationService } from "../candidate-validation-service";
import type { CandidateValidationInput } from "../candidate-validation-service";

function selectorEvidence(
  overrides: Partial<SelectorEvidence> = {},
): SelectorEvidence {
  return {
    summary: "Apple remains a leader after earnings.",
    thesisDirection: "long",
    sourceWorkers: ["web-scout"],
    riskFlags: [],
    hasQuoteEvidence: true,
    hasNewsEvidence: false,
    hasSearchEvidence: true,
    hasOhlcvEvidence: false,
    hasFetchEvidence: false,
    ...overrides,
  };
}

function validInput(
  overrides: Partial<CandidateValidationInput> = {},
): CandidateValidationInput {
  const now = "2024-06-01T12:00:00.000Z";
  return {
    sessionId: "session-1",
    cycleId: "cycle-1",
    instrument: {
      symbol: "AAPL",
      instrumentClass: "stock",
      selectorEvidence: selectorEvidence(),
    },
    sessionInstrumentClasses: ["stock"],
    brokerRouteAvailable: true,
    sideBias: "long_only",
    holdingStyle: "multi_day_swing",
    selectionSource: "ai_picker",
    selectorTrace: [
      {
        step: 1,
        toolCalls: [
          {
            step: 1,
            tool: "search_web",
            argsJson: "{}",
            resultJson: "AAPL beat estimates on iPhone demand.",
          },
        ],
      },
    ],
    quoteSnapshot: {
      instrumentSymbol: "AAPL",
      price: 190,
      bid: 189.9,
      ask: 190.1,
      spreadPct: 0.11,
      volume: 250_000,
      timestamp: "2024-06-01T11:59:30.000Z",
    },
    now,
    ...overrides,
  };
}

describe("CandidateValidationService", () => {
  const service = new CandidateValidationService();

  it("accepts a fully valid candidate", () => {
    const result = service.validate(validInput());
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.evidence).toEqual([
      { source: "search_web", symbolMatched: true },
    ]);
  });

  it("rejects missing symbols (CV-1)", () => {
    const result = service.validate(
      validInput({
        instrument: {
          symbol: "  ",
          instrumentClass: "stock",
        },
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("Missing instrument symbol");
  });

  it("rejects disabled instrument classes (CV-2)", () => {
    const result = service.validate(
      validInput({
        instrument: { symbol: "BTC-USD", instrumentClass: "crypto" },
        sessionInstrumentClasses: ["stock"],
      }),
    );
    expect(
      result.reasons.some((reason) => reason.includes("not enabled")),
    ).toBe(true);
  });

  it("rejects missing broker routes and stale quotes (CV-3/CV-5)", () => {
    const noBroker = service.validate(
      validInput({ brokerRouteAvailable: false }),
    );
    expect(noBroker.reasons).toContain(
      "No broker account supports this instrument class",
    );

    const stale = service.validate(
      validInput({
        quoteSnapshot: {
          instrumentSymbol: "AAPL",
          price: 190,
          timestamp: "2024-06-01T11:50:00.000Z",
        },
      }),
    );
    expect(
      stale.reasons.some((reason) => reason.includes("Quote is stale")),
    ).toBe(true);
  });

  it("requires symbol-specific evidence outside manual shortlist (CV-6/CV-7)", () => {
    const noEvidence = service.validate(
      validInput({
        selectorTrace: [],
        instrument: {
          symbol: "AAPL",
          instrumentClass: "stock",
          selectorEvidence: selectorEvidence({
            summary: "   ",
            hasSearchEvidence: false,
            hasQuoteEvidence: false,
            hasOhlcvEvidence: false,
            hasFetchEvidence: false,
          }),
        },
      }),
    );
    expect(noEvidence.allowed).toBe(false);
    expect(noEvidence.reasons.length).toBeGreaterThan(0);
  });

  it("skips evidence requirement for entry-engine-supplied instruments (CV-6)", () => {
    const supplied = service.validate(
      validInput({
        // Not ai_picker: a signal-seeded / manual-shortlist instrument.
        selectionSource: "phase",
        selectorTrace: [],
        instrument: {
          symbol: "AAPL",
          instrumentClass: "stock",
          selectorEvidence: selectorEvidence({
            summary: "supplied directly by signal",
            hasSearchEvidence: false,
            hasQuoteEvidence: false,
            hasOhlcvEvidence: false,
            hasFetchEvidence: false,
          }),
        },
      }),
    );
    expect(
      supplied.reasons.some((reason) =>
        reason.includes("No symbol-specific evidence"),
      ),
    ).toBe(false);
  });

  it("rejects low volume and wide spreads (CV-8/CV-9)", () => {
    const lowVolume = service.validate(
      validInput({
        quoteSnapshot: {
          instrumentSymbol: "AAPL",
          price: 190,
          volume: 100,
          spreadPct: 0.1,
          timestamp: "2024-06-01T11:59:30.000Z",
        },
      }),
    );
    expect(
      lowVolume.reasons.some((reason) => reason.includes("Volume below")),
    ).toBe(true);

    const wideSpread = service.validate(
      validInput({
        quoteSnapshot: {
          instrumentSymbol: "AAPL",
          price: 190,
          volume: 250_000,
          spreadPct: 2.5,
          timestamp: "2024-06-01T11:59:30.000Z",
        },
      }),
    );
    expect(
      wideSpread.reasons.some((reason) => reason.includes("Spread too wide")),
    ).toBe(true);
  });

  it("rejects side bias mismatches (CV-10)", () => {
    const result = service.validate(
      validInput({
        sideBias: "short_only",
        instrument: {
          symbol: "AAPL",
          instrumentClass: "stock",
          selectorEvidence: selectorEvidence({ thesisDirection: "long" }),
        },
      }),
    );
    expect(result.reasons.some((reason) => reason.includes("Side bias"))).toBe(
      true,
    );
  });
});
