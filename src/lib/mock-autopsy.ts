import type {
  AutopsyLesson,
  AutopsyStructured,
  PhaseTrace,
  TradeAutopsyRecord,
} from "./autopsy-types";

// ---------------------------------------------------------------------------
// Mock structured data
// ---------------------------------------------------------------------------

export const MOCK_STRUCTURED: AutopsyStructured = {
  executiveSummary:
    "The agent entered a technically sound thesis on BTC/USD but sized the position aggressively given elevated volatility. Entry timing was premature by approximately 45 minutes relative to the key level breakout confirmation. Exit management was reactive rather than planned — the stop loss was moved twice, violating the session's pre-defined risk rules. Net result was a small loss that could have been a moderate gain with disciplined execution.",
  thesisReview: {
    valid: true,
    analysis:
      "The bullish thesis was logically constructed: price was approaching a well-tested support zone with declining volume on the selloff and positive funding rates. The agent correctly identified the regime as trending and the RR was favorable at 2.4:1. The thesis held through the trade lifecycle. The loss was not due to a bad thesis but due to poor execution layered on top of a valid setup.",
    confirmatoryBias: true,
    prematureConviction: false,
    ignoredCounterSignals: [
      "BTC dominance was declining, suggesting alt rotation pressure",
      "Perpetual funding flipped negative briefly 2h before entry",
    ],
  },
  executionQuality: {
    entryTiming: "early",
    sizingAdequacy: "oversized",
    exitManagement:
      "Stop loss was moved from $41,200 to $40,850 at 14:22 without documented rationale, then widened again to $41,400 at 15:10. This pattern indicates reactive adjustment rather than planned management. Take profit was not adjusted despite thesis holding.",
    slippage: "$0.18 above intended entry due to market order on thin book",
  },
  behavioralFlags: [
    {
      flag: "stop_moved",
      description:
        "Stop loss adjusted twice within a 2-hour window without documented reasoning — clear stop-hunting avoidance behavior.",
      severity: "high",
    },
    {
      flag: "overconfidence",
      description:
        "Position sized at 140% of the session's standard unit despite uncertainty in market regime classification.",
      severity: "medium",
    },
  ],
  marketContext: {
    regime: "trending",
    macro:
      "Risk-on environment with DXY weakness and equity markets recovering from prior week's FOMC selloff. Crypto benefiting from macro tailwind.",
    volatility:
      "ATR(14) at 2.1% — above 30-day average of 1.7%. Elevated but not extreme. Spread conditions normal.",
    suitability: "good_conditions",
  },
  whatWorked: [
    "Thesis construction was methodical and correct — support level identification was precise",
    "Research phase correctly identified the regime as trending",
    "Initial stop placement was at a logical technical level",
    "Cost was contained — AI spend remained within budget",
  ],
  whatFailed: [
    "Entry was taken 45 minutes before breakout confirmation, adding unnecessary noise exposure",
    "Stop loss was moved twice, violating the session's immovable stop rule",
    "Position was 40% oversized relative to session standard unit",
    "No plan for managing the take profit despite the thesis being correct",
  ],
  rootCause:
    "The agent over-indexed on the thesis quality and failed to apply the execution ruleset independently. A correct thesis does not override position sizing limits or stop-loss immutability rules. These are orthogonal — the agent treated execution discipline as optional when the thesis was strong.",
  processImprovements: [
    "Add a hard pre-trade checklist gate: if position size > 1.0x standard unit AND ATR > 2%, reject automatically",
    "Log a required rationale string before any stop loss modification; block the modification if the string is empty",
    "Implement a minimum time-in-trade rule of 30 minutes before allowing any stop adjustment",
  ],
};

