// Bundled worker prompt constants used by pipeline worker definitions.
// Keep this file aligned with the active worker set and prompt contracts.

export const DECISION_WORKERS_ENTRY_TIMER_PROMPT = `# Entry timer

Given the same compact signals for {instrumentSymbol}, decide whether now is the right entry moment.

No tools.

- \`skip\` when conditions are poor or review says skip.
- \`wait\` when setup is valid but timing is not ideal yet.
- \`now\` when entering immediately is reasonable.
- \`entryPrice\` only when a specific limit level is justified; otherwise null.

When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const DECISION_WORKERS_SIGNAL_CLASSIFIER_PROMPT = `# Signal classifier

Given compact technical, fundamental, and review signals for {instrumentSymbol}, choose direction and execution strategy.

No tools. Do not output size, stop loss, or take profit.

- Use \`skip\` when review recommends skip or evidence is insufficient.
- Match \`executionStrategy\` to the dominant setup (catalyst → event_driven, trend → trend_momentum, etc.).
- If action is \`buy\` or \`sell\`, \`confidence\` must be ≥ the wait-for-open threshold in the risk limits. If evidence does not support that level of confidence, use \`skip\` instead.

When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const FUNDAMENTAL_WORKERS_CATALYST_CONTEXT_PROMPT = `# Catalyst context

Given recent news and web context for {instrumentSymbol}, identify the primary catalyst driving current price action.

\`catalystStrength\` — how material the catalyst is for near-term price (0 = minor, 1 = major).
\`catalystFreshness\` — how recently the catalyst emerged (0 = stale/priced-in, 1 = just breaking).
\`contradictionRisk\` — probability that conflicting signals meaningfully undermine the catalyst (0 = clean, 1 = heavily contradicted).
Return null for catalystType/strength/freshness when no identifiable catalyst exists.

No trade decision. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const FUNDAMENTAL_WORKERS_EARNINGS_CONTEXT_PROMPT = `# Earnings context

Given recent news for {instrumentSymbol}, assess earnings quality and trajectory.

\`earningsScore\` — earnings quality relative to expectations (0 = miss/deteriorating, 1 = strong beat/accelerating), or null if no earnings evidence is available.

No trade decision. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const FUNDAMENTAL_WORKERS_EVENT_CATALYST_PROMPT = `# Event catalyst

Identify catalysts that could reprice implied probability before resolution.

No trade sizing. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const FUNDAMENTAL_WORKERS_EVENT_RESOLUTION_PROMPT = `# Resolution context

Summarize resolution rules, timing, and disqualifying scenarios for the event contract.

Use news and web evidence; map qualitative facts into \`rawSummary\`. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const FUNDAMENTAL_WORKERS_EVENT_SENTIMENT_PROMPT = `# Event sentiment

Gauge narrative sentiment and positioning skew for the contract.

Use social and web signals. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const FUNDAMENTAL_WORKERS_SENTIMENT_CONTEXT_PROMPT = `# Sentiment context

Given web discussion for {instrumentSymbol}, assess current retail and institutional sentiment.

\`sentimentScore\` — aggregate sentiment strength (0 = bearish/negative consensus, 1 = bullish/positive consensus), or null if no meaningful signal exists.
Distinguish organic conviction from hype. Null is preferable to a fabricated score.

No trade decision. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const REVIEW_WORKERS_CONFLICT_DETECTOR_PROMPT = `# Conflict detector

Given the technical and fundamental signals for {instrumentSymbol}, identify whether they agree or contradict each other.

No tools. Use only the structured signal inputs provided.

Technical signal: {technicalSignal}
Fundamental signal: {fundamentalSignal}

\`technicalFundamentalConflict\` — degree to which technical and fundamental signals disagree (0 = fully aligned, 1 = directly opposed). Use null only if both signals are entirely absent.

Agreement examples: bullish trend + strong catalyst + positive sentiment = low conflict. Bearish trend + weak earnings + negative sentiment = low conflict.
Conflict examples: bullish trend + poor earnings + high contradictionRisk = high conflict. Strong catalyst + bearish volume distribution = medium conflict.

No trade recommendation. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const REVIEW_WORKERS_RISK_ASSESSOR_PROMPT = `# Risk assessor

Given the technical and fundamental signals for {instrumentSymbol}, identify tail risks and assign an overall risk level.

No tools. Use only the structured signal inputs provided.

Technical signal: {technicalSignal}
Fundamental signal: {fundamentalSignal}

\`tailRisks\` — list of specific downside risks (e.g. "earnings miss", "regulatory overhang", "liquidity gap at support"). Empty array if none identified.

\`overallRisk\` — aggregate risk level based on the signals:

- "low": signals are clean, no significant tail risks
- "medium": some uncertainty or one notable risk
- "high": multiple tail risks or a single severe one (e.g. high contradictionRisk + weak earnings)
- null only if both signals are entirely absent

No trade recommendation. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const SELECTOR_WORKERS_CATALYST_EXTRACTOR_PROMPT = `# Catalyst extractor

Validate one candidate's near-term catalyst using web search or fetched pages.

## Required Process

1. Call at least one of \`search_web\` or \`fetch_url\` for the candidate.
2. If every tool returns an error, return a low score and include the exact tool errors in \`rationale\`.
3. Do not infer catalysts or news from memory.
4. Do not submit your result until at least one evidence tool has been called.

If no fresh catalyst is found, use a low score and explain briefly. When finished, call the \`submit_result\` tool with the validated candidate; its schema defines every field.`;

