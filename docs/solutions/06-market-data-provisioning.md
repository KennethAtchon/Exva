# Solution 06 - Market Data Provisioning and Universe Depth

> **Outcome:** Every scheduled instrument has enough stored history to satisfy its strategy's declared
> minimum before the first scan runs, and "not enough opportunity" becomes a measured number instead of
> a guess.
> **Relationship to Solution 02:** Solution 02 fixes **recency** (the newest bar is current). This
> document fixes **depth** (enough bars exist at all) and **breadth** (enough instruments exist to make
> firing plausible). Both are required; neither substitutes for the other.

Implements: docs/engineering/CODING_GUIDELINES.md

## Why This Is a Separate Problem

The freshness defect and the depth defect look identical in the logs — both end in `no_setup` — but
they have different causes and different fixes.

| Defect               | Cause                                                              | Symptom                                | Fixed by |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------- | -------- |
| Stale cache          | `getBars()` returns on row count without checking newest timestamp | Same `barWindowHash` repeats for hours | Sol. 02  |
| Insufficient depth   | Nothing ever provisions history for a scheduled instrument         | `barsActual: 1`, `barsRequired: 0`     | This doc |
| Insufficient breadth | Universe is a handful of symbols                                   | Low absolute evaluation count          | This doc |

Observed store depth on July 27:

| Symbol  | Timeframe | Rows | Declared `requiredBarCount` for its strategy |
| ------- | --------- | ---: | -------------------------------------------- |
| SPY     | 1h        |  858 | 50                                           |
| QQQ     | 1h        |   21 | 50                                           |
| BTC-USD | 4h        |   22 | 50                                           |
| AAPL    | 1d        |    1 | 0 (`options-flow`)                           |
| NVDA    | 1d        |    1 | 0 (`options-flow`)                           |

Two of the three tradeable rules instruments were below their own declared minimum for the entire run.

## Verified Current Behavior

1. `strategy-definition-registry.ts:16` declares `requiredBarCount`. Outside the definition files and
   two tests, **no production code reads it.** The field is documentation, not a contract.
2. `scheduled-strategy-executor.ts:218` requests `strategy.warmupBars + 1` and reports
   `barsRequired = strategy.warmupBars`. It never consults `requiredBarCount` and never asks for
   context beyond the bare evaluator minimum.
3. `HistoricalBackfillService` exists and works: it chunks by UTC month, calls
   `adapter.getOhlcvRange()`, and idempotently upserts through `MarketDataService.writeBars()`. Its own
   doc comment states coverage is "an operator readout, not a resumability cursor."
4. Backfill is only reachable from the Lab UI and `scripts/backfill-bars.ts`, which takes exactly one
   symbol and one timeframe per invocation and requires an awkward Electron-ABI command line.
5. **Nothing invokes backfill on behalf of a live session.** A scheduled subscription can go live
   against an empty store, and the first scan simply reports `no_setup`.

The consequence: history depth is a manual operator chore that nobody performed for QQQ, AAPL, or
NVDA, and the system had no way to say so.

## Workstream 1: Make the Bar Contract Real

Replace the three unrelated bar concepts with one explicit contract.

```ts
export interface InstrumentHistoryContract {
  /** Minimum bars below which the strategy cannot be evaluated at all. */
  minEvaluableBars: number; // from requiredBarCount
  /** Bars the strategy wants for stable statistics; provisioned, not required. */
  preferredContextBars: number;
  /** Internal evaluator warmup; never a provisioning target. */
  warmupBars: number;
}
```

Rules:

- `minEvaluableBars` comes from `requiredBarCount` and becomes a hard gate.
- `preferredContextBars` defaults to `max(minEvaluableBars * 4, 250)`.
- The executor requests `preferredContextBars`, not `warmupBars + 1`.
- Registry validation fails at startup when `requiredBarCount < warmupBars`. The July 27 configuration
  (`requiredBarCount: 50`, evaluated on 21 bars) must become impossible to express.

When stored depth is below `minEvaluableBars`, the outcome is `input_insufficient_history` with the
actual and required counts — never `no_setup`. A strategy that could not run did not decline to trade.

## Workstream 2: Provision History Before the First Scan

Add `HistoryProvisioningService` between subscription activation and the first scheduled evaluation.

```ts
ensure(input: {
  symbol: string;
  instrumentClass: InstrumentClass;
  timeframe: TradingTimeframe;
  contract: InstrumentHistoryContract;
  brokerAccountId: string;
}): Promise<HistoryProvisionResult>
```

Behavior:

1. Read `data_coverage` and the actual row count for the symbol/timeframe pair.
2. Compute the calendar-aware window needed to reach `preferredContextBars` back from the latest
   expected closed bar.
3. Diff against stored coverage to produce the missing intervals.
4. Call `HistoricalBackfillService` for the missing intervals only.
5. Re-verify depth and emit a typed result.

```ts
type HistoryProvisionResult =
  | {
      kind: "satisfied";
      storedBars: number;
      oldestTs: string;
      newestTs: string;
    }
  | {
      kind: "partial";
      storedBars: number;
      minEvaluableBars: number;
      reason: string;
    }
  | { kind: "unavailable"; reason: string; provider: string };
```