export const MOCK_PHASES: PhaseTrace[] = [
  {
    phase: "thesis",
    modelId: "google/gemma-3-27b-it",
    providerKey: "openrouter",
    systemPrompt:
      "You are reviewing whether an AI trading agent's thesis was logically valid. Focus only on reasoning quality — not on outcome. A bad thesis that wins is still a bad thesis. A good thesis that loses to noise is still good. Answer with JSON matching the ThesisReview schema.",
    userPrompt:
      "Trade: BTC/USD BUY | P&L: -$142.30 | Confidence: 0.74\nStrategy: momentum_breakout_v3\n\nDecision agent output:\n{\"action\":\"BUY\",\"thesis\":\"Strong support at $41,200 with declining sell volume. Funding positive. RR 2.4:1.\",\"conviction\":\"HIGH\"}",
    toolCallsJson: null,
    responseText: JSON.stringify(MOCK_STRUCTURED.thesisReview),
    inputTokens: 1240,
    outputTokens: 387,
    costUsd: 0.00082,
    durationMs: 2340,
    error: null,
  },
  {
    phase: "execution",
    modelId: "google/gemma-3-27b-it",
    providerKey: "openrouter",
    systemPrompt:
      "You are reviewing trade execution mechanics. Assess entry timing, position sizing relative to conviction, and exit management. Do not comment on the thesis. Answer with JSON matching the ExecutionQuality schema.",
    userPrompt:
      "Trade: BTC/USD BUY\nEntry: $41,387.50 | Stop Loss: $40,850.00 → $41,400.00 | Take Profit: $42,800.00\nPosition Size: $8,400.00 | Final P&L: -$142.30\nHold Duration: 3h 22m\nConfidence Score: 0.74",
    toolCallsJson: null,
    responseText: JSON.stringify(MOCK_STRUCTURED.executionQuality),
    inputTokens: 890,
    outputTokens: 312,
    costUsd: 0.00061,
    durationMs: 1870,
    error: null,
  },
  {
    phase: "behavioral",
    modelId: "google/gemma-3-27b-it",
    providerKey: "openrouter",
    systemPrompt:
      "You are a trading psychologist reviewing an AI agent's message transcript for behavioral failure patterns (FOMO, revenge, overconfidence, panic exit, rule violation, stop movement, etc.). List only patterns that have clear textual evidence in the transcript. Answer with JSON matching BehavioralFlags schema.",
    userPrompt:
      "Full agent transcript for this trade (14 messages):\n\n---\nRole: technical | Model: gemma-3-27b-it\nOutput: {\"signals\":[{\"type\":\"support_test\",\"strength\":0.82}]}\n---\n[... 13 additional messages truncated for display ...]",
    toolCallsJson: null,
    responseText: JSON.stringify({
      behavioralFlags: MOCK_STRUCTURED.behavioralFlags,
    }),
    inputTokens: 3420,
    outputTokens: 445,
    costUsd: 0.00198,
    durationMs: 4120,
    error: null,
  },
  {
    phase: "market_context",
    modelId: "google/gemma-3-27b-it",
    providerKey: "openrouter",
    systemPrompt:
      "You are a market analyst. Based on the market snapshot provided, describe the regime, volatility conditions, and whether these conditions were suitable for the stated strategy. Answer with JSON matching MarketContext schema.",
    userPrompt:
      "Trade opened: 2026-05-21T13:47:00Z | Closed: 2026-05-21T17:09:00Z\nSymbol: BTC/USD | Strategy timeframe: 4H\n\nMarket snapshot at trade entry:\n{\"atr14\":2.1,\"dxy\":102.8,\"btcDominance\":52.3,\"fundingRate\":0.0001,\"spread\":0.12}",
    toolCallsJson: null,
    responseText: JSON.stringify(MOCK_STRUCTURED.marketContext),
    inputTokens: 760,
    outputTokens: 298,
    costUsd: 0.00053,
    durationMs: 1560,
    error: null,
  },
  {
    phase: "synthesis",
    modelId: "google/gemma-3-27b-it",
    providerKey: "openrouter",
    systemPrompt:
      "You are a senior prop-firm mentor reviewing a trade autopsy. You have been given four specialist analyses. Your job: write a concise executive summary, assign a letter grade (A+ through F) and numeric score (0–100), list what worked, what failed, the root cause of failure (if any), and 1–3 actionable process improvements. Extract 0–3 structured lessons. Answer with JSON matching AutopsySynthesis schema.",
    userPrompt:
      "THESIS REVIEW:\n{valid:true, confirmatoryBias:true, ...}\n\nEXECUTION QUALITY:\n{entryTiming:'early', sizingAdequacy:'oversized', ...}\n\nBEHAVIORAL FLAGS:\n[{flag:'stop_moved', severity:'high'}, ...]\n\nMARKET CONTEXT:\n{regime:'trending', suitability:'good_conditions'}\n\nTrade outcome: BTC/USD BUY | P&L: -$142.30 (-1.7%) | Grade this trade.",
    toolCallsJson: null,
    responseText: JSON.stringify({
      grade: "C",
      score: 58,
      executiveSummary: MOCK_STRUCTURED.executiveSummary,
      whatWorked: MOCK_STRUCTURED.whatWorked,
      whatFailed: MOCK_STRUCTURED.whatFailed,
      rootCause: MOCK_STRUCTURED.rootCause,
      processImprovements: MOCK_STRUCTURED.processImprovements,
      lessons: [
        {
          lesson: "Stop losses must not be modified after initial placement",
          severity: "high",
          category: "execution",
          proposedFix:
            "Add a hard stop-modification lock at the orchestrator level. Any attempt to modify stop_loss_price on an open trade after T+5min should require a CRITICAL-level override flag.",
        },
      ],
    }),
    inputTokens: 2180,
    outputTokens: 820,
    costUsd: 0.00174,
    durationMs: 5890,
    error: null,
  },
];

