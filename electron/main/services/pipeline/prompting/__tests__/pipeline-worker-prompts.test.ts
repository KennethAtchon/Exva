import { describe, expect, it } from "vitest";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { emptySessionAiSettings } from "@electron/shared/domain";
import {
  buildWorkerPrompt,
  measureWorkerPrompt,
} from "../worker-prompt-builder";
import * as workerPrompts from "../../worker-prompts";

const PROMPT_CASES: Array<{
  name: string;
  phase: "selector" | "technical" | "fundamental" | "review" | "decision";
  workerId: string;
  content: string;
}> = [
  {
    name: "selector-workers/web-scout",
    phase: "selector",
    workerId: "web-scout",
    content: workerPrompts.SELECTOR_WORKERS_WEB_SCOUT_PROMPT,
  },
  {
    name: "selector-workers/reddit-scout",
    phase: "selector",
    workerId: "reddit-scout",
    content: workerPrompts.SELECTOR_WORKERS_REDDIT_SCOUT_PROMPT,
  },
  {
    name: "selector-workers/trend-scout",
    phase: "selector",
    workerId: "trend-scout",
    content: workerPrompts.SELECTOR_WORKERS_TREND_SCOUT_PROMPT,
  },
  {
    name: "selector-workers/market-validator",
    phase: "selector",
    workerId: "market-validator",
    content: workerPrompts.SELECTOR_WORKERS_MARKET_VALIDATOR_PROMPT,
  },
  {
    name: "technical-workers/chart-pattern",
    phase: "technical",
    workerId: "chart-pattern",
    content: workerPrompts.TECHNICAL_WORKERS_CHART_PATTERN_PROMPT,
  },
  {
    name: "technical-workers/momentum-indicator",
    phase: "technical",
    workerId: "momentum-indicator",
    content: workerPrompts.TECHNICAL_WORKERS_MOMENTUM_INDICATOR_PROMPT,
  },
  {
    name: "fundamental-workers/earnings-context",
    phase: "fundamental",
    workerId: "earnings-context",
    content: workerPrompts.FUNDAMENTAL_WORKERS_EARNINGS_CONTEXT_PROMPT,
  },
  {
    name: "review-workers/conflict-detector",
    phase: "review",
    workerId: "conflict-detector",
    content: workerPrompts.REVIEW_WORKERS_CONFLICT_DETECTOR_PROMPT,
  },
  {
    name: "decision-workers/signal-classifier",
    phase: "decision",
    workerId: "signal-classifier",
    content: workerPrompts.DECISION_WORKERS_SIGNAL_CLASSIFIER_PROMPT,
  },
];

const BANNED = [
  /first do .+ then/i,
  /if .+ fails?,? try/i,
  /you are operating inside exva/i,
  /submit_candidates/i,
  /use `get_/i,
  /use `fetch_/i,
  /no other tools/i,
];

function baseContext(): SessionStrategyContext {
  const ts = "2026-05-05T00:00:00.000Z";
  return {
    researchPosture: {
      sessionId: "s1",
      posturePresetId: "trend_hunt",
      discoveryMode: "trend_scan",
      evidenceMode: "price_action_first",
      catalystMode: "preferred",
      fundamentalStrictness: "sanity_check",
      postureNotes: "Favor strong leaders with clean trend persistence.",
      updatedAt: ts,
    },
    rules: {
      sessionId: "s1",
      rulesPresetId: "breakout_long",
      setupType: "breakout",
      sideBias: "long_only",
      entryStyle: "breakout",
      exitStyle: "trailing_atr",
      scalingMode: "single_entry",
      tradeRulesMarkdown: "",
      ruleNotes: "Avoid earnings week.",
      updatedAt: ts,
    },
    riskConfig: {
      sessionId: "s1",
      riskPresetId: "moderate",
      maxPositionUsd: 100,
      stopLossPct: 2,
      takeProfitPct: 4,
      stopLossType: "fixed_pct",
      atrStopMultiplier: 1.5,
      kellyFraction: 0.25,
      predictionEdgeThreshold: 0.08,
      maxExposureUsd: null,
      waitForOpenThreshold: 0.8,
      maxConcurrentTrades: 1,
      dailyLossLimitUsd: 50,
      profitTargetUsd: 200,
      maxAiSpendUsd: 5,
      maxDataSpendUsd: 5,
      humanApprovalRequired: false,
      updatedAt: ts,
    },
    timeframe: {
      sessionId: "s1",
      timeframePresetId: "swing",
      primaryTradingTimeframe: "1h",
      holdingStyle: "multi_day_swing",
      targetHoldDays: 3,
      maxHoldDays: 10,
      timeframeNotes: "",
      updatedAt: ts,
    },
    aiSettings: emptySessionAiSettings("s1", ts),
  };
}

