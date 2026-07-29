# Solution 02 - Repair the Live Trading Funnel

> **Prerequisite:** Solution 01 has produced a reconciled Alpaca paper certification.
> **Outcome:** Normal paper sessions use fresh inputs, preserve one signal contract, and report the
> first exact no-trade reason.

Implements: docs/engineering/CODING_GUIDELINES.md

## Scope Boundaries

This document owns **recency, contract integrity, and delivery**. Three adjacent concerns are owned
elsewhere and must not be re-solved here:

| Concern                                         | Owner                                                 |
| ----------------------------------------------- | ----------------------------------------------------- |
| Bar **depth** and universe breadth              | [Solution 06](./06-market-data-provisioning.md)       |
| Provider fallback, circuit breaking, AI budgets | [Solution 07](./07-ai-reliability-and-spend.md)       |
| Building the options producer                   | [Solution 10](./10-options-and-futures-enablement.md) |

Workstream 1 makes a scan _current_; Solution 06 makes it _sufficient_. A fresh window of 21 bars for a
strategy that declares 50 is still not evaluable, and the two fixes are independent.

## Workstream 1: Market-Data Freshness

### Change

Add `LiveBarFreshnessService` and integrate it into `MarketDataService.getBars()` before the
count-satisfied return at `market-data-service.ts:63-64`.

Freshness inputs:

- symbol and instrument class;
- timeframe;
- market calendar ID;
- newest cached timestamp;
- current time;
- provider delay allowance.

Freshness output records expected latest closed bar, actual latest bar, lag, decision, provider, and
post-fetch result. Timeframe-aware defaults:

| Timeframe   | Fresh when                                                                  |
| ----------- | --------------------------------------------------------------------------- |
| 15m/1h NYSE | Newest bar is the latest completed permitted session bar                    |
| 4h crypto   | Newest bar is the latest completed 4h UTC bucket, allowing provider delay   |
| 1d equity   | Newest bar is the latest completed trading day, not the current partial day |

Do not use one global 30-minute threshold.

### Required Tests

- Monday regular hours with stale Friday bars refreshes.
- Closed market with latest Friday close does not refetch continuously.
- Always-open BTC advances across 4h buckets.
- Provider returns stale rows -> `input_stale`, not `no_setup`.
- Cached 21-row fixture with old newest timestamp calls provider.

## Workstream 2: Immutable Deterministic Signals

Replace the sparse scheduled `ScanHitPayload` with `DeterministicSignalFactV1` from the master plan.
The scheduler serializes parsed parameters, timeframe, strategy version, newest bar timestamp, digest,
action, strength, evidence, lifecycle, and `originKind = "strategy"`. The paper-only planted
production-path proof sets `originKind = "certification"`; that field propagates through cycle, order
intent, trade, and analytics without a side channel or undocumented bypass.

Downstream rules builders must stop re-running mean reversion, breakout, and trend on fallback bars.
They consume the fact, including any typed exit lifecycle, and add current quote/risk/order evidence
only.

### Required Tests

- Configured 4h breakout remains 4h through order intent.
- Non-default lookback/threshold survives serialization.
- NY range stop, partial target, runner stop, and session-end lifecycle survives serialization.
- Changing any bar changes the digest.
- Duplicate signal fact does not create a duplicate order intent.
- Scheduler action and downstream action cannot disagree.

## Workstream 3: Strategy Contracts

Use `requiredBarCount` as the minimum evaluable contract and add `preferredContextBarCount` for desired
history. `warmupBars` remains internal to the evaluator. The executor reports all three values. The
enforcement, provisioning, and registry validation for these fields are specified in
[Solution 06 Workstream 1](./06-market-data-provisioning.md); this workstream owns only the executor
reporting them.

Fix mean-reversion baseline to score the current bar against the preceding 20 bars only. Re-run V2
backtests before changing `zScoreEntry`. Record before/after setup counts in shadow mode.

Note on the bound: the corrected statement is that population-variance self-inclusion caps the single
outlier at `sqrt(n-1)` — about `4.359` for n=20, not `4.249`. Cite the bound only from the diagnosis
[C12], and treat any measured suppression percentage as belonging to the invalid V1 engine until a V2
run reproduces it.

Do not lower risk or edge gates globally. First prove current data and signal parity.

## Workstream 4: Options Reachability

The current scheduled Options Flow path is a dead producer. Choose one honest state:

1. Implement a chain-scan producer that fetches AAPL/NVDA chains, computes UOA, selects OCC contracts
   and vertical legs, and emits an options-class fact.
2. Mark `options-flow` `forward_paper_only` and remove it from runnable scheduled experiences until
   that composition exists.

