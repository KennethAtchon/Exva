# Solution 05 - Replacement Session Matrix and Observability

> **Outcome:** The default matrix contains one guaranteed paper plumbing proof, reachable primary
> strategies, one EDGAR lane, one Polymarket lane, and honest sentinels for unfinished classes.
> Equity-hours sessions go dormant after close (wake via `setTimeout` at next open) so post-close
> activity and logs collapse and open-market first-divergence stays readable.

Implements: docs/engineering/CODING_GUIDELINES.md

## Matrix Principles

1. A session is not useful because it covers a catalog row. It is useful when its producer, input,
   instrument handoff, broker route, and lifecycle are reachable.
2. A sentinel is allowed only when visibly labeled blocked and excluded from “working coverage.”
3. Duplicate sessions that share one coalesced schedule are not independent stress lanes.
4. EDGAR is one event-quality lane, not the primary source of immediate trades.
5. New alpha sessions launch only after a V2 backtest passes the exact research contract.

## Required Matrix

| Name                           | Kind                  | Experience               | Broker                          | Purpose                                                   | Start State                              |
| ------------------------------ | --------------------- | ------------------------ | ------------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| `PAPER-EXECUTION-CANARY`       | Proof                 | `paper-execution-canary` | Alpaca paper                    | One explicit `$10` SPY round-trip certification           | Manual arm; regular hours                |
| `ETF-REVERSION-PRIMARY`        | Alpha candidate       | `rules-mean-reversion`   | Alpaca paper                    | Fresh SPY/QQQ deterministic path                          | Start only after freshness/parity repair |
| `CRYPTO-BREAKOUT-24X7`         | Alpha candidate       | `rules-breakout`         | Alpaca paper                    | Always-open fresh 4h BTC path                             | Start after freshness/parity repair      |
| `EDGAR-CATALYST-PRIMARY`       | Event alpha candidate | `edgar-catalyst`         | Alpaca paper                    | Early tradability/materiality and document-first analysis | Start after EDGAR repair                 |
| `POLYMARKET-EVENT-PRIMARY`     | Event alpha candidate | `prediction-event-edge`  | Polymarket paper                | Catch-up delivery and ghost lifecycle                     | Start after event/AI repair              |
| `FUTURES-INTEGRATION-SENTINEL` | Sentinel              | `rules-trend-following`  | Mock paper                      | Show missing external data/order lifecycle                | Stopped by default                       |
| `OPTIONS-INTEGRATION-SENTINEL` | Sentinel              | `options-flow-edge`      | Tradier sandbox or Alpaca paper | Show missing chain/OCC/multi-leg handoff                  | Stopped by default                       |

Remove `ETF-REVERSION-CONTENDER` from the default matrix. It shares the same schedule group and does
not prove an independent scan. Add contention tests after one primary path is healthy.

## New Experience: `paper-execution-canary`

Descriptor requirements:

- category `system_proof`, not alpha;
- `paper_only` hard requirement;
- no automatic recurring schedule;
- manual 15-minute arm;
- fixed SPY/$10 regular-hours contract;
- one run/account/day;
- visible certification origin;
- excluded from research promotion and strategy analytics.

This is the only new experience that may launch without a backtest because it makes no alpha claim.

## First New Alpha Experience

Do not resurrect `rules-unusual-volume` from its failed six-month gate. After Lab V2:

1. Define candidate universe and research contract before running sweeps.
2. Use multiple liquid symbols and a complete dataset.
3. Record all attempted parameter cells.
4. Require sufficient OOS sample, net expectancy after costs, bounded drawdown, and stable folds.
5. Register the winning experience only if the contract passes.

If no candidate passes, launch no new alpha experience. The canary still proves trading infrastructure.

## Session Funnel Surface

Each session card/detail shows:

| Stage          | Fields                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------ |
| Uptime         | Coverage % of the eligible window, minutes late at open, unplanned stops                   |
| Input          | Last poll/scan, latest data timestamp, freshness lag, stored bars versus minimum, next run |
| Signal         | Evaluations, setups, no-setups, stale/insufficient/error counts                            |
| Delivery       | Queued, caught up, expired, dead-lettered, no-subscriber                                   |
| Selector       | Discovered, verified, accepted, rejected by reason                                         |
| Research       | Success, provider failure, schema repair, invalid output                                   |
| Decision       | Buy/sell/skip and confidence/edge summary                                                  |
| Risk           | Passed/rejected by stable code                                                             |
| Approval       | Pending/approved/rejected/timed out                                                        |
| Order          | Intent, submitted, accepted, partial, filled, canceled, rejected                           |
| Reconciliation | Broker/Exva quantity and terminal agreement                                                |

Headline examples:

