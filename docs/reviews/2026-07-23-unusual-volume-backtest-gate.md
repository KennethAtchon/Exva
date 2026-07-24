# Unusual-Volume Backtest Gate

**Date:** 2026-07-23
**Status:** Blocked. The `rules-unusual-volume` experience was not registered.

Implements: `docs/engineering/CODING_GUIDELINES.md`

## Required Gate

The launch plan requires six months of 15m and 1h OHLCV for SPY, QQQ, AAPL, and NVDA, then an out-of-sample sweep of `rvolThreshold` and price-break parameters against the experience research contract.

## Observed Data

The local runtime DB has no 15m bars for the required symbols. It has only 21 1h bars for SPY and QQQ (July 20-23, 2026), no 1h bars for AAPL or NVDA, and one 1d bar each for AAPL and NVDA. This cannot produce a valid six-month walk-forward result.

## Promotion Constraint

`BacktestLabService` persists a replay `runHash`, while `ResearchExperimentService.attemptPromotion()` requires the hash of the research contract plus persisted labeled observations. A Lab sweep alone therefore cannot satisfy the current promotion gate.

## Outcome

Historical ranged backfill is available through the Backtest Lab and `scripts/backfill-bars.ts`. Do not create the experience, pipeline, or catalog profile until the required data has been backfilled and replay out-of-sample metrics are reconciled with the promotion evidence model.
