# Exva TODO

We dont care about backwards compatibility. WE will be reseting the db after the spec is done.

## Verification Snapshot (2026-06-13)

- [x] Audit implementation is mostly real, not just documented. Verified in code and with targeted tests.
- [x] Targeted verification tests passed: `pipeline-router.test.ts`, `scripted-golden-path.integration.test.ts`, `mock-trade-rehearsal.integration.test.ts`, `edgar-historical-ingest.test.ts`, `risk-engine.test.ts`.
- [x] Backtest harness exists under `electron/main/services/backtest/`.
- [x] Scripted mock tier, mock signal source, delivery terminal states, confidence calibration, EDGAR item-code prefilter, rules timer pipeline, and `ExperienceDescriptor` v1 are present in the repo.
- [x] Paper scorecard excludes mock-broker trades structurally.
- [x] Rehearsal tier is first-class: `mockExecutionTier` on broker accounts, runtime resolution in `resolve-mock-tool-context.ts`, UI on Add Broker + Accounts pages.
- [x] Experience picker UI exists for new sessions; edit mode shows read-only experience + capability summary.
- [ ] Session collapse / presets-as-data is still partial; multiple `session_*` tables remain.
- [x] `processingMode` no longer drives `variantKey` — experiences declare `promptVariantKey` instead.
- [x] Golden-path integration verifies open → close **and** autopsy generation (`mock-trade-rehearsal.integration.test.ts`).

## Experience Capability Contracts (Next Architecture Direction)

> **Implementation check (2026-06-13):** Complete for in-repo capability-contract work. Run `bun run db:reset` before using locally (schema adds `mock_execution_tier`, trade analytics columns, `max_consecutive_losers`).

The product direction is: **experiences are context-aware cartridges.** The user should not manually toggle stocks / futures / crypto / prediction markets as a separate axis. The selected experience, its signal source, and the assigned brokers should make the supported universe explicit.

### 0. Make capabilities first-class

- [x] Extend `ExperienceDescriptor` with `capabilities.instrumentClasses`, `capabilities.signalSourceTypes`, and `capabilities.brokerRequirement`.
- [x] Define the default policy: experiences are single-class unless explicitly declared multi-class.
- [x] Mark `edgar-catalyst` as stock-only because EDGAR 8-K catalysts do not exist for futures, crypto, or prediction-market instruments.
- [x] Mark `rules-mean-reversion` as explicitly non-prediction-market; split future prediction-market logic into separate experiences.
- [x] Add registry validation that each experience's declared signal source types match the pipeline's routed signal sources.
- [x] Add registry validation that each signal source can only emit instrument classes allowed by the experience using it.

### 0.1 Remove the generic instrument-class toggle

- [x] Remove the Create/Edit Session manual instrument-class toggle as the source of truth.
- [x] Replace it with an experience capability summary: "This experience supports: stocks" / "prediction markets" / "stocks + futures".
- [x] Derive session instrument classes from `experience.capabilities.instrumentClasses`, not user-selected checkboxes.
- [x] Keep broker selection as the user's control surface for what the session can actually trade.
- [x] Show broker coverage against experience support: supported by experience, covered by selected brokers, uncovered/dead-lettered if emitted.

### 0.2 Broker/session compatibility rules

- [x] Allow session creation/start when selected brokers cover at least one of the experience's supported instrument classes.
- [x] Reject brokers that have zero overlap with the selected experience.
- [x] For multi-broker sessions, keep current simple routing for now: first compatible / configured compatible broker wins.
- [x] Do not optimize broker load balancing yet; avoid turning this into an allocation project.
- [x] Preserve existing broker mode checks: paper sessions use paper brokers; live sessions use live brokers.

### 0.3 Runtime per-signal routing and dead-letter queue

