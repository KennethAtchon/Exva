# Feature Request: Live Session Activity Indicator ("What is this session doing right now?")

**Status:** proposed
**Origin:** 2026-07-19 overnight stress run — 6 sessions sat `active` for 11+ hours doing literally nothing (see `docs/reviews/2026-07-19-overnight-stress-session-review.md`). The UI said "active". The truth was: EDGAR sessions had no live signal source, scan sessions were crash-looping on bar fetches, and the Polymarket session was rejecting 100% of candidates. None of that was visible without SQL + log spelunking.

### TLDR: shortcuts taken

- Condition catalog below is derived from one night of failures plus code reading — it is a starting set, not proven exhaustive. New conditions will be discovered in production.
- I assumed the renderer sessions view lives in `src/` stores fed by IPC polling/push; I did not trace the exact component tree before writing this.
- Detector thresholds (e.g. "no signal in 2× expected cadence") are guesses; they need tuning against real cadences.
- No mockups — layout described in words only, per doc-stage scope.

### User journey

I open Exva in the morning after an overnight run. The sessions list shows each active session with a small live status chip next to its name — not just "active" but what it's _actually doing_: "⏸ market closed — resumes Mon 9:30 ET", "⚠ data feed failing (49 consecutive errors)", "🔄 selector cycle running (2m ago)". I click STRESS-06. The session detail page has an **Activity strip** at the top: current state, last state change, and a one-line reason in plain words. Below it, a **condition list**: every active blocker/warning with severity, since-when, and count ("bar fetch failed ×110 since 23:12"). If something needs me (bug, dead feed, spend limit), the app raised a notification overnight — I didn't have to open it to find out. I leave knowing exactly which sessions are healthy, which are legitimately waiting, and which are broken.

### Core decisions (sign-off required)

1. **Push vs poll for the live indicator.** Recommendation: main process pushes activity snapshots over an IPC event channel (renderer subscribes), with a poll fallback on focus. Poll-only is simpler but makes "live" a lie at 15s+ granularity.
2. **Persist activity states in DB or derive on read?** Recommendation: persist current state + condition set per session in a new `session_activity` table (survives restart, queryable in postmortems, cheap). Derive-on-read keeps schema clean but loses history and costs a full detector sweep per UI read.
3. **Are ERROR-severity conditions allowed to auto-pause the session?** Recommendation: no auto-pause in v1 — surface loudly + notify, let the human decide. Auto-pause risks masking bugs the stress tests exist to find.
4. **Notification transport for unattended runs.** Recommendation: v1 = in-app notification center + macOS native notification. Push/email later.
5. **Does the heartbeat/detector layer block the trade path?** Recommendation: strictly observational — detectors read events/state, never sit in the execution path. A broken detector must never break trading.

---

## Problem

`sessions.status` has ~5 values (`active`, `paused`, `stopped`, …). "Active" conflates at least a dozen radically different realities:

| What the UI said   | What was actually true (2026-07-19)                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| STRESS-01 active   | Subscribed to an EDGAR feed whose poller was never instantiated — could never receive a signal                  |
| STRESS-04 active   | Scan firing every 15 min, every bar fetch throwing `TypeError`, zero signals produced, `consecutive_failures=0` |
| STRESS-06 active   | Same crash loop, on the one strategy that could actually have traded overnight                                  |
| STRESS-POLY active | Burning ~$0.006/cycle rejecting 100% of hallucinated candidates, forever                                        |

Everything needed to know this already exists internally — pino logs, `events`, `schedule_runtime_states`, `session_execution_steps`, orchestrator retry messages. It just never reaches the operator. The system must tell the user **all** of these conditions, unprompted.

## Feature

### A. UI

**1. Status chip in the sessions list** (every session, always visible)
One glyph + short label, color by severity: green = working/waiting normally, yellow = degraded/attention, red = broken, gray = idle by design. Examples: `● cycle running`, `◌ waiting for signal`, `⏸ market closed`, `⚠ feed errors`, `✖ input source dead`.

**2. Activity strip on session detail** (click an active session)

- **Current activity**, present tense, human words: "Running selector cycle #37 (started 40s ago)" / "Waiting for next scan tick at 09:15 ET" / "Blocked: NYSE closed — next open Mon 06:30 PT" / "Waiting: symbol AAPL locked by STRESS-02's open trade".
- **Timestamp of last state change** and last completed cycle outcome ("last cycle: 0 candidates accepted — all rejected at liquidity gate").
- **Sparkline/counter row:** cycles run, signals received, trades opened, errors — since session start.

**3. Condition list** (same page, below strip)
Every currently-active condition as a row: severity icon, name, plain-English explanation, since-when, occurrence count, and a "view evidence" link that opens the matching event-log entries. Conditions clear themselves when the detector sees recovery, and the clear is also logged.

