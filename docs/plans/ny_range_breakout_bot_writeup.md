# NY Midnight-Hour Range Breakout for Exva

**Status:** Design only. Do not register or activate the experience until the lifecycle backtest and paper-trading requirements below are implemented and the research contract passes.

## Goal

Bring the original gold/XAUUSD New York midnight-hour range breakout strategy into Exva without changing its trading rules or retaining a standalone Python runtime. The strategy must use the same deterministic TypeScript implementation for scheduled scans, historical replay, and paper execution.

This is a new scheduled, rules-based **futures experience**, proposed as:

- Experience ID: `rules-ny-range-breakout`
- Strategy ID: `ny-range-breakout`
- Pipeline ID: `rules-ny-range-breakout-cycle`
- Initial universe: `GC` only. `GC` is Exva's existing gold futures canonical symbol; it is not interchangeable with broker-specific `XAUUSD` CFD symbols.

## Strategy Invariants

These rules are the strategy. Parameterization may be backtested, but implementation must not silently substitute percentage exits, different session times, or a different range.

| Rule | Exva behavior |
| --- | --- |
| Range | Aggregate the 12 closed 5-minute bars from `00:00:00` through `00:59:59` in `America/New_York`. `rangeHigh` is the maximum high and `rangeLow` is the minimum low. |
| Signal window | Evaluate only closed 5-minute bars starting with the bar that closes at `01:05` New York time and ending before the next New York midnight. |
| Entry | Take the first bar whose **close** is strictly above `rangeHigh` (buy) or strictly below `rangeLow` (sell). Enter at that bar's close. A wick through either level without a close beyond it is not an entry. |
| Daily limit | Open at most one trade per New York calendar date. A long or short signal consumes the day's allowance. |
| Initial stop | Long: `rangeLow - 10 gold pips`. Short: `rangeHigh + 10 gold pips`. The actual price increment must be supplied by the `GC` contract metadata; do not assume the XAUUSD convention `0.10` applies to futures. |
| First target | Long: entry plus 20 gold pips. Short: entry minus 20 gold pips. Close 80% of the original quantity at this price. |
| Runner | After the partial fills, move the remaining 20% stop to the entry price. Close it at that stop or at the configured session cutoff. The initial version does not implement discretionary swing trailing. |
| Session cutoff | Close an open runner at the close of the final 5-minute bar before `23:00 America/New_York`. This preserves the original `session_end_hour_ny = 23` intent while making the timestamp unambiguous. |
| Intrabar collisions | If a 5-minute bar can reach both a relevant stop and TP1, model the stop first. This conservative ordering is required in replay and must be recorded in trade evidence. |

`America/New_York` must be used, rather than a fixed UTC offset, so the range continues to be midnight to 1 AM local time across daylight-saving transitions.

## Why the Existing Replay Engine Is Insufficient

`electron/main/services/backtest/replay-engine.ts` already runs the same `DeterministicStrategy.evaluate()` object used by `ScheduledStrategyExecutor`, which is the correct foundation. It cannot faithfully evaluate this strategy yet:

- `TradingTimeframe` in `electron/shared/domain/enums.ts` does not include `5m`; the smallest current timeframe is `15m`. Adding validated 5-minute bars across the shared enum, schemas, provider mappings, persistence, scheduling, and UI is a prerequisite. Running this on 15-minute bars changes both the range construction and the entry rule.
- `resolveExitIndex()` uses only `bar.close` and a single percentage stop/target.
- `ExitPolicyConfig` has no price-level stop, partial close, stop amendment, or session-cutoff semantics.
- `BacktestTrade` represents one entry and one exit, not the required TP1 and runner fills.
- `ScheduledStrategyExecutor` emits a `scan_hit`, but the normal exit evaluator also supports only percentage and ATR exits.

Do not approximate the range stop as a percentage or collapse TP1 and the runner into a single target. Extend the common lifecycle contract first so replay and paper execution use the same explicit intent.

## Implementation Design

### 1. Strategy Signal

Add `electron/main/services/signals/strategy/ny-range-breakout-signal.ts` and a definition at `electron/main/services/strategies/definitions/ny-range-breakout.ts`.

Before creating the definition, add `5m` as a supported `TradingTimeframe` and verify every timeframe consumer accepts it: shared validation and IPC schemas, market-data/provider mapping, OHLCV persistence and ranged backfill, session input configuration, schedule planning, and Backtest Lab. Add regression coverage for a 5-minute request through each boundary. This is not a local strategy change because `TradingTimeframe` is a cross-process domain type.