```text
NO TRADE: INPUT_STALE
Newest BTC 4h bar is 8h old; provider refresh returned no newer closed bar.

NO TRADE: INPUT_INSUFFICIENT_HISTORY
QQQ 1h has 21 stored bars; rules-mean-reversion requires 50. Provision history to evaluate.

NO TRADE: NO_SETUP
Fresh SPY/QQQ 1h bars evaluated at 15:00Z; 0/2 symbols met z <= -2.

DEGRADED: PROVIDER_UNAVAILABLE
Structured-output route circuit open after 6/9 failures; fallback route in use.

BLOCKED: OPTIONS_PRODUCER_UNREACHABLE
Default scheduled options evaluator cannot consume option chains.
```

Expected market closure is a neutral waiting state, not a failure and not the headline when an earlier
open-market stale-data failure exists.

`NO_SETUP` is the only headline that means "the strategy looked and declined." Every other code above
means the strategy never got a fair look, and they must never be collapsed into it.

## Workstream: Dormant Until Market Open (P2-3)

> **Problem:** §5.5 of the diagnosis. After the equity close the session keeps working — selector
> cycles, delivery processing, exclusion WARNs, and `Signal delivery queued; market is closed`
> messages (115+ EDGAR drops on July 27). Hours filtering was correct; the noise and wasted cycles
> buried the earlier open-market first divergence and made operators blame market hours for a day that
> failed while the market was open.
> **Owns:** P2-3.

### Verified current behavior

Partial wake-at-open already exists for the **empty-selector** path only:

- `MarketHoursService.nextTradableAt()` returns the next equity open when exclusions are hours-only.
- `TradingCycleContext.marketClosedRetryAt` + `noInstrumentRetryTimer` (`setTimeout` in
  `cycle-refill.ts`) defer the next selector refill until open (or the fixed retry floor).
- `instrument-queue.ts` can emit "Waiting until the next open … instead of re-polling."

That is not dormancy. After close, EDGAR (and any other signal source) keeps delivering. Each queued
delivery still runs a full selector cycle (`agent-orchestrator` → `run-selector`), which excludes
everything as `exchange_closed`, logs WARN, and may re-arm timers. The session stays busy and the log
grows linearly with after-hours traffic.

### Required behavior

When a session's tradable universe is blocked solely by market hours, the session enters
`market_closed` **dormancy** until the next open. Not "keep cycling quietly" — **stop activity**.

```text
open-market work
      │
      ▼
hours-only block detected ──► ONE enter log (reason + nextOpenAt ET)
      │
      ▼
arm setTimeout(wakeAtOpen)   ◄── reuse/extend noInstrumentRetryTimer
      │
      ▼
DORMANT until timer fires
  • no selector cycles
  • no trade cycles
  • no per-delivery processing that re-runs market-hours filter
  • inbound equity-hours deliveries: queue/hold OR quiet-complete + counter
  • no exchange_closed / "market is closed" log spam
      │
      ▼
timer fires (or clock past nextOpenAt) ──► ONE resume log (+ skip count)
      │
      ▼
resume normal scan / delivery / selector work
```

| Transition | Session action | Log / event |
| ---------- | -------------- | ----------- |
| Enter `market_closed` dormancy | Clear in-flight selector/refill work that would only re-hit hours; arm wake-at-open `setTimeout`; set activity `market_closed` | One INFO: reason + `nextOpenAt` ET |
| While dormant | No orchestrator activity for that session until wake | Counters only (`market_closed_skips_N`); zero WARN walls |
| Leave dormancy | Clear timer/state; resume listener + next eligible cycle | One INFO: resumed + quiet drop/hold count |

Rules:

1. **Dormancy is the primary fix; log collapse is a consequence.** If the session is truly idle until
   open, the wall cannot form.
2. **Wake with `setTimeout` to `nextOpenAt`** (clamp to Node's max delay; if open is farther, chain
   or re-arm). Reuse `noInstrumentRetryTimer` / `scheduleCycleRefillAfterDelayIfIdle` — do not invent a
   second timer family. Do not poll on the fixed no-instrument interval while dormant.
3. **One enter log per closed window per session.** Same `nextOpenAt` → no re-log, no re-entry churn.
4. **While dormant, signal deliveries must not restart the orchestrator.** Hold until wake, or
   quiet-complete with `dropReason: market_hours_filtered` and bump a counter. Never run selector just
   to discover `exchange_closed` again.
5. **Scheduled equity scans also pause.** A rules session on NYSE hours must not keep firing
   evaluations that can only return hours-blocked / closed-market freshness. Crypto / always-open
   calendars are exempt and must keep running.
6. **Open-market failures stay loud.** Stale input, insufficient history, provider errors, and
   `no_setup` during regular hours are never folded into dormancy.
7. **UI headline:** `WAITING: MARKET_CLOSED` with `nextOpenAt`, never `attention_required`, and never
   the card headline when an earlier open-market first-divergence already exists for that day.
8. **Stop / restart clears dormancy cleanly.** Stopping the session clears the timer; starting while
   still closed re-enters with at most one new enter log for that window.

### Touch points

