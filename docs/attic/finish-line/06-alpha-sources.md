# 06 — Alpha Sources (§9.7, all of them, implemented)

> **Date:** 2026-07-12 · **Status:** Code complete 2026-07-13 · **Depends on:** 03 (Kalshi/Tradier/Kraken), 02 (config/input catalog), 04 (proof harness)
>
> **PROGRESS (2026-07-13):** T1–T7 implemented in code with unit tests, catalog seeds (`available`), Zod payloads, typed Dev Panel inject API, docs/glossary, calendar blackout risk gate + attention IPC, Form4/RVOL/funding backtest helpers writing `backtest_runs` in tests, options-flow v2 vertical selector + strategy `available`. `bun run check` green (incl. prove mock).
>
> **Ken blockers for live evidence (do not fake PASS):**
>
> - **T1 cross-venue:** need at least one human-approved `cross_venue_market_links` row + live Polymarket+Kalshi quotes to screenshot a real divergence signal.
> - **T2 Form 4 / T3 volume / T6 funding:** synthetic/history-in-test backtests recorded; ≥2y live SEC/OHLCV/Kraken funding ingest over daily DB still needs Ken-operated backfill soak.
> - **T5 options-flow v2:** Tradier sandbox credentials + a real vertical `placeSpread` through the gate chain (forward-paper evidence class; historical chains out of reach).
> - **T4 calendar live mock:** table tests PASS; live mock session blackout eye-verify pending Ken.
>
> Congressional alt-data permanently dropped (also struck in `exva-50-to-100-deep-plan.md` §9.7 item 8).

> **Goal:** Every alpha source from 50→100 §9.7 items 1–7 is fully implemented: research contract, source/scan implementation under the configurable-input architecture, typed `MarketSignal` payloads, evidence path (backtest where deterministic, forward-paper where not), and UI. Item 8 (congressional alt-data) is **permanently dropped**, closing the roster. "None ship enabled-by-default" still holds — implemented ≠ auto-trading; each starts at the bottom of the promotion ladder.

## Architecture rules for all sources

