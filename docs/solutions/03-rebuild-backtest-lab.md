# Solution 03 - Rebuild the Backtest Lab

> **Outcome:** A saved run answers how much money was made, when and why each trade occurred, what
> assumptions produced it, and whether it satisfies the experience research contract.

Implements: docs/engineering/CODING_GUIDELINES.md

## Current Truth

The current engine calculates trade returns in basis points. It does not simulate capital. It fills
on the same close that produced the signal, appends symbols in symbol order, calculates drawdown from
an additive return counter, persists only aggregate JSON, and labels five positive trades a pass.

The missing chart and P&L are not isolated frontend bugs. The data does not exist after restart, and
dollar P&L cannot be derived without a sizing/cash contract.

## Data Prerequisite

A V2 run is only as good as the bars behind it, and the store currently holds 21 rows for QQQ and one
each for AAPL and NVDA. Provision history first via
[Solution 06 Workstream 5](./06-market-data-provisioning.md) — the universe-level backfill command —
and let the data-quality report below block the run rather than silently backtesting a fortnight.

The two documents share one source of truth: `HistoricalBackfillService` and `data_coverage`. The Lab
must not gain a private backfill path.

## Supported V2 Drivers

| Driver                | Strategies                               | Launch state                                             |
| --------------------- | ---------------------------------------- | -------------------------------------------------------- |
| OHLCV replay          | Mean reversion, breakout, unusual volume | V2 launch scope                                          |
| Futures OHLCV replay  | Trend, NY range                          | Blocked until point-in-time futures data provider exists |
| Event-price join      | EDGAR, Form 4                            | Separate driver after V2 core                            |
| Funding-price join    | Funding basis                            | Separate driver after V2 core                            |
| Venue snapshot replay | Cross-venue                              | Blocked until historical point-in-time quotes exist      |
| Option chain replay   | Options Flow                             | Forward-paper only until historical chains exist         |

Do not expose placeholder strategies as “available.” Strategy metadata includes support state and
required driver.

## V2 Spec

Use `BacktestRunSpecV2` from the master plan. The fully resolved persisted spec includes defaults,
strategy implementation version, timeframe, parameters, symbols/classes, starting capital, sizing,
costs, entry model, end-of-data policy, folds, and data references.

Default execution assumptions:

- starting capital: `$100,000`;
- fixed notional per trade: `$500`;
- entry: next bar open;
- no overlapping same-symbol positions;
- end of data: keep open and mark at last price;
- stop before target when both touch one bar;
- costs: experience research contract values.

The UI exposes and labels all defaults.

## Chronological Portfolio Engine

Merge bars from all symbols by UTC timestamp. At each event:

1. Update marks for existing positions.
2. Fill eligible pending orders under the selected fill model.
3. Apply fills to cash and positions.
4. Evaluate the strategy only on data available at that timestamp.
5. Create orders for the next eligible timestamp.
6. Evaluate stop/target/session-exit rules.
7. Record equity.

Accounting identity at every equity point:

```text
equityUsd = cashUsd + netMarketValueUsd
netPnlUsd = equityUsd - startingCapitalUsd
```

Realized and unrealized P&L are derived from fills and marked positions. Fees reduce cash at fill time.
No separate mutable equity accumulator exists.

## Durable Result Model

Add normalized tables:

| Table                    | Purpose                                                  |
| ------------------------ | -------------------------------------------------------- |
| `backtest_run_specs_v2`  | Immutable resolved spec and hashes                       |
| `backtest_data_inputs`   | Provider, range, row count, cadence report, dataset hash |
| `backtest_orders`        | Submitted/canceled/filled simulated orders               |
| `backtest_fills`         | Every fill, quantity, price, fee, slippage               |
| `backtest_trades_v2`     | Derived position round trips and dollar/BPS results      |
| `backtest_equity_points` | Cash, marks, P&L, equity, drawdown by timestamp          |