Invocation points: session start, session resume (through the shared `prepareForActivation()` from
Solution 02 Workstream 8), and instrument-set membership change.

Guards:

- Provisioning is rate-limited per provider and never runs concurrently for one symbol/timeframe.
- A `partial` or `unavailable` result blocks the subscription from being reported as healthy and
  surfaces on the session card as `BLOCKED: INSUFFICIENT_HISTORY`, with the symbol and counts.
- Provisioning never blocks the whole session when one of several symbols fails; the failing symbol is
  excluded and named.

## Workstream 3: Universe Breadth

Breadth is a configuration decision, not a code fix, but the system must make it an informed one.

Current default scheduled universe: `SPY`, `QQQ` (mean reversion), `BTC-USD` (breakout), `AAPL`,
`NVDA` (unreachable options producer). Three instruments actually evaluable.

**Decided target (O6):** the rules liquid-equity instrument set holds **20–25** symbols once depth is
provisioned and the setup rate on the current three-instrument universe is measured. That size is the
minimum intended to move daily expected setups out of the ~0.3 regime diagnosed on 2026-07-27.

Requirements:

1. Instrument sets declare the strategy classes they are valid for; class mismatches are rejected at
   configuration time rather than producing silent zero-evaluation lanes.
2. The liquid-equity set expands to a documented, liquidity-screened list of **20–25** names once
   Solutions 01 and 02 are green — not before, because more symbols against stale data only multiplies
   the same defect.
3. Every added symbol must pass the same tradability screen the EDGAR path uses (listed venue, price
   floor, dollar-volume floor) so the universe cannot silently acquire untradeable names.

Do not expand the universe as a way to force trades. Expand it after Workstream 4 quantifies what the
current universe can produce, then widen to the 20–25 target in one documented set revision.

## Workstream 4: Measure the Opportunity Rate

The July 27 run could not answer "how many chances did this strategy actually get?" That question must
be answerable from persisted data, not estimated from one backtest.

Persist per scheduled evaluation:

```text
symbol, timeframe, evaluatedAt, barWindowHash, storedBars,
minEvaluableBars, outcome (setup | no_setup | insufficient_history | stale | error)
```

Derived metrics per session per day:

| Metric                  | Definition                                                  |
| ----------------------- | ----------------------------------------------------------- |
| Eligible evaluations    | Evaluations on a **unique** `barWindowHash`                 |
| Repeat evaluations      | Evaluations on an already-seen hash (should be ~0 after 02) |
| Setup rate              | Setups ÷ eligible evaluations                               |
| Blocked-by-history rate | `insufficient_history` ÷ total evaluations                  |
| Expected setups per day | Setup rate × eligible evaluations per day                   |

This replaces the discarded Poisson extrapolation with a measured rate. It also gives the honest
answer to "why did nothing trade today": either the setup rate is genuinely low (a strategy question)
or the eligible-evaluation count is low (a provisioning question). Those need opposite responses.

## Workstream 5: Backfill Ergonomics

Add a universe-level entry point so provisioning is one command, not one command per symbol.

```bash
bun run backfill -- --set liquid-us-etfs --timeframe 1h --lookback 2y
bun run backfill -- --session ETF-REVERSION-PRIMARY   # resolves every member and contract
bun run backfill -- --audit                            # report only, writes nothing
```

The command resolves instrument-set members and their strategy contracts, plans missing intervals from
coverage, and reports per-symbol results. It reuses `HistoricalBackfillService` — no second
implementation. Document the Electron-ABI invocation requirement in the script header and in
`docs/engineering/`.

## Tests

### Unit

- `requiredBarCount < warmupBars` fails registry validation.
- Depth below `minEvaluableBars` yields `input_insufficient_history`, never `no_setup`.
- Interval planning against partial coverage requests only the missing ranges.
- Calendar-aware lookback for 1h NYSE, 4h crypto, and 1d equity produce different windows.
- Provisioning is idempotent: a second `ensure()` with satisfied coverage issues no provider call.

### Composition

Start a session whose instrument set has an empty store, with only the provider HTTP faked. Assert:
provisioning runs, bars are written, the first scheduled scan evaluates against
`>= minEvaluableBars`, and the outcome is a real `setup`/`no_setup` rather than a history block.

### Product

`bun run backfill -- --session <name>` followed by a Lab run on the same symbols shows no data-quality
gaps for the requested window.

## Acceptance Criteria

- [ ] `requiredBarCount` is read by the executor and enforced as a hard minimum.
- [ ] No scheduled evaluation runs against fewer bars than the strategy declares.
- [ ] A session with an empty store provisions history before its first scan, or reports a named block.
- [ ] `insufficient_history` and `no_setup` are distinct, separately counted outcomes.
- [ ] Every scheduled instrument in the default matrix stores at least `preferredContextBars`.
- [ ] Setup rate and eligible-evaluation count are queryable per session per day.
- [ ] One command provisions an entire instrument set.
- [ ] Universe expansion is gated on the measured setup rate, not on impatience.
- [ ] Rules liquid-equity set is widened to 20–25 liquidity-screened symbols after that gate.