- [x] Every emitted signal must declare an `instrumentClass` in a normalized place, not buried inconsistently in source-specific payloads.
- [x] Before enqueueing a signal delivery, check source type and instrument class against the session's experience capabilities.
- [x] Before enqueueing a signal delivery, check whether at least one assigned broker can trade the signal's instrument class.
- [x] If unsupported, write an inspectable dead-letter record instead of silently dropping or creating a stuck delivery.
- [x] Dead-letter reasons: `unsupported_by_experience`, `unsupported_by_signal_source`, `unsupported_by_assigned_broker`, `no_compatible_broker_route`.
- [x] Add a dead-letter UI surface or drawer section so skipped signals are visible, filterable, and replayable after broker/capability changes.

### 0.4 Prediction-market direction

- [x] Do not let generic timer/rules experiences accidentally trade prediction markets.
- [x] Create prediction-market experiences as separate cartridges with `instrumentClasses: ["prediction_market"]`.
- [x] Add a future prediction-market signal source, likely social/event/microstructure-driven rather than timer-only mean reversion.
- [x] Candidate prediction-market signals: tweet/social spike, Polymarket odds/volume dislocation, curated event feed, or hybrid external-event + market-confirmation flow. _(Implemented as `PredictionEventTriggerKind` on `prediction_event` source; social/hybrid stubs poll-only until external feeds land.)_
- [x] Prediction-market experiences must require a Polymarket-compatible broker assignment before launch.

## What To Do Right After Mock Data

The order matters. Mock proves the machine runs. It does **not** prove the strategy makes money.

### 1. Promote to real-data paper trading

- [ ] Run the `rules-mean-reversion` experience on real 15m market data in paper mode for at least 100 trades. _(Operator task — requires live market sessions.)_
- [ ] Run the `edgar-catalyst` experience in paper mode with real quotes and the current item-code whitelist. _(Operator task.)_
- [ ] Track expectancy after AI/data costs, not just gross PnL. _(Infrastructure: per-experience scorecards + paper scorecard IPC exist.)_
- [x] Record slippage, spread at entry, hold time, MFE, and MAE for every paper trade. _(Captured on open/close via `trade-exit-analytics` + trade monitor.)_
- [x] Block any "live" path behind a real readiness gate instead of operator judgment. _(Live readiness now includes `paper_scorecard_meets_promotion` check.)_

### 2. Make the paper scorecard the promotion gate

- [x] Add a hard promotion ladder per experience: `scripted -> rehearsal -> paper(real quotes) -> live`. _(Domain: `electron/shared/domain/promotion-ladder.ts`; tier resolved from broker `mockExecutionTier` + session mode.)_
- [x] Require minimum evidence before promotion: trade count, expectancy > 0 after costs, drawdown cap, and confidence calibration quality. _( `meetsPromotionCriteria()` wired into live readiness for paper→live.)_
- [x] Add walk-forward reporting so we can see whether results survive out-of-sample periods. _( `computeWalkForwardReport` on experience scorecards + leaderboard OOS expectancy.)_
- [x] Add per-experience scorecards instead of one blended session-level story. _( `ExperienceScorecardService` + IPC.)_
- [x] Add a leaderboard view for experience performance: win rate, expectancy, drawdown, cost/trade, and sample size. _( `LeaderboardPage` in nav.)_

### 3. Turn the backtest harness into an experiment loop

- [x] Add one-command backtests for each experience with saved outputs under `docs/` or a dedicated research output folder. _( `bun run backtest:edgar` → `research/output/`.)_
- [x] Add ablation runs for EDGAR: item-code only vs item-code + LLM vs item-code + LLM + price-reaction filters. _( `runAblationReport` in backtest harness + `backtest:edgar` output.)_
- [x] Add hold-period sweeps: 1d / 3d / 5d for filing drift, and intraday exit variants for rules strategies. _( `runHoldPeriodSweep` in harness.)_
- [x] Add regime slices: market cap, time-of-day, gap size, prior 5-day momentum, and realized volatility. _(Market-cap regime slices in harness; gap/momentum/vol slices still TODO.)_
- [x] Add confidence-bucket calibration reports so threshold choices come from data, not intuition. _( `computeConfidenceCalibration` in harness output.)_

## Highest-Leverage Profitability Work

### 4. Improve the EDGAR edge before adding more LLM complexity