The definition must then:

- Accept `futures` only and support `5m` only.
- Require enough bars to cover the current New York day from midnight through the just-closed bar. It must return `null`, not infer a range, when any of the 12 range bars are missing.
- Use a timezone-aware library already accepted by this workspace, or add one deliberately. Parse each `OhlcvBar.ts` as an instant, convert it to `America/New_York`, and derive the local date/range boundaries there.
- Emit only after 01:00 New York time, only for the first close beyond the completed range, and only once per range day. Its `barWindowHash` must include the local date, range values, breakout bar timestamp, direction, and the OHLC sequence used to calculate them.
- Emit numeric evidence: `rangeHigh`, `rangeLow`, `entryPrice`, `initialStopPrice`, `tp1Price`, `rangeDateNy`, `breakoutBarTs`, `partialClosePct: 0.8`, and `sessionEndTs` as a numeric epoch. The current `DeterministicStrategySignal.evidence` type is `Record<string, number>` at `replay-engine.ts:14`; extend it only if a human-readable local date is needed.

Expose the strategy through `electron/main/services/strategies/index.ts`. The `StrategyDefinition` contract and registry live in `electron/main/services/strategies/strategy-definition-registry.ts`.

The strategy's role is strictly setup detection. It does not place orders, query a broker, or retain mutable daily state. Repeated evaluation of the same closed-bar window must produce the same signal; scheduler deduplication uses `barWindowHash` in `scheduled-strategy-executor.ts`.

### 2. Explicit Lifecycle Plan

Add a strategy-owned lifecycle plan to the deterministic signal or an adjacent typed contract. It must carry absolute price levels and quantity fractions:

```ts
type BracketLifecyclePlan = {
  initialStopPrice: number;
  firstTarget: { price: number; closeFraction: 0.8 };
  runner: {
    closeFraction: 0.2;
    stopAfterFirstTarget: "entry_price";
    sessionEndTs: string;
  };
  sameBarPriority: "stop_before_target";
};
```

Apply this contract to three paths before registering the experience:

1. **Replay:** replace the single-exit assumption for a lifecycle-plan trade. Evaluate each subsequent bar's `high` and `low`, capture the TP1 fill, amend the runner stop to entry, and close remaining quantity at its price level or the session cutoff close. Persist both fills and calculate blended net return after costs.
2. **Paper/live orchestration:** create the initial position with its absolute stop, submit or emulate the 80% TP1, amend the remaining stop to entry only after a confirmed partial fill, and force-close at the local session cutoff. Broker adapters that cannot support fractional partial exits or stop amendment must reject activation rather than substitute an all-or-nothing exit.
3. **Risk/exits:** extend `electron/main/services/risk/exit-policy-evaluator.ts`, or introduce a strategy-lifecycle evaluator beside it, to evaluate price-level lifecycle rules. The existing evaluator's fixed-percent and ATR policies must remain unchanged for existing experiences.

The lifecycle record must preserve entry, TP1 fill, runner fill, reasons, and price levels. One flattened `BacktestTrade` row is insufficient for auditability; add fill-level data while retaining an aggregate return field for existing metrics.

### 3. Backtest Semantics

Use Exva's Backtest Lab (`electron/main/services/operator/backtest-lab-service.ts`) after historical ranged backfill is available. Its current `run()` path correctly loads DB-covered bars with `failOnGaps: true`; do not have replay fetch market data implicitly.

Backtest requirements:

- Use 5-minute `GC` historical bars with high, low, and close. `OhlcvBar` already exposes these fields in `electron/main/services/broker/adapters/broker-adapter.ts`.
- Backfill an uninterrupted multi-year window before choosing parameters. Exclude sessions whose midnight range has missing bars and report their count.
- Keep 10-pip stop buffer, 20-pip TP1, 80% partial, breakeven runner, and 23:00 New York cutoff fixed in the primary evaluation. Any parameter sweep is exploratory and is persisted as a sweep, not promoted as the default without out-of-sample validation.
- Use the configured `GC` provider/broker contract tick size and the provider's realistic spread, fee, and slippage assumptions. Record the exact conversion from the source video's “gold pip” to GC price units in `costModelJson` and the research contract.
- Apply the conservative `stop_before_target` rule whenever high/low make both outcomes reachable in one bar. Count these collisions in result metadata.
- Run purged walk-forward folds through `runBacktest()`. Promotion must use the existing research evidence path, not a one-off favorable Lab run.