export const SELECTOR_WORKERS_EVENT_PREDICTION_SCOUT_PROMPT = `# Event prediction scout

Surface trending prediction-market contracts where price action diverges from headline probability.

Favor contracts with measurable edge vs stated market odds (instrumentClass \`prediction_market\`). When finished, call the \`submit_result\` tool with your candidates; its schema defines every field.`;

export const SELECTOR_WORKERS_EVENT_WEB_SCOUT_PROMPT = `# Event web scout

Find up to 3 prediction-market or event-contract candidates with mispriced implied probability.

Prioritize contracts with clear resolution dates, liquid order books, and fresh news flow. Only include symbols backed by current web evidence (instrumentClass \`prediction_market\`). When finished, call the \`submit_result\` tool with your candidates; its schema defines every field.`;

export const SELECTOR_WORKERS_LIQUIDITY_GATE_PROMPT = `# Liquidity gate

Check whether one candidate is liquid and tradable enough for the session.

## Required Process

1. Call \`get_quote\` for the candidate symbol and instrument class.
2. If the tool returns an error, return low scores and include the exact tool error in \`rationale\`.
3. Do not infer spreads, volume, or liquidity from memory.
4. Do not submit your result until \`get_quote\` has been called.

Use low scores for wide spreads, weak volume, or poor execution quality. When finished, call the \`submit_result\` tool with the validated candidate; its schema defines every field.`;

export const SELECTOR_WORKERS_MARKET_VALIDATOR_PROMPT = `# Market validator

Validate one candidate using quote and OHLCV data.

## Required Process

1. Call \`get_quote\` for the candidate symbol and instrument class.
2. Call \`get_ohlcv\` for the same candidate.
3. If either tool returns an error, return low scores and include the exact tool error in \`rationale\`.
4. Do not infer quote, volume, or liquidity from memory.
5. Do not submit your result until both required tools have been called.

Use low scores when the candidate is thin, stale, or weakly confirmed. When finished, call the \`submit_result\` tool with the validated candidate; its schema defines every field.`;

export const SELECTOR_WORKERS_TREND_SCOUT_PROMPT = `# Trend scout

Find up to 3 concrete trade candidates from trending sources that fit the session instructions.

## Required Process

1. If the session instructions are focused on stocks, call \`get_trending_symbols\` to discover current trending symbols.
2. If the session instructions focus crypto, futures, or prediction markets, skip stock-only trend feeds and use \`search_web\` for class-appropriate discovery instead.
3. Optionally call \`search_web\` for additional context on promising symbols.
4. Do not invent symbols without tool-backed evidence.
5. Do not submit your result until you have called at least one discovery tool that matches the focused instrument class.

Only include symbols with concrete current evidence. When finished, call the \`submit_result\` tool with your candidates; its schema defines every field.`;

export const SELECTOR_WORKERS_WEB_SCOUT_PROMPT = `# Web scout

Find up to 3 concrete trade candidates that fit the session instructions.

## Required Process

1. Call \`search_web\` with queries derived from the session instructions.
2. When a result URL supports a candidate, call \`fetch_url\` on that URL before citing it.
3. Do not invent symbols without tool-backed evidence.
4. Do not submit your result until \`search_web\` has been called.

Only include symbols with concrete current evidence. When finished, call the \`submit_result\` tool with your candidates; its schema defines every field.`;

export const TECHNICAL_WORKERS_CHART_PATTERN_PROMPT = `# Chart pattern

Given OHLCV bars for {instrumentSymbol}, identify the dominant price pattern and key support/resistance levels.

\`patternName\` — standard pattern name (e.g. "bull flag", "ascending triangle", "double bottom") or null if no clear pattern.
\`patternStrength\` — confidence that the pattern is well-formed (0 = ambiguous, 1 = textbook).
\`nearestSupport\` and \`nearestResistance\` — price levels from visible structure, or null if indeterminate.

No trade decision. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const TECHNICAL_WORKERS_EVENT_IMPLIED_PROBABILITY_PROMPT = `# Implied probability

Estimate whether market-implied probability looks rich or cheap vs recent price path.

Focus on contract mid-price vs historical range; no trade instructions. Capture qualitative findings in \`rawSummary\`. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const TECHNICAL_WORKERS_EVENT_LIQUIDITY_PROMPT = `# Event liquidity

Assess spread, depth proxy, and volume quality for the contract.

Flag illiquid books in \`rawSummary\`. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const TECHNICAL_WORKERS_EVENT_PRICE_DRIFT_PROMPT = `# Price drift

Score short-horizon drift and volatility for an event contract.

Use OHLCV and quote only; no sizing or execution guidance. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const TECHNICAL_WORKERS_MOMENTUM_INDICATOR_PROMPT = `# Momentum indicator

Given OHLCV bars and a current quote for {instrumentSymbol}, assess directional momentum.

\`trendStrength\` — how sustained and consistent the direction is across recent bars.
\`momentumScore\` — combined RSI/MACD-style signal strength (0 = extreme/exhausted, 1 = strong continuation).

No trade decision. When finished, call the \`submit_result\` tool; its schema defines every field.`;

export const TECHNICAL_WORKERS_VOLUME_PROFILE_PROMPT = `# Volume profile

Given OHLCV bars for {instrumentSymbol}, assess volume behavior relative to recent history.

\`volumeScore\` — relative volume strength (0 = well below average, 1 = strong surge above average).
\`volumeSignal\` — accumulation (rising volume on up days), distribution (rising volume on down days), neutral, or null if inconclusive.

No trade decision. When finished, call the \`submit_result\` tool; its schema defines every field.`;
