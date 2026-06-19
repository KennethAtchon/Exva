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
    name: "selector-workers/catalyst-feed-scout",
    phase: "selector",
    workerId: "catalyst-feed-scout",
    content: workerPrompts.SELECTOR_WORKERS_CATALYST_FEED_SCOUT_PROMPT,
  },
  {
    name: "selector-workers/market-validator",
    phase: "selector",
    workerId: "market-validator",
    content: workerPrompts.SELECTOR_WORKERS_MARKET_VALIDATOR_PROMPT,
  },
  {
    name: "technical-workers/price-reaction-checker",
    phase: "technical",
    workerId: "price-reaction-checker",
    content: workerPrompts.TECHNICAL_WORKERS_PRICE_REACTION_CHECKER_PROMPT,
  },
  {
    name: "fundamental-workers/document-extractor",
    phase: "fundamental",
    workerId: "document-extractor",
    content: workerPrompts.FUNDAMENTAL_WORKERS_DOCUMENT_EXTRACTOR_PROMPT,
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
      posturePresetId: "edgar_catalyst",
      processingMode: "catalyst",
      evidenceMode: "document_first",
      catalystMode: "preferred",
      fundamentalStrictness: "sanity_check",
      postureNotes: "Favor strong leaders with clean trend persistence.",
      updatedAt: ts,
    },
    rules: {
      sessionId: "s1",
      rulesPresetId: "catalyst_entry",
      setupType: "catalyst_entry",
      sideBias: "long_only",
      entryStyle: "catalyst",
      exitStyle: "trailing_atr",
      scalingMode: "single_entry",
      tradeRulesMarkdown: "",
      ruleNotes: "Avoid earnings week.",
      updatedAt: ts,
    },
    riskConfig: {
      sessionId: "s1",
      riskPresetId: "moderate",
      offHoursTrading: "disabled",
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
      maxConsecutiveLosers: 5,
      volatilityHaltMaxSpreadPct: null,
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
        processingMode: "catalyst",
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