function representativeTask(
  phase: "selector" | "technical" | "fundamental" | "review" | "decision",
): Record<string, unknown> {
  const technicalSignal = JSON.stringify({
    symbol: "AAPL",
    trendDirection: "bullish",
    trendStrength: 0.9,
    momentumScore: 0.8,
    volumeScore: 0.7,
    volumeSignal: "accumulation",
    patternName: "breakout",
    patternStrength: 0.75,
    nearestSupport: 184,
    nearestResistance: 188,
    timeframeAlignment: 0.8,
  });
  const fundamentalSignal = JSON.stringify({
    symbol: "AAPL",
    catalystType: "partnership",
    catalystStrength: 0.7,
    catalystFreshness: 0.8,
    catalystScore: 0.75,
    catalystSummary: "Positive supply-chain checks.",
    earningsScore: null,
    sentimentScore: 0.68,
    contradictionRisk: 0.12,
  });
  const reviewSignal = JSON.stringify({
    symbol: "AAPL",
    technicalFundamentalConflict: 0.12,
    conflictExplanation: "Signals align.",
    tailRisks: [],
    overallRisk: "low",
    recommendation: "proceed",
  });

  switch (phase) {
    case "selector":
      return {
        selectionInstructions: "Find 1-3 tradeable breakout candidates.",
        instrumentClasses: ["stock", "crypto"],
        discoveryMode: "trend_scan",
        candidate: {
          symbol: "AAPL",
          instrumentClass: "stock",
          instrumentDisplayName: "Apple Inc.",
          rationale: "Strong breakout with fresh catalyst.",
        },
      };
    case "technical":
    case "fundamental":
      return {
        instrumentSymbol: "AAPL",
        context:
          "Verified selector evidence: momentum breakout with recent catalyst confirmation.",
      };
    case "review":
      return {
        instrumentSymbol: "AAPL",
        technicalSignal,
        fundamentalSignal,
      };
    case "decision":
      return {
        instrumentSymbol: "AAPL",
        technicalSignal,
        fundamentalSignal,
        reviewSignal,
      };
  }
}

const TEST_STRATEGY_CONTEXT_REQUEST = {
  fields: [
    "identity",
    "researchPosture",
    "tradeRules",
    "riskLimits",
    "timeframe",
    "presetBehavior",
  ],
  guidance: ["objective", "whatToLookFor", "howToEvaluate", "avoid"],
  maxGuidanceItems: 2,
} as const;

describe("pipeline worker prompts", () => {
  const context = baseContext();

  it("has at least one worker prompt", () => {
    expect(PROMPT_CASES.length).toBeGreaterThan(5);
  });

  for (const { name, phase, workerId, content } of PROMPT_CASES) {
    it(`${name} stays within 1600 characters`, () => {
      expect(content.length).toBeLessThanOrEqual(1600);
    });

    it(`${name} avoids banned orchestration phrases`, () => {
      for (const pattern of BANNED) {
        expect(content).not.toMatch(pattern);
      }
    });

    it(`${name} full envelope stays within runtime prompt limits`, () => {
      const messages = buildWorkerPrompt({
        phase,
        workerId,
        basePromptMarkdown: content,
        task: representativeTask(phase),
        strategyContext: context,
        strategyContextRequest: TEST_STRATEGY_CONTEXT_REQUEST,
        engineResults: {
          riskSummary: {
            maxPositionUsd: 100,
            stopLossPct: 2,
            takeProfitPct: 4,
            humanApprovalRequired: false,
          },
        },
      });
      const sizes = measureWorkerPrompt(messages);

      expect(sizes.exceedsSystem).toBe(false);
      expect(sizes.exceedsUser).toBe(false);
    });
  }
});

describe("global worker guidance", () => {
  it("injects session_worker_guidance for every worker when configured", () => {
    const context = {
      ...baseContext(),
      aiSettings: {
        sessionId: "s1",
        workerGuidanceMarkdown: "Prefer liquid large caps only.",
        updatedAt: "2026-05-05T00:00:00.000Z",
      },
    };
    const messages = buildWorkerPrompt({
      phase: "technical",
      workerId: "chart-pattern",
      basePromptMarkdown: "# Chart Pattern",
      task: { instrumentSymbol: "AAPL" },
      strategyContext: context,
      strategyContextRequest: TEST_STRATEGY_CONTEXT_REQUEST,
    });
    const user = messages.find((message) => message.role === "user")?.content;
    expect(user).toContain("<session_worker_guidance>");
    expect(user).toContain("Prefer liquid large caps only.");
  });
});
