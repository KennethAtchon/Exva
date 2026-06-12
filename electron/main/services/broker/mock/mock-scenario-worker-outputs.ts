import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";
import { SCENARIO_PRIMARY_SYMBOLS } from "./mock-discovery-fixtures";

/** Canned LLM worker outputs per mock scenario — validated at runtime against each worker's zod schema. */
export type ScriptedWorkerOutputs = Record<string, unknown>;

const BULLISH_MOMENTUM = {
  trendDirection: "bullish" as const,
  trendStrength: 0.85,
  momentumScore: 0.8,
  rawSummary: "Scripted bullish momentum for mock E2E.",
};

const STRONG_VOLUME = {
  volumeScore: 0.82,
  volumeSignal: "accumulation" as const,
  rawSummary: "Scripted strong volume for mock E2E.",
};

const STRONG_CATALYST = {
  catalystType: "partnership" as const,
  catalystStrength: 0.88,
  catalystFreshness: 0.9,
  contradictionRisk: 0.1,
  rawSummary: "Scripted material catalyst for mock E2E.",
};

const POSITIVE_REACTION = {
  earningsScore: 0.75,
  rawSummary: "Scripted positive market reaction for mock E2E.",
};

const LOW_CONFLICT = {
  technicalFundamentalConflict: 0.1,
  conflictExplanation: null,
  rawSummary: "Scripted aligned signals.",
};

const LOW_RISK = {
  tailRisks: [] as string[],
  overallRisk: "low" as const,
  rawSummary: "Scripted low risk assessment.",
};

const HIGH_RISK = {
  tailRisks: ["reversal risk", "headline risk"],
  overallRisk: "high" as const,
  rawSummary: "Scripted high risk — review should skip.",
};

const BUY_CLASSIFIER = {
  executionStrategy: "event_driven" as const,
  action: "buy" as const,
  confidence: 0.9,
  reasoning: "Scripted buy signal for deterministic mock E2E.",
};

const SKIP_CLASSIFIER = {
  executionStrategy: "trend_momentum" as const,
  action: "skip" as const,
  confidence: 0.3,
  reasoning: "Scripted skip for mock scenario.",
};

const ENTER_NOW = {
  entryTiming: "now" as const,
  entryPrice: null,
  rawSummary: "Scripted immediate entry for mock E2E.",
};

const SKIP_TIMER = {
  entryTiming: "skip" as const,
  entryPrice: null,
  rawSummary: "Scripted skip timing for mock scenario.",
};

function candidateOutput(symbol: string) {
  return {
    candidates: [
      {
        symbol,
        instrumentClass: "stock" as const,
        instrumentDisplayName: symbol,
        source: "mock_scripted",
        hypeScore: 0.7,
        volumeScore: 0.8,
        catalystScore: 0.85,
        liquidityScore: 0.75,
        catalystSummary: "Scripted catalyst candidate.",
        riskFlags: [] as string[],
        rationale: "Scripted selector candidate for mock E2E.",
      },
    ],
  };
}

function verificationOutput(symbol: string, scores = { liquidity: 0.8 }) {
  return {
    candidate: {
      symbol,
      instrumentClass: "stock" as const,
      instrumentDisplayName: symbol,
      source: "mock_scripted",
      hypeScore: 0.7,
      volumeScore: 0.8,
      catalystScore: 0.85,
      liquidityScore: scores.liquidity,
      catalystSummary: "Scripted verified candidate.",
      riskFlags: [] as string[],
      rationale: "Scripted verification pass.",
    },
  };
}

function verificationWorkers(symbol: string, liquidity = 0.8) {
  const verified = verificationOutput(symbol, { liquidity });
  return {
    [`market-validator:${symbol}`]: verified,
    [`catalyst-extractor:${symbol}`]: verified,
    [`liquidity-gate:${symbol}`]: verified,
  };
}

function tradePathOutputs(symbol: string): ScriptedWorkerOutputs {
  return {
    "catalyst-feed-scout": candidateOutput(symbol),
    "web-scout": candidateOutput(symbol),
    "price-reaction-checker": BULLISH_MOMENTUM,
    "volume-profile": STRONG_VOLUME,
    "document-extractor": STRONG_CATALYST,
    "market-reaction-checker": POSITIVE_REACTION,
    "conflict-detector": LOW_CONFLICT,
    "risk-assessor": LOW_RISK,
    "signal-classifier": BUY_CLASSIFIER,
    "entry-timer": ENTER_NOW,
    ...verificationWorkers(symbol),
  };
}

const SCENARIO_WORKER_OUTPUTS: Record<
  MockScenarioKind,
  (primarySymbol: string) => ScriptedWorkerOutputs
> = {
  clean_breakout: tradePathOutputs,
  partial_fill: tradePathOutputs,
  failed_breakout: (symbol) => ({
    ...tradePathOutputs(symbol),
    "signal-classifier": BUY_CLASSIFIER,
    "risk-assessor": LOW_RISK,
  }),
  gap_down_after_entry: tradePathOutputs,
  sideways_chop: (symbol) => ({
    ...tradePathOutputs(symbol),
    "signal-classifier": SKIP_CLASSIFIER,
    "entry-timer": SKIP_TIMER,
  }),
  news_reversal: (symbol) => ({
    ...tradePathOutputs(symbol),
    "risk-assessor": HIGH_RISK,
    "conflict-detector": {
      technicalFundamentalConflict: 0.85,
      conflictExplanation: "Scripted reversal conflict.",
      rawSummary: "Scripted conflict for news_reversal.",
    },
    "signal-classifier": SKIP_CLASSIFIER,
    "entry-timer": SKIP_TIMER,
  }),
  stale_quote: tradePathOutputs,
  wide_spread: tradePathOutputs,
  broker_reject: tradePathOutputs,
  rate_limit: tradePathOutputs,
};

export function scriptedWorkerOutputsForScenario(
  kind: MockScenarioKind,
  primarySymbol?: string,
): ScriptedWorkerOutputs {
  const symbol =
    primarySymbol ??
    SCENARIO_PRIMARY_SYMBOLS[kind]?.[0] ??
    SCENARIO_PRIMARY_SYMBOLS.clean_breakout[0] ??
    "NVDA";
  return SCENARIO_WORKER_OUTPUTS[kind](symbol);
}

/** Resolve scripted output — supports exact id or prefix patterns like `market-validator:`. */
export function resolveScriptedWorkerOutput(
  workerId: string,
  outputs: ScriptedWorkerOutputs,
): unknown | undefined {
  if (workerId in outputs) return outputs[workerId];
  const prefix = workerId.split(":")[0];
  if (!prefix) return undefined;
  for (const [key, value] of Object.entries(outputs)) {
    if (key.startsWith(`${prefix}:`)) return value;
  }
  return undefined;
}