| Area | Change |
| ---- | ------ |
| `trading-cycle-context.ts` / `cycle-refill.ts` | Durable dormancy flag + single wake-at-open `setTimeout`; clear on stop/resume |
| `instrument-queue.ts` | Enter dormancy on hours-only empty handoff; no fixed-interval re-poll while waiting |
| `agent-orchestrator.ts` signal listener | Ignore or quiet-complete queued deliveries while dormant; do not `scheduleSelectorCycle` |
| `run-selector.ts` | First hours-only all-filtered result enters dormancy; later cycles never run until wake |
| Scheduled scan / alpha source path | Skip tick for equity-hours sessions while dormant (or arm next tick at open) |
| `session-activity-tracker.ts` | Align `market_closed` enter/clear with dormancy + single log |
| Funnel / session card | Waiting state + skip/hold count; preserve earlier first-divergence |

### Required tests

- After-hours burst of N queued deliveries → session enters dormancy once; **zero** selector cycles
  after enter; N holds/quiet drops; exactly one enter log.
- `setTimeout` / fake timers: advance to `nextOpenAt` → one resume log, then normal activity resumes.
- While dormant, fixed no-instrument retry does **not** fire extra selector cycles.
- Same closed window revisited → still one enter log; timer not duplicated.
- Regular-hours stale/insufficient/no_setup paths still emit and still run cycles.
- BTC / always-open session never enters equity `market_closed` dormancy from this path.
- Session stop during dormancy clears the timer; no wake callback after stop.

### Acceptance

- [ ] After equity close, an affected session does **no** selector/trade-cycle work until the next open
      (or explicit stop).
- [ ] Wake is a single timer to `nextOpenAt`, not fixed-interval polling.
- [ ] Post-close soak with EDGAR (or fixture deliveries) produces **one** market-closed transition
      log per session, not a wall.
- [ ] On reopen, one resume log; subsequent open-market cycles run and log normally.
- [ ] Open-market first-divergence remains findable in the same day's log.
- [ ] Funnel still counts after-hours holds/drops; activity and log volume both collapse.

## Alerts

### Fix the Existing Staleness Detector First

`session-activity-tracker.ts` `sweepNoSignalStale()` measures age since session **creation** and checks
whether the session has **ever** recorded an execution step or delivery. A session that consumed one
input at boot and nothing for the following twelve hours never flags. It detects born-dead sessions
only — not the far more common "went quiet" case. Replace it with the rolling-window evaluation in
[Solution 08 Workstream 5](./08-uptime-and-scan-cadence.md), keeping the born-dead check as a separate
code.

### Conditions

Trigger `attention_required` only on actionable conditions:

- stale input beyond two expected bars;
- stored bars below the strategy's declared minimum on an eligible scan;
- uptime coverage below 90% of the eligible window for a running session;
- all instruments unevaluable for two consecutive eligible scans;
- provider failure threshold with actual call denominator;
- schema-invalid output after repair threshold;
- order state unreconciled beyond timeout;
- broker/Exva position mismatch;
- repeated identical no-setup digest after an expected new bar.

One transient scheduled failure records warning telemetry but does not auto-pause the entire session.

## Setup Prompt Rewrite

`docs/prompts/setup-everything.md` should:

1. Inventory broker certification, not static class labels.
2. Create/reuse the seven rows above.
3. Start only the canary and repaired primary lanes.
4. Leave sentinels stopped with exact blocker.
5. Arm certification only after explicit user confirmation.
6. Report first divergence, not merely `active` status.
7. Stop after setup; use the monitor prompt for soak evidence.

## One-Day Acceptance Report

The report must contain:

- uptime coverage, minutes late at open, and unplanned stops, stated **first** — a report below 90%
  coverage may not draw conclusions about setup rates;
- certification Exva/broker order IDs and flat reconciliation;
- every primary session's fresh input count;
- stored bars versus declared minimum per scheduled instrument;
- eligible evaluations on unique bar-window digests, and the derived setup rate;
- AI provider failure counts with their call denominators, circuit transitions, and cost per accepted
  candidate;
- setup and no-setup counts by unique data digest;
- complete first-divergence reason distribution;
- provider/model failures with denominators;
- EDGAR gate funnel and AI spend after early filtering;
- Polymarket caught-up versus live-delivered events;
- order intents, broker events, fills, positions, and mismatches;
- explicit sentinel blockers;
- confirmation that all routes remained paper-only.

## Completion Criteria

- [ ] Canary creates a visible Exva and Alpaca paper round trip.
- [ ] Rules primary sessions evaluate advancing data digests.
- [ ] No duplicate default contender shares the same schedule.
- [ ] EDGAR uses one lane and filters before AI.
- [ ] Polymarket receives catch-up events and survives malformed model output.
- [ ] Futures/options are never reported green without class-specific lifecycle proof.
- [ ] Every no-trade headline names the earliest stable reason code.
- [ ] `no_setup` is never used for a scan that was stale, starved, or degraded.
- [ ] Staleness detection catches a session that goes quiet, not only one that starts dead.
- [ ] Uptime coverage is reported before any setup-rate claim.
- [ ] Post-close equity-hours sessions go dormant until next open (one timer, one enter/resume log; P2-3).
- [ ] A new alpha session exists only if Lab V2 promotion passes.