Implement option 2 immediately. Option 1 is a separate tracer bullet requiring point-in-time option
chains, whole-contract sizing, account option level and buying power, vertical max-debit risk,
multi-leg order preview and placement, and positions/close proof. That tracer is planned in full in
[Solution 10](./10-options-and-futures-enablement.md) — it is deferred, not undefined.

## Workstream 5: Prediction Event Catch-Up

Add a unique `(subscription_id, signal_event_id)` delivery key and a subscription event cursor. A
source event may be persisted/deduped globally before a subscriber exists, but it remains eligible for
catch-up until TTL expiry.

On session creation/start/resume:

1. Determine cursor from last delivered event or TTL boundary.
2. Query eligible source events.
3. Apply delivery gate.
4. Insert missing deliveries transactionally.
5. Advance cursor after insertion.

Test source-first and subscriber-first startup order. Both must deliver the same eligible event once.

## Workstream 6: Structured AI Output

At the worker interpreter boundary:

1. Strict parse.
2. One schema-repair request.
3. Strict reparse.
4. Persist typed `model_output_invalid` skip with field paths.

Do not default `pHat`. Add null guards before every review destructure. Provider timeout exhaustion is
a typed provider failure and counts toward health; it does not leave the cycle outcome null.

This workstream fixes the schema boundary only. The layer above it — provider health, circuit
breaking, and the one-hop fallback route that a repair attempt should use when the primary route is the
thing that is failing — is [Solution 07](./07-ai-reliability-and-spend.md). Repairing a schema against
a provider that is down 67% of the time still fails.

Acceptance for one paper day:

- zero unclassified `pHat` throws;
- zero undefined-signal destructures;
- every failed worker has provider/model/phase/schema issue paths;
- session can continue after a typed failed cycle within bounded health policy.

## Workstream 7: EDGAR Candidate Ordering

Preserve issuer CIK, accession, filing URL, accepted time, form, and items through every phase. Before
AI, apply and count:

```text
issuer_resolved
broker_asset_active
listed_exchange
price_floor
dollar_volume_floor
spread_ceiling
filing_freshness
material_item
```

Defaults: listed US equity, not OTC, price >= `$5`, 20-day average dollar volume >= `$500,000`, spread
<= 50 bps, filing age <= six hours, and configured material items.

Use one application-wide SEC limiter at eight requests/second. Require `EXVA_SEC_CONTACT` or a Settings
value for the User-Agent contact. Deduplicate and checkpoint by accession; never infer issuer CIK from
the accession prefix.

## Workstream 8: Broker and Session Correctness

- Forward all optional inner adapter methods through instrumentation.
- Fix approval rejection to call `resolveApproval(tradeId, false)`.
- Add an approval timeout that rejects and releases reservation transactionally.
- Refactor start/resume through one `prepareForActivation()` that performs readiness and preflight.
- Mark Kraken, Tradier, Kalshi, and Polymarket live unavailable until position/flatten certification
  passes; static `launchCapable` is insufficient.
- Validate Alpaca `trading_blocked`, account status, buying power, asset tradability, options levels,
  and data entitlement.

## Workstream 9: Funnel Projection

Persist one terminal cycle outcome with stable stage/reason code. The UI shows:

```text
inputs -> fresh -> signals -> delivered -> selected -> researched -> decided -> risk-passed
       -> approved -> submitted -> filled
```

For each stage show count, most recent time, and top rejection reasons. The headline is the earliest
stage with no advancement, not the latest noisy log line.

## Rollout Order

1. Freshness shadow telemetry.
2. Immutable signal fact in shadow comparison.
3. Enforce freshness for BTC, then equities.
4. Remove downstream rule re-evaluation.
5. Enable prediction catch-up.
6. Enable structured-output repair.
7. Shadow EDGAR gates, then enforce.
8. Harden broker/resume/approval paths.
9. Enable funnel UI.

## Completion Criteria

- [ ] No stale cache can produce `no_setup`.
- [ ] Scheduler and downstream decision use one signal digest.
- [ ] A planted scheduled fact traverses the real trade cycle, risk, routed order, instrumented
      adapter, fill reconciliation, and visible certification-origin trade in paper mode.
- [ ] Completion cannot be claimed from fresh scans or order intents alone.
- [ ] Options Flow is honestly unavailable or reaches an actual OCC order.
- [ ] Pre-subscription prediction events catch up exactly once.
- [ ] EDGAR rejects untradeable candidates before AI.
- [ ] Resume reruns preflight/readiness.
- [ ] Approval reject/timeout cannot hang a queue task.
- [ ] Every cycle has one terminal outcome and first divergence.
- [ ] `input_stale` and `input_insufficient_history` are distinct outcomes, and neither is reported as
      `no_setup`.