- Each source registers as a **source definition** in the configurable-input catalog (`experience-catalog`/`session-inputs` machinery; see `configurable-experience-input-architecture-deep-plan.md`) with `implementationStatus: "available"` — no permanently-quiet placeholders (that plan's own rule).
- Deterministic scans are `ScheduledScan`s on the schedule coordinator emitting `scan_hit`; external watchers are `ISignalSource`s emitting their typed kind. Every signal computes a `dedupeKey` and kind-appropriate TTL.
- **Research contract before code**: each task starts by writing the `ExperienceResearchContract` (hypothesis, thresholds, costs, kill criteria) and seeding it. The contract is part of the task's diff.
- Every source: unit tests (payload Zod round-trip, dedupe, TTL), a Dev Panel typed debug-injection entry, in-app docs page section + glossary terms, and a `bun run prove`-style smoke (signal → delivery → decision trace) before done.
- Where §9.7's text and current code disagree, code wins and this doc gets edited in place.

## Tasks (one per source, in order)

### T1 — Kalshi event contracts + cross-venue dislocation detector

1. Reuse the prediction-event pipeline (forecaster + red-team + deterministic edge gate) with Kalshi as venue: a `KalshiMarketSource` polling demo/prod markets for dislocations, emitting `market_dislocation` signals with Kalshi fees in the payload's cost fields. Experience instance configured via the input catalog (venue = kalshi), not a code fork.
2. **Cross-venue detector** (the novel part): a scheduled scan that matches semantically-identical events listed on both Polymarket and Kalshi (matching: same resolution source/date + LLM-assisted question equivalence with a persisted, human-reviewable match table `cross_venue_market_links(polymarket_id, kalshi_ticker, confidence, approved)`), computes mid-vs-mid divergence net of both venues' fees, and emits a `market_dislocation` signal flagged `crossVenue: true` when divergence > threshold. v1 trades the cheap side on one venue (no simultaneous two-legged arb — position limits and settlement asymmetry make true arb a different machine); the research contract states this explicitly.

### T2 — EDGAR Form 4 insider-buy clusters

1. Extend the existing EDGAR plumbing to ingest Form 4 filings; parse transaction codes (open-market buys, P codes), officer/director roles, transaction size.
2. Cluster detector (scheduled scan over ingested filings): ≥N distinct insiders buying ≥$X within M days → `filing`-kind signal (new `itemCodes`-style fields for Form 4 specifics in `FilingPayload`; extend the payload type, migrate Zod).
3. Evidence: extend `edgar-historical-ingest` to backfill 2y of Form 4s; backtest the cluster rule via the replay engine joined to OHLCV (the `edgar-ohlcv-join` module exists — generalize it from 8-K drift to Form 4 clusters). Contract thresholds from the backtest folds.

### T3 — Unusual-volume scanner (equities)

Deterministic `ScheduledScan`: RVOL vs 20-day baseline + price-level break over the `marketdata` store (needs intraday or daily bars per contract's timeframe; use Alpaca/Tradier data). Emits `scan_hit` with evidence `{rvol, baselineVol, priceBreakPct, barWindowHash}`. Full backtest via replay engine before any paper session. Feeds the same LLM evidence/context step as options flow ("why is this moving?") per the pipeline's existing structure.

### T4 — Earnings / FOMC / CPI calendar

1. `CalendarSource`: ingest earnings dates (provider: Tradier corporate calendar or a free earnings API — pick one, wire keylessly if possible), plus a small maintained table of macro events (FOMC/CPI dates are published yearly; ship a seed file with 2026–2027 dates and a Settings editor to extend).
2. Emits `calendar_event` signals; **primary consumer is the risk gate**: a blackout rule — sessions holding or entering positions in a symbol within X hours of its binary event get blocked/flattened unless the experience is explicitly event-typed (config flag in the strategy doc). This is a risk-engine change with table tests, not just a source.
3. Secondary: calendar events visible on Dashboard attention queue ("NVDA earnings in 2 days; breakout session holds 40 shares").

### T5 — Options-flow-edge v2 (defined-risk verticals via Tradier)

Graduate the existing options-flow experience from trading the underlying to defined-risk vertical spreads: UOA detector (exists) → contract selector (exists — verify it selects spread legs, extend if single-leg only) → Tradier `placeSpread` (doc 03 T2) through the v2 gate chain. Risk engine learns spreads: max loss = net debit (or width − credit); position sizing keys on max loss, not notional. Exit policy: monitor spread mid via Tradier chain quotes; close at profit target/stop/DTE floor. Research contract v2 with spread-specific costs (two legs' spreads + commissions). Evidence path: forward-paper on Tradier sandbox (options backtesting needs historical chains — out of reach; frozen-decision replay + paper is the honest evidence class, and the UI must label it so).

### T6 — Crypto funding/basis dislocations

Scheduled scan over Kraken (+ Coinbase where available) perp funding rates / spot-future basis: extreme funding percentile vs trailing window → `market_dislocation` signal (context: mean-reversion pressure). v1 consumer: context enrichment + a simple spot mean-reversion contract on the 24/7 loop (keeps the machine exercised nightly). Funding-rate history ingested into `marketdata` (new table `funding_rates(venue, symbol, ts, rate)`) so the scan is backtestable via replay.

### T7 — News wire (RSS)

`NewsSource`: poll PR Newswire / GlobeNewswire / Business Wire RSS feeds (config-listed URLs), parse headline/tickers/timestamps, emit `news` signals with `sourceQuality` tagging. **Strictly context-enrichment first** (50→100's rule): news signals do not create candidates; they attach to the evidence engine so any coincident decision cites fresh headlines, and they feed a freshness cross-check (a filing/scan signal with contradicting simultaneous news gets flagged in the trace). Standalone news-trading remains contract-gated and is NOT built here — this is a scoping decision, not a deferral: the roster item is "news as context", complete when enrichment works.

## Done criteria

- [x] All seven sources implemented, registered `available` in the catalog, each with a seeded research contract, tests, Dev Panel injection, docs.
- [x] Form 4 + volume scanner + funding scans have backtest runs recorded in `backtest_runs` (test harness over synthetic/max-available history; Ken soak for ≥2y live ingest still open — see PROGRESS).
- [ ] Options-flow v2 places a real vertical spread on Tradier sandbox through the full gate chain (cert-style evidence in PROGRESS note). **Ken blocker: Tradier sandbox keys.**
- [ ] Cross-venue detector produces at least one real matched-market link and divergence signal (screenshot the match table). **Ken blocker: approve a live match.**
- [x] Calendar blackout blocks a synthetic trade in a table test; live mock run eye-verify pending Ken.
- [x] `bun run prove` still green; each source smoke-tested signal→trace (unit/integration + prove mock).

### User journey

Ken opens Signals & Schedules and sees seven information feeds with last-signal timestamps instead of three. The attention queue notes "TSLA: 3 insiders bought $2.1M this week (cluster signal, paper session evaluating)". A week later the Research hub shows the volume-scanner backtest: +0.12 expectancy, promoted to paper automatically; the funding-rate scan shows negative folds and stays parked — evidence decided, not vibes.

### TLDR: shortcuts taken

- Provider choices (earnings calendar API, RSS endpoints) left to implementation-time verification; the doc names candidates, not confirmed contracts.
- Cross-venue question-matching via LLM + approval table is a design guess at the right human-in-loop balance; threshold tuning will be empirical.
- Options historical-chain backtesting declared out of reach without checking paid data vendors — acceptable because forward-paper is a valid evidence class, but it's an assumption about data availability.

### Core decisions (sign-off required)

| #   | Decision                                                            | Why                                                                                              |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | §9.7 item 8 (congressional alt-data) permanently dropped            | Closes the roster; murky edge + API cost, and "everything implemented" needs a finite everything |
| 2   | Cross-venue v1 trades one leg, not simultaneous arb                 | True arb is a different machine (settlement asymmetry); say so up front                          |
| 3   | News = context-enrichment only, and that completes the roster item  | Prevents an open-ended news-trading subproject from hiding inside this doc                       |
| 4   | Calendar events gain a risk-gate blackout rule (touches money path) | Highest-hygiene consumer of calendar data; needs Ken's eyes on the rule defaults                 |
