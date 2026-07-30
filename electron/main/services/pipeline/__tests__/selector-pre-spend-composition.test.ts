import { describe, expect, it } from "vitest";
import { screenSelectorCandidatesBeforeVerification } from "../definitions/selector-pre-spend-screen";
import { SELECTOR_PHASE } from "../definitions/selector.phase";
import type { SelectorCandidate } from "../definitions/selector.helpers";

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
    rationale: "momentum breakout",
    riskFlags: [],
    finalScore: 0.9,
    source: ["web-scout"],
    selectorEvidence: null,
    selectorTraces: [
      {
        step: 1,
        toolCalls: [
          {
            step: 1,
            tool: "get_quote",
            argsJson: "{}",
            resultJson: JSON.stringify({
              price: 10,
              timestamp: new Date().toISOString(),
              volume: 100,
              instrumentSymbol: overrides.symbol,
            }),
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("selector pre-spend composition", () => {
  it("liquidity-floor reject yields zero verification workers", async () => {
    const illiquid = candidate({ symbol: "DEAD", instrumentClass: "stock" });
    const screened = screenSelectorCandidatesBeforeVerification({
      sessionId: "s1",
      instrumentClasses: ["stock"],
      strategyContext: {
        rules: { sideBias: "long_only" },
        timeframe: { holdingStyle: "multi_day_swing" },
        riskConfig: { maxConcurrentTrades: 3 },
      } as never,
      candidates: [illiquid],
    });
    expect(screened.passed).toHaveLength(0);
    expect(
      screened.rejected[0]?.reasons.some((reason) =>
        reason.toLowerCase().includes("volume"),
      ),
    ).toBe(true);

    const ctx = {
      instrumentClasses: ["stock"],
      strategyContext: {
        rules: { sideBias: "long_only" },
        timeframe: { holdingStyle: "multi_day_swing" },
      },
      toolContext: {},
      input: { failureHistory: [] },
    } as never;

    let state = {
      selectionInstructions: "find setups",
      discoveryWorkerIds: [],
      candidatesForVerification: [illiquid],
      verifiedCandidates: [],
      preSpendRejectedCount: 0,
    };
    state = await SELECTOR_PHASE.stages.find(
      (stage) => stage.id === "deterministic-screen",
    )!.runDeterministic!(ctx, state);

    const verificationStage = SELECTOR_PHASE.stages.find(
      (stage) => stage.id === "verification",
    )!;
    expect(verificationStage.resolveWorkers(ctx, state)).toHaveLength(0);
  });
});