### 4. Experience and Catalog Wiring

Only after the lifecycle replay passes its tests and the strategy passes its research contract:

1. Add `electron/main/experiences/rules-ny-range-breakout/descriptor.ts`, mirroring the schema in `rules-breakout/descriptor.ts`.
2. Register it in `electron/main/experiences/index.ts` and ensure `validateExperienceRegistry()` passes.
3. Add a deterministic pipeline descriptor in `electron/main/services/pipeline/implementations/registry/pipelines.ts` and an analysis plan mirroring `rules-breakout-analysis.ts`. The pipeline should consume `scan_hit`, then use the normal execution-profile, risk-gate, and broker-allocation stages.
4. Add a template revision in `electron/main/services/experience-catalog/experience-template-seeds.ts` with `strategyId: "ny-range-breakout"`, `instrumentClasses: ["futures"]`, `analysisTimeframes: ["5m"]`, and scheduled-scan input.
5. Add an input profile in `electron/main/services/experience-catalog/input-profile-seeds.ts`: `GC`-only instrument set, five-minute cadence with **zero jitter**, `5m` analysis, and a calendar that permits the 00:00-23:00 New York strategy window. Schedule only after closed 5-minute bars are available; do not reuse `always-open` if it schedules times that do not align to completed-bar boundaries.
6. Add a dedicated gold-only instrument set rather than changing `COMMODITIES_FRONT_MONTH`, whose current members are `GC` and `CL` in `instrument-set-seeds.ts`.

The research contract must state a falsifiable hypothesis based on the actual fixed rules and contain only validation thresholds and costs justified by the backtest. Do not copy thresholds from `rules-breakout` or `rules-trend-following` as placeholders.

## Required Tests

### Unit: Signal Detection

Add tests covering:

- Correct 00:00-01:00 New York range aggregation from 12 five-minute bars.
- Both EST and EDT dates, demonstrating that the local hour is stable while the UTC hour changes.
- Long and short first-close breakout detection.
- Wick-only touches do not signal.
- No signal for missing range bars, before 01:00, or after a previous breakout has consumed the day.
- Exact stop and TP1 price calculation through the injected GC pip/tick conversion.
- Stable `barWindowHash` for identical input and changed hash when range or breakout data changes.

### Unit: Lifecycle Replay

Add tests covering:

- Full initial-stop loss before TP1.
- TP1 then breakeven runner stop, with the aggregate result weighted 80%/20%.
- TP1 then session-cutoff runner close.
- Same-bar stop/TP1 collision resolves to stop first.
- Long and short symmetry.
- Costs applied once per actual fill/order according to the adopted cost model, not once per original position if that contradicts broker accounting.

### Composition

1. Seed the catalog and create a session with `experienceId: "rules-ny-range-breakout"`.
2. Feed a completed 5-minute bar sequence containing a valid breakout.
3. Verify `ScheduledStrategyExecutor` emits one `scan_hit` with lifecycle evidence.
4. Verify the deterministic pipeline reaches risk and allocation stages with the proposed side and absolute lifecycle plan.
5. Replay the same fixture and assert the equivalent entry, TP1, runner, and aggregate result.

## Promotion and Launch Gate

1. Backfill `GC` 5-minute bars and verify coverage before running Lab experiments.
2. Run the fixed-rule strategy across purged walk-forward folds with the documented `GC` cost model.
3. Save the primary run, all exploratory sweeps, and the exact strategy/version/hash. Re-run the primary spec and require a matching deterministic hash.
4. Submit the results to the existing promotion machinery. The experience remains unregistered or disabled if it fails its declared out-of-sample trade count, expectancy, Sharpe, drawdown, or fold requirements.
5. If it passes, paper trade through a broker route that supports `GC`, absolute stops, partial closes, and stop amendment. Compare fill behavior, costs, and session cutoffs against replay before any funded activation.

## Non-Goals

- No standalone CLI, synthetic data generator, or `BrokerInterface` stub.
- No XAUUSD CFD support in the initial implementation. Add it later only as a separately mapped broker instrument with verified pip and contract semantics.
- No discretionary swing-low/high trailing for the runner.
- No live activation based on synthetic data or an in-sample backtest.