**4. Notifications**
ERROR-severity conditions and first-occurrence WARN conditions raise an in-app notification (and macOS native when unfocused/backgrounded). Overnight runs are the whole point — the user must find out _without opening the session_.

### B. Condition catalog (v1 — every one of these observed or implied on 2026-07-19)

| Condition                | Severity   | Detector signal                                                                                                     |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `cycle_running`          | info       | execution step started, not finished                                                                                |
| `waiting_retry`          | info       | orchestrator "re-evaluating in N minutes" scheduled                                                                 |
| `waiting_signal`         | info       | event_source session, subscription live, no pending signal                                                          |
| `waiting_scan_tick`      | info       | scheduled session between ticks, next fire time known                                                               |
| `market_closed`          | info       | calendar gate returned closed; show next open time                                                                  |
| `symbol_locked`          | info       | candidate blocked by another session's open trade/conflict                                                          |
| `awaiting_approval`      | attention  | pending row in `trade_approvals`                                                                                    |
| `no_signal_stale`        | warn       | no signal received in ≥2× expected cadence while sources claim healthy                                              |
| `input_source_dead`      | error      | event_source subscription whose backing `signal_sources` runner is absent/stopped/erroring (the STRESS-01..03 case) |
| `data_feed_failing`      | error      | N consecutive market-data failures for the session's universe (the getBars case); include last error string         |
| `selector_rejecting_all` | warn       | K consecutive cycles with 0 accepted candidates; include dominant rejection reason                                  |
| `provider_degraded`      | warn       | AI/search provider error-rate or retry spike attributed to this session                                             |
| `spend_limit_near/hit`   | warn/error | AI-spend limiter thresholds                                                                                         |
| `calendar_misconfigured` | error      | calendar lookup threw (the empty-registry case) — never silently "treat as open"                                    |
| `runtime_crash_loop`     | error      | ≥N runtime errors of same signature within window                                                                   |
| `allocation_blocked`     | warn       | capital reservation/allocation gate refusing entries                                                                |

Rule: **detectors map raw evidence to conditions; the UI never shows raw stack traces as the primary line, and never shows nothing.** Unknown/unmapped failure = generic `degraded` condition with the log signature attached — a bug in detection must still surface as _something_.

### C. Infra

1. **Session activity state machine (main process).** New `SessionActivityTracker` service subscribed to the existing event-bus (`electron/main/services/` — same feed that writes `events`). Maintains per-session: `currentActivity`, `activeConditions[]`, `lastTransitionAt`. Pure consumer — zero writes into the execution path (decision 5).
2. **Detectors.** Small pure functions: (event stream + periodic sweep of `schedule_runtime_states`, `session_input_subscriptions` vs live `signal_sources`, `api_call_log` error windows) → condition set diff. The periodic sweep (60s) catches "nothing happened" conditions that event streams structurally can't emit — absence of events _is_ the signal for `no_signal_stale` and `input_source_dead`.
3. **Persistence.** `session_activity` table: `session_id`, `activity`, `conditions_json`, `updated_at` + append-only `session_activity_transitions` for history (postmortems like last night become one query). Pending decision 2.
4. **IPC.** New read channel `session:activity` (snapshot for a session / all sessions) + push event `session:activity-changed` to subscribed renderer windows. Follows existing `register.ts` / preload-bridge pattern.
5. **Notification sink.** Route ERROR + first-WARN transitions through the existing `notification-sinks` service (already present in log scopes).
6. **Fail-loud retrofit hooks.** The three silent paths found in the review must emit conditions, not just WARN logs: scheduled-scan executor failures → `data_feed_failing`; calendar registry miss → `calendar_misconfigured`; subscription-without-live-source at session start → `input_source_dead` as a **launch-gate warning**, not a discovery hours later.

### D. Explicitly out of scope (v1)

- Auto-remediation (restart source, pause session) — decision 3.
- Historical analytics dashboards over transition data.
- Per-trade progress inside a cycle (worker-level progress bars) — v2 candidate; v1 stops at cycle granularity.

## Acceptance criteria

1. Replaying 2026-07-19: within 5 minutes of session start, STRESS-01..03 show `input_source_dead` (red), STRESS-04..06 show `data_feed_failing` (red) after the first failed scan, STRESS-POLY shows `selector_rejecting_all` (yellow) by cycle 3 — each with a notification raised.
2. A healthy waiting session shows an accurate, non-alarming state ("market closed — resumes …"), not a warning.
3. Killing the detector layer (simulated) does not affect trade execution, and the UI shows a "monitoring unavailable" banner instead of stale green.
4. Every condition row links to at least one concrete evidence record (event/log id).
5. Test exercises the real journey: start session with dead input source → chip goes red → notification fires → fix source → condition clears — asserted end-to-end, not "component renders".