export const MOCK_AUTOPSY_V1: TradeAutopsyRecord = {
  id: "autopsy-mock-v1",
  tradeId: "trade-mock-001",
  sessionId: "session-mock-001",
  modelId: "google/gemma-3-27b-it",
  summary:
    "Valid thesis, poor execution. Stop moved twice, position oversized. Thesis was correct but execution violated session rules.",
  summaryStructuredJson: JSON.stringify(MOCK_STRUCTURED),
  phaseTracesJson: JSON.stringify(MOCK_PHASES),
  qualityGrade: "C",
  qualityScore: 58,
  isFallback: false,
  createdAt: "2026-05-21T18:30:00Z",
  createdBy: "user",
};

export const MOCK_AUTOPSY_V2: TradeAutopsyRecord = {
  id: "autopsy-mock-v2",
  tradeId: "trade-mock-001",
  sessionId: "session-mock-001",
  modelId: "google/gemma-3-27b-it",
  summary: "Regenerated with updated market context.",
  summaryStructuredJson: JSON.stringify({
    ...MOCK_STRUCTURED,
    executiveSummary:
      "Regenerated analysis with additional market context confirms the original thesis was sound. Behavioral flags remain the primary driver of underperformance.",
    executionQuality: {
      ...MOCK_STRUCTURED.executionQuality,
      entryTiming: "good" as const,
    },
  }),
  phaseTracesJson: JSON.stringify(MOCK_PHASES),
  qualityGrade: "B",
  qualityScore: 71,
  isFallback: false,
  createdAt: "2026-05-24T09:15:00Z",
  createdBy: "user",
};

export const MOCK_LESSONS: AutopsyLesson[] = [
  {
    id: "lesson-001",
    autopsyId: "autopsy-mock-v1",
    tradeId: "trade-mock-001",
    sessionId: "session-mock-001",
    lesson:
      "Stop losses must not be modified after initial placement — any adjustment requires a documented rationale and constitutes a rule violation.",
    severity: "high",
    category: "execution",
    proposedFix:
      "Add a hard stop-modification lock at the orchestrator level. Require a CRITICAL-level override flag after T+5min from entry.",
    status: "recurring",
    recurrenceCount: 2,
    createdAt: "2026-05-21T18:30:00Z",
    updatedAt: "2026-05-24T09:15:00Z",
    validatedAt: null,
  },
  {
    id: "lesson-002",
    autopsyId: "autopsy-mock-v1",
    tradeId: "trade-mock-001",
    sessionId: "session-mock-001",
    lesson:
      "Position sizing must be capped at 1.0x standard unit when ATR(14) exceeds 2.0% — high volatility demands smaller unit size, not larger.",
    severity: "high",
    category: "risk",
    proposedFix:
      "Add a pre-trade gate in order-placer: if ATR > 2.0% then position_size_usd = min(position_size_usd, standard_unit_usd * 1.0).",
    status: "implemented",
    recurrenceCount: 0,
    createdAt: "2026-05-21T18:30:00Z",
    updatedAt: "2026-05-22T11:00:00Z",
    validatedAt: null,
  },
  {
    id: "lesson-003",
    autopsyId: "autopsy-mock-v1",
    tradeId: "trade-mock-001",
    sessionId: "session-mock-001",
    lesson:
      "Entry should wait for breakout confirmation (close above level) before executing — do not anticipate the break.",
    severity: "medium",
    category: "strategy",
    proposedFix:
      "Add minimum confirmation bar rule to strategy config: entry trigger requires N consecutive closes above the breakout level.",
    status: "pending",
    recurrenceCount: 0,
    createdAt: "2026-05-21T18:30:00Z",
    updatedAt: "2026-05-21T18:30:00Z",
    validatedAt: null,
  },
];