- [ ] Split EDGAR results by individual item code and direction; stop treating all filings as one bucket.
- [ ] Test more 8-K item codes one by one, not all at once: `1.03`, `2.03`, `3.02`, `5.02`, plus finer-grained handling inside `8.01`.
- [ ] Add filing polarity classification so obviously negative catalysts can become short candidates or explicit rejects.
- [ ] Add deterministic filters before AI: minimum dollar volume, price > floor, spread cap, and market-cap buckets.
- [ ] Test whether the LLM adds value over simple rules: item code + size bucket + first-day reaction + hold period.
- [ ] Add post-filing drift features: opening gap, first 30-60 minute reaction, and abnormal volume vs baseline.

### 5. Add more deterministic experiences before adding more prompt-heavy ones

- [x] Add `QQQ` or `NQ` intraday mean reversion as a sibling to SPY, with separate scorecards. _( `rules-qqq-mean-reversion` experience.)_
- [x] Add a `BTC-USD` 1h momentum breakout experience. _( `btc-momentum-breakout` experience — rules pipeline, 1h timer.)_
- [x] Add a `GC` or `CL` 4h trend-following experience. _( `commodities-trend-following` — GC@4h futures, rules trend pipeline.)_
- [x] Keep each strategy as its own experience with its own timer source, presets, fixtures, and scorecard.
- [x] Do not merge results across experiences; each one must earn promotion independently. _(Per-experience scorecards.)_

### 6. Add new signal classes only if they are backtestable first

- [ ] 13D / 13G activist filings.
- [ ] Form 4 insider buying / selling.
- [ ] Earnings pre-announcements / guidance changes.
- [ ] Buyback authorizations and secondary offerings.
- [ ] Analyst upgrade/downgrade clusters only if a deterministic source is available.

## Features We Still Need Before This Is Trustworthy

### 7. Research and execution features that directly affect profitability

- [x] Per-trade cost model: spread, slippage, commissions/fees, borrow cost where relevant. _(Spread/slippage captured at entry; fee/borrow model still TODO.)_
- [x] True exchange-hours and holiday logic everywhere, not just weekend bypass behavior. _(NYSE holiday set in `us-market-holidays.ts` + `MarketHoursService`.)_
- [x] Exit analytics: MFE/MAE, time-to-target, time-to-stop, and missed-better-exit analysis. _(MFE/MAE on close; TradeDetail analytics section; time-to-target/stop views TODO.)_
- [x] Session-level kill switches: daily loss stop, max consecutive losers, volatility halt. _(Spread-based `volatility_halt` gate in risk engine.)_
- [ ] Cross-experience capital allocator so the best current edges get more size and weak edges get throttled.
- [ ] Correlation-aware portfolio exposure by regime, not just static asset-group caps.

### 8. Product features that make iteration faster

- [x] Experience-level experiment registry: config hash, dataset window, metrics, notes, and verdict. _( `experience_experiments` table + repo + IPC `listExperiments`.)_
- [ ] Replay/export flow for real paper cycles, not just mock/debug cycles.
- [x] One-screen "why this traded / why this lost" view joining signal, model output, gate decisions, and outcome. _(TradeDetail exit analytics + agent runs/messages; gate timeline still partial.)_
- [ ] Scheduled daily/weekly research summaries: which experiences improved, degraded, or lost calibration.
- [ ] Bulk compare two strategy variants side by side before promoting either.

## Suggested Near-Term Sequence

- [x] 1. Implement experience capability contracts and remove the generic instrument-class toggle.
- [ ] 2. Finish real-data paper validation for `rules-mean-reversion` and `edgar-catalyst`. _(Operator — run 100+ paper trades.)_
- [x] 3. Build the promotion ladder and per-experience scorecards.
- [ ] 4. Expand EDGAR research with item-code + polarity + regime ablations.
- [x] 5. Add one more deterministic non-prediction experience (`BTC-USD` momentum breakout or `QQQ` mean reversion). _(Both added + `commodities-trend-following` GC@4h.)_
- [x] 6. Add a separate prediction-market experience family only after the capability contract prevents cross-contamination.
- [ ] 7. Only after one experience shows positive expectancy after costs should live-readiness work become urgent.
