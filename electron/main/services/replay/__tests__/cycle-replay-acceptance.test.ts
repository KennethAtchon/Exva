import { describe, expect, it } from "vitest";
import type { ReplayResult } from "../cycle-replay-service";
import {
  assertCostBelowUsd,
  assertSelectorSubmissionRate,
  assertSubmissionFires,
  assertTechnicalSignalHasField,
  assertTradeExecutionProfile,
  assertTradeSignalAction,
  assertZeroAiAuthoredSizing,
  expectedTradeExecutionProfile,
} from "./cycle-replay-acceptance";

function makeReplayResult(overrides: Partial<ReplayResult> = {}): ReplayResult {
  return {
    cycleId: "cycle-1",
    candidateValidation: [],
    policyGate: null,
    exitDecision: null,
    phaseOutputs: {
      selector: {
        instruments: [
          { symbol: "AAPL", instrumentClass: "stock", rationale: "x" },
        ],
      },
      technical: {
        symbol: "AAPL",
        trendDirection: "bullish",
        trendStrength: 0.8,
        momentumScore: 0.7,
        volumeScore: 0.6,
        volumeSignal: "accumulation",
        patternName: "breakout",
        patternStrength: 0.75,
        nearestSupport: 140,
        nearestResistance: 150,
        timeframeAlignment: 0.8,
        rawSummary: "bullish",
      },
      fundamental: null,
      review: null,
      decision: {
        symbol: "AAPL",
        action: "buy",
        executionStrategy: "breakout",
        entryPrice: 150,
        confidence: 0.8,
        reasoning: "edge",
      },
    },
    scorecard: {
      submissionFired: true,
      totalCostUsd: 0.12,
      aiAuthoredSizingFieldCount: 0,
    },
    executionProfile: {
      positionSizeUsd: 800,
      orderType: "limit",
      limitPrice: 150,
      stopLossPrice: 142.5,
      takeProfitPrice: 165,
    },
    matchesOriginal: {
      riskOutcomeMatches: true,
      tradeOpenedMatches: true,
    },
    ...overrides,
  };
}

describe("cycle-replay acceptance helpers", () => {
  it("assertSubmissionFires requires selector output and submission scorecard flag", () => {
    expect(() => assertSubmissionFires(makeReplayResult())).not.toThrow();
    expect(() =>
      assertSubmissionFires(
        makeReplayResult({
          scorecard: {
            submissionFired: false,
            totalCostUsd: 0.1,
            aiAuthoredSizingFieldCount: 0,
          },
        }),
      ),
    ).toThrow();
  });

  it("assertSelectorSubmissionRate enforces minimum submission rate", () => {
    const results = [
      makeReplayResult(),
      makeReplayResult({
        scorecard: {
          submissionFired: false,
          totalCostUsd: 0.1,
          aiAuthoredSizingFieldCount: 0,
        },
      }),
    ];

    expect(() => assertSelectorSubmissionRate(results, 1)).toThrow();
    expect(() => assertSelectorSubmissionRate(results, 0.5)).not.toThrow();
  });

  it("assertZeroAiAuthoredSizing rejects legacy sizing fields", () => {
    expect(() =>
      assertZeroAiAuthoredSizing([
        makeReplayResult(),
        makeReplayResult({
          scorecard: {
            submissionFired: true,
            totalCostUsd: 0.1,
            aiAuthoredSizingFieldCount: 1,
          },
        }),
      ]),
    ).toThrow();
  });

  it("assertTechnicalSignalHasField checks required technical output fields", () => {
    expect(() =>
      assertTechnicalSignalHasField(makeReplayResult(), "trendDirection"),
    ).not.toThrow();
    expect(() =>
      assertTechnicalSignalHasField(
        makeReplayResult({
          phaseOutputs: {
            ...makeReplayResult().phaseOutputs,
            technical: null,
          },
        }),
        "trendDirection",
      ),
    ).toThrow();
  });

  it("assertTradeSignalAction validates decision phase action", () => {
    expect(() =>
      assertTradeSignalAction(makeReplayResult(), "buy"),
    ).not.toThrow();
    expect(() => assertTradeSignalAction(makeReplayResult(), "skip")).toThrow();
  });

  it("assertCostBelowUsd enforces replay cost ceiling", () => {
    expect(() => assertCostBelowUsd(makeReplayResult(), 0.2)).not.toThrow();
    expect(() => assertCostBelowUsd(makeReplayResult(), 0.05)).toThrow();
  });

  it("assertTradeExecutionProfile compares deterministic execution outputs", () => {
    const expected = expectedTradeExecutionProfile({
      strategy: "breakout",
      instrumentClass: "stock",
      maxPositionUsd: 1000,
      maxExposureUsd: null,
      confidence: 0.8,
      kellyFraction: 1,
      entryPrice: 150,
      stopLossPct: 5,
      takeProfitPct: 10,
    });

    expect(expected.positionSizeUsd).toBeCloseTo(800, 5);
    expect(() =>
      assertTradeExecutionProfile(makeReplayResult(), expected),
    ).not.toThrow();
  });

  it("expectedTradeExecutionProfile sizes prediction-market trades against exposure cap", () => {
    const profile = expectedTradeExecutionProfile({
      strategy: "prediction_market",
      instrumentClass: "prediction_market",
      maxPositionUsd: 1000,
      maxExposureUsd: 400,
      confidence: 0.8,
      kellyFraction: 0.5,
      entryPrice: 0.62,
      stopLossPct: null,
      takeProfitPct: null,
    });

    expect(profile.positionSizeUsd).toBeCloseTo(160, 5);
    expect(profile.orderType).toBe("limit");
  });
});
