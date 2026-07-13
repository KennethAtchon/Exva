import type { ExperienceTemplateRepo } from "./experience-template-repo";

// ---------------------------------------------------------------------------
// Template IDs (stable, match experience descriptor IDs)
// ---------------------------------------------------------------------------

export const TEMPLATE_IDS = {
  MEAN_REVERSION: "rules-mean-reversion",
  BREAKOUT: "rules-breakout",
  TREND_FOLLOWING: "rules-trend-following",
  OPTIONS_FLOW: "options-flow-edge",
  EDGAR_CATALYST: "edgar-catalyst",
  PREDICTION_EVENT: "prediction-event-edge",
} as const;

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export function seedExperienceTemplates(repo: ExperienceTemplateRepo): void {
  seedMeanReversion(repo);
  seedBreakout(repo);
  seedTrendFollowing(repo);
  seedOptionsFlow(repo);
  seedEdgarCatalyst(repo);
  seedPredictionEvent(repo);
}

function seedMeanReversion(repo: ExperienceTemplateRepo): void {
  repo.createRevisionIfAbsent({
    templateId: TEMPLATE_IDS.MEAN_REVERSION,
    version: 1,
    status: "active",
    displayName: "Rules: Mean Reversion",
    description:
      "Deterministic mean-reversion entries on scheduled liquid-instrument scans. No LLM calls.",
    pipelineId: "rules-mean-reversion-cycle",
    strategyId: "mean-reversion",
    promptVariantKey: "manual",
    brokerRequirement: "any_supported_class",
    inputContract: {
      modes: ["scheduled_scan"],
      sourceKinds: [],
      signalKinds: ["scan_hit"],
      instrumentClasses: ["stock"],
      analysisTimeframes: ["15m", "30m", "1h", "4h", "1d"],
    },
    defaultPresetIds: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
    researchContract: {
      hypothesis:
        "Liquid equity ETFs that close ~2 std devs below their 20-bar mean revert toward the mean within one trading day, net of costs.",
      tradableUniverse: ["SPY", "QQQ"],
      instrumentClass: "stock",
      signalTimestamp: "intraday",
      label: { horizon: "1d", outcome: "net_return", benchmark: "SPY" },
      validation: {
        minOutOfSampleTrades: 100,
        minNetExpectancyUsd: 0,
        minLowerBoundSharpe: 0,
        maxDrawdownPct: 0.2,
        requiredFolds: 3,
      },
      costs: { spreadBps: 1, slippageBps: 2, commissionBps: 0 },
    },
    universePolicy: "allow_unvalidated_with_warning",
  });
}

function seedBreakout(repo: ExperienceTemplateRepo): void {
  repo.createRevisionIfAbsent({
    templateId: TEMPLATE_IDS.BREAKOUT,
    version: 1,
    status: "active",
    displayName: "Rules: Momentum Breakout",
    description:
      "Deterministic resistance-breakout entries on scheduled crypto scans. No LLM calls.",
    pipelineId: "rules-breakout-cycle",
    strategyId: "breakout",
    promptVariantKey: "manual",
    brokerRequirement: "any_supported_class",
    inputContract: {
      modes: ["scheduled_scan"],
      sourceKinds: [],
      signalKinds: ["scan_hit"],
      instrumentClasses: ["crypto"],
      analysisTimeframes: ["1h", "4h", "1d"],
    },
    defaultPresetIds: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
    researchContract: {
      hypothesis:
        "Crypto instruments that break above recent resistance continue higher over the next several 4h bars, net of costs.",
      tradableUniverse: ["BTC-USD"],
      instrumentClass: "crypto",
      signalTimestamp: "continuous",
      label: { horizon: "1d", outcome: "net_return", benchmark: "cash" },
      validation: {
        minOutOfSampleTrades: 100,
        minNetExpectancyUsd: 0,
        minLowerBoundSharpe: 0,
        maxDrawdownPct: 0.2,
        requiredFolds: 3,
      },
      costs: { spreadBps: 5, slippageBps: 8, commissionBps: 10 },
    },
    universePolicy: "allow_unvalidated_with_warning",
  });
}

function seedTrendFollowing(repo: ExperienceTemplateRepo): void {
  repo.createRevisionIfAbsent({
    templateId: TEMPLATE_IDS.TREND_FOLLOWING,
    version: 1,
    status: "active",
    displayName: "Rules: Trend Following",
    description:
      "Deterministic SMA-crossover trend entries on scheduled futures scans. No LLM calls.",
    pipelineId: "rules-trend-following-cycle",
    strategyId: "trend-following",
    promptVariantKey: "manual",
    brokerRequirement: "any_supported_class",
    inputContract: {
      modes: ["scheduled_scan"],
      sourceKinds: [],
      signalKinds: ["scan_hit"],
      instrumentClasses: ["futures"],
      analysisTimeframes: ["1h", "4h", "1d"],
    },
    defaultPresetIds: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
    researchContract: {
      hypothesis:
        "Futures contracts whose fast SMA crosses above the slow SMA continue trending over the next several 4h bars, net of costs.",
      tradableUniverse: ["GC", "CL"],
      instrumentClass: "futures",
      signalTimestamp: "continuous",
      label: { horizon: "5d", outcome: "net_return", benchmark: "cash" },
      validation: {
        minOutOfSampleTrades: 100,
        minNetExpectancyUsd: 0,
        minLowerBoundSharpe: 0,
        maxDrawdownPct: 0.2,
        requiredFolds: 3,
      },
      costs: { spreadBps: 2, slippageBps: 3, commissionBps: 1 },
    },
    universePolicy: "allow_unvalidated_with_warning",
  });
}

