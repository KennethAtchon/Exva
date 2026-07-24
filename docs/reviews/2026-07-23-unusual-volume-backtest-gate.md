# Unusual-Volume Backtest Gate

**Date:** 2026-07-23
**Status:** Failed. The `rules-unusual-volume` experience was not registered.

Implements: `docs/engineering/CODING_GUIDELINES.md`

## Required Gate

The launch plan requires six months of 15m and 1h OHLCV for SPY, QQQ, AAPL, and NVDA, then an out-of-sample sweep of `rvolThreshold` and price-break parameters against the experience research contract.

## Observed Data (after backfill)

Backfilled via `scripts/backfill-bars.ts` (Electron Node ABI) for `2026-01-23` → `2026-07-23`:

| Symbol | 15m bars | 1h bars |
| --- | ---: | ---: |
| SPY | 3912 | 1085 |
| QQQ | 4172 | 1115 |
| AAPL | 3609 | 1005 |
| NVDA | 3773 | 1071 |

## Sweep

Script: `scripts/unusual-volume-gate.ts`  
Universe: SPY/QQQ/AAPL/NVDA · folds: 3 · costs: 1/2/0 bps · exit: 2% stop / 20-bar max hold  
Grid: `rvolThreshold ∈ {2.0, 2.5, 3.0, 3.5}` × `priceBreakPct ∈ {0.003, 0.005, 0.01}` × `{15m, 1h}` → **24 trials**.

Candidate thresholds (stock parity with mean-reversion):

- `minOutOfSampleTrades ≥ 100`
- `expectancyBps > 0`
- `sharpe > 0`
- `maxDrawdownPct ≤ 20` (replay engine units are percent points)
- ≥3 folds with positive expectancy

## Results

**0 / 24 trials passed.**

Best trial (still fail):

| Field | Value |
| --- | --- |
| timeframe | `1h` |
| params | `rvolThreshold=2`, `priceBreakPct=0.01`, `baselineBars=20` |
| trades | **6** |
| expectancyBps | +137.88 |
| sharpe | +0.466 |
| maxDrawdownPct | 3.02 |
| foldsPositive | 3/3 |
| failed | `minOutOfSampleTrades` |

Across the grid, trade counts stayed in the single digits to low teens. Positive expectancy appeared on several 1h cells, but sample size never approached the contract floor. 15m cells were generally worse on expectancy.

## Promotion Constraint

`BacktestLabService` persists a replay `runHash`, while `ResearchExperimentService.attemptPromotion()` requires the hash of the research contract plus persisted labeled observations. A Lab sweep alone therefore cannot satisfy the current promotion gate. This run judged Lab walk-forward metrics directly against the candidate contract thresholds — the sample-size failure is decisive either way.

## Outcome

Do **not** create the experience, pipeline, or catalog profile. Re-open only after either:

1. a longer / denser universe produces ≥100 OOS trades under a passing param cell, or
2. an explicit contract change lowers `minOutOfSampleTrades` with a written rationale.

Reproduce:

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
  ./node_modules/vite-node/vite-node.mjs --config vitest.config.ts \
  scripts/unusual-volume-gate.ts
```