Add to `backtest_runs`:

```text
engine_version
spec_hash
dataset_hash
research_contract_hash
```

Null `engine_version` reads as V1. V1 remains inspectable with a legacy warning and cannot be
promoted.

## Hashes

- `specHash`: canonical fully resolved V2 spec.
- `datasetHash`: ordered digest of every input row identity/value plus provider metadata.
- `resultHash`: ordered orders, fills, trades, and terminal equity summary.
- `researchContractHash`: the exact experience promotion contract.

Changing timeframe, parameter, implementation version, cost, sizing, data row, or fill assumption must
change the appropriate hash.

## Data Quality

Replace `failOnGaps` with a report:

```ts
interface BacktestDataQualityReport {
  expectedBars: number;
  actualBars: number;
  missingIntervals: Array<{ start: string; end: string }>;
  duplicateTimestamps: string[];
  outOfOrderCount: number;
  provider: string;
  feed: string | null;
  complete: boolean;
}
```

The run button is disabled when required data is incomplete. Coverage is calculated for every symbol,
not only the first one. Alpaca-only backfill is labeled as such; unsupported classes cannot be inferred
from symbol punctuation.

## Research Contract Evaluation

Delete `verdictFromResult()` as the promotion authority. One shared evaluator applies the experience's
versioned criteria and records each result:

```text
minimum out-of-sample trades
net expectancy after costs
lower confidence bound / selected risk statistic
maximum equity drawdown
required positive folds
data-quality completeness
```

A run can be `completed` while its promotion verdict is `fail` or `inconclusive`. Runtime completion
and research qualification are separate statuses.

## UI Surface

### Spec Pane

- experience -> compatible strategy filter;
- strategy-generated parameter controls;
- class/timeframe validation;
- all-symbol coverage table;
- starting capital and sizing;
- costs and execution model;
- visible unsupported/forward-only status.

### Run Detail

1. Ending equity, net P&L dollars/percent, realized/unrealized P&L, fees, trades, win rate, Sharpe, max drawdown.
2. Equity and drawdown chart.
3. Candlestick chart with signal, entry, partial fill, stop, target, and exit markers.
4. Sortable trade ledger with quantity, notional, gross/net P&L, costs, and evidence.
5. Fold table with selected parameters and OOS window.
6. Data-quality and assumptions panel.
7. Promotion criteria with reason per result.

Use `lightweight-charts` for price/equity series and markers. Raw fills remain authoritative and
queryable even when charts downsample points.

## Tests

### Hand-Calculated Fixtures

- One long next-open entry and close with known fee/slippage.
- One short trade with symmetric accounting.
- Partial fills and weighted average cost.
- Open position at end of data with unrealized P&L.
- Explicit liquidation-at-close policy.
- Stop and target touched in the same bar: stop first.
- Two symbols with interleaved trades and chronological drawdown.

### Contract Tests

- Invalid strategy/class/timeframe rejected before data load.
- Unknown sweep parameter rejected, never stripped silently.
- Hash sensitivity for every input category.
- Research verdict matches exact contract and units.
- V1 run cannot promote.

### Product E2E

1. Backfill all symbols.
2. Run V2.
3. Close/reopen Lab.
4. Open saved result.
5. Verify charts, markers, ledger, assumptions, and verdict.
6. Compare two runs aligned by UTC and common metrics.

## Acceptance Criteria

- [ ] Net P&L dollars reconciles to ending minus starting equity.
- [ ] Equity reconciles to cash plus marked positions at every point.
- [ ] Default entry is next-bar open.
- [ ] Multi-symbol processing is chronological.
- [ ] Trades/fills/equity survive restart.
- [ ] Price and equity charts show persisted data, not reconstructed guesses.
- [ ] Data gaps block the run with exact intervals.
- [ ] V2 promotion uses the research contract hash and criterion breakdown.
- [ ] Options and unsupported source strategies are not advertised as normal OHLCV backtests.
