import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { SessionStrategyContext } from "@electron/shared/domain";
import {
  buildPromptEnvelope,
  envelopeToMessages,
  measurePromptEnvelope,
} from "../pipeline-runtime/prompting/prompt-envelope-builder";

const PROMPTS_DIR = path.join(
  import.meta.dirname,
  "../pipeline-runtime/prompts",
);

const BANNED = [
  /first do .+ then/i,
  /if .+ fails?,? try/i,
  /you are operating inside exva/i,
  /submit_candidates/i,
  /use `get_/i,
  /use `search_/i,
  /use `fetch_/i,
  /no other tools/i,
];

function walkMarkdownFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdownFiles(full));
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

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
  };
}

function representativeTask(phase: "selector" | "technical" | "fundamental" | "review" | "decision"): Record<string, unknown> {
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
        context: "Verified selector evidence: momentum breakout with recent catalyst confirmation.",
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

function phaseAndWorkerFrom(file: string): { phase: "selector" | "technical" | "fundamental" | "review" | "decision"; workerId: string } {
  const relative = path.relative(PROMPTS_DIR, file);
  const firstSegment = relative.split(path.sep)[0] ?? "";
  const workerId = path.basename(file, ".md");

  if (firstSegment.startsWith("selector-workers")) return { phase: "selector", workerId };
  if (firstSegment.startsWith("technical-workers")) return { phase: "technical", workerId };
  if (firstSegment.startsWith("fundamental-workers")) return { phase: "fundamental", workerId };
  if (firstSegment.startsWith("review-workers")) return { phase: "review", workerId };
  if (firstSegment.startsWith("decision-workers")) return { phase: "decision", workerId };

  throw new Error(`Unknown prompt phase for ${relative}`);
}

describe("pipeline worker prompts", () => {
  const files = walkMarkdownFiles(PROMPTS_DIR);
  const context = baseContext();

  it("has at least one worker prompt asset", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const name = path.relative(PROMPTS_DIR, file);
    it(`${name} stays within 1600 characters`, () => {
      const content = fs.readFileSync(file, "utf8");
      expect(content.length).toBeLessThanOrEqual(1600);
    });

    it(`${name} avoids banned orchestration phrases`, () => {
      const content = fs.readFileSync(file, "utf8");
      for (const pattern of BANNED) {
        expect(content).not.toMatch(pattern);
      }
    });

    it(`${name} full envelope stays within runtime prompt limits`, () => {
      const content = fs.readFileSync(file, "utf8");
      const { phase, workerId } = phaseAndWorkerFrom(file);
      const envelope = buildPromptEnvelope({
        phase,
        workerId,
        basePromptMarkdown: content,
        task: representativeTask(phase),
        strategyContext: context,
        engineResults: {
          riskSummary: {
            maxPositionUsd: 100,
            stopLossPct: 2,
            takeProfitPct: 4,
            humanApprovalRequired: false,
          },
        },
      });
      const messages = envelopeToMessages(envelope, context);
      const sizes = measurePromptEnvelope(messages);

      expect(sizes.exceedsSystem).toBe(false);
      expect(sizes.exceedsUser).toBe(false);
    });
  }
});