function seedOptionsFlow(repo: ExperienceTemplateRepo): void {
  // Options-flow strategy is disabled in the registry, but we seed the
  // template as active for catalog parity. Subscription activation will
  // be blocked by catalog-validator.
  repo.createRevisionIfAbsent({
    templateId: TEMPLATE_IDS.OPTIONS_FLOW,
    version: 1,
    status: "active",
    displayName: "Options Flow Edge",
    description:
      "Detects unusual options activity (volume >> open interest with directional skew) on liquid underlyings and trades the resulting directional read. Deterministic; no LLM calls in v1.",
    pipelineId: "options-flow-cycle",
    strategyId: "options-flow",
    promptVariantKey: "manual",
    brokerRequirement: "any_supported_class",
    inputContract: {
      modes: ["scheduled_scan"],
      sourceKinds: [],
      signalKinds: ["scan_hit"],
      instrumentClasses: ["stock"],
      analysisTimeframes: ["1h", "4h", "1d"],
    },
    defaultPresetIds: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
    researchContract: {
      hypothesis:
        "On liquid large-caps, sessions where option volume runs well above standing open interest with a directional call/put skew precede an abnormal move in the underlying within the holding window, net of costs.",
      tradableUniverse: ["AAPL", "NVDA"],
      instrumentClass: "stock",
      signalTimestamp: "intraday",
      label: { horizon: "5d", outcome: "net_return", benchmark: "cash" },
      validation: {
        minOutOfSampleTrades: 100,
        minNetExpectancyUsd: 0,
        minLowerBoundSharpe: 0,
        maxDrawdownPct: 0.25,
        requiredFolds: 3,
      },
      costs: { spreadBps: 2, slippageBps: 3, commissionBps: 0 },
    },
    universePolicy: "allow_unvalidated_with_warning",
  });
}

function seedEdgarCatalyst(repo: ExperienceTemplateRepo): void {
  repo.createRevisionIfAbsent({
    templateId: TEMPLATE_IDS.EDGAR_CATALYST,
    version: 1,
    status: "active",
    displayName: "EDGAR Catalyst",
    description:
      "AI-driven analysis of 8-K filings for catalyst-based drift plays. Calls LLM for fundamental + review + decision phases.",
    pipelineId: "edgar-8k-cycle",
    strategyId: null,
    promptVariantKey: "catalyst",
    brokerRequirement: "any_supported_class",
    inputContract: {
      modes: ["event_source"],
      sourceKinds: ["edgar_8k"],
      signalKinds: ["filing"],
      instrumentClasses: ["stock"],
      analysisTimeframes: ["1d"],
    },
    defaultPresetIds: {
      posturePresetId: "edgar_catalyst",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "catalyst",
    },
    researchContract: {
      hypothesis:
        "Certain 8-K filing types produce delayed price repricing: after controlling for SPY/sector return, a structured filing surprise predicts abnormal return over 1-5 days net of cost.",
      tradableUniverse: [],
      instrumentClass: "stock",
      signalTimestamp: "continuous",
      label: { horizon: "5d", outcome: "net_return", benchmark: "SPY" },
      validation: {
        minOutOfSampleTrades: 100,
        minNetExpectancyUsd: 0,
        minLowerBoundSharpe: 0,
        maxDrawdownPct: 0.2,
        requiredFolds: 3,
      },
      costs: { spreadBps: 3, slippageBps: 5, commissionBps: 0 },
    },
    universePolicy: "validated_only",
  });
}

function seedPredictionEvent(repo: ExperienceTemplateRepo): void {
  repo.createRevisionIfAbsent({
    templateId: TEMPLATE_IDS.PREDICTION_EVENT,
    version: 1,
    status: "active",
    displayName: "Prediction Event Edge",
    description:
      "AI-driven analysis of prediction-market odds/volume dislocations. Calls LLM for full cycle.",
    pipelineId: "prediction-event-cycle",
    strategyId: null,
    promptVariantKey: "catalyst",
    brokerRequirement: "polymarket_broker",
    inputContract: {
      modes: ["event_source"],
      sourceKinds: ["prediction_event"],
      signalKinds: ["market_dislocation"],
      instrumentClasses: ["prediction_market"],
      analysisTimeframes: ["1h", "1d"],
    },
    defaultPresetIds: {
      posturePresetId: "prediction_event_edge",
      rulesPresetId: "probability_edge",
      riskPresetId: "prediction_market",
      timeframePresetId: "prediction",
    },
    researchContract: {
      hypothesis:
        "When a calibrated structured-evidence model estimates a binary market's true probability meaningfully above/below the market-implied mid, the market reprices toward the model estimate by resolution, net of spread and fees.",
      tradableUniverse: [],
      instrumentClass: "prediction_market",
      signalTimestamp: "continuous",
      label: {
        horizon: "resolution",
        outcome: "probability_market_resolution",
        benchmark: "market_implied_probability",
      },
      validation: {
        minOutOfSampleTrades: 100,
        minNetExpectancyUsd: 0,
        minLowerBoundSharpe: 0,
        maxDrawdownPct: 0.2,
        maxBrierScore: 0.25,
        requiredFolds: 3,
      },
      costs: { spreadBps: 50, slippageBps: 10, commissionBps: 0 },
    },
    universePolicy: "validated_only",
  });
}
