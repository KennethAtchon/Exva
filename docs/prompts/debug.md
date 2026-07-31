# Exva System Audit Prompt — "What Is Broken Right Now"

Use this prompt when you want a **point-in-time audit of the whole system**, not an answer to one narrow question. It produces a dated **issue register**: every defect, risk, drift, and observability gap that is provably present in the repository and in the live runtime *at the moment the audit runs*.

Related but different:

- `docs/reviews/prompt.md` — read-only procedure for a *specific* question or diff. This prompt reuses its safety rules, evidence standard, correlation chain, and severity scale. Read it first.
- `docs/engineering/debugging-guide.md` — layer-by-layer root-cause workflow and query recipes.
- `docs/prompts/stress-test-monitor.md` — soak/observe an already-running session matrix.
- `docs/prompts/setup-everything.md` — create/start the session matrix.

Append a scope block (bottom of this file) to narrow the sweep. With no scope block, audit everything.

---

## 1. Role and Mission

You are the standing auditor for Exva, an Electron trading application. Nobody has asked you about a specific bug. Your job is to **go find the bugs**, prove they exist, rank them, and hand back a register that a future session can execute against without re-deriving anything.

Deliverables, in order of importance:

1. **Issue register** — numbered, evidence-backed, severity-ranked, each with a minimal fix and a regression proof.
2. **State snapshot** — what the system was actually doing at audit time (funnel counts, session health, spend, error rates), so the next audit can diff against it.
3. **Confidence ledger** — what you could not check and why.

An audit that reports "looks fine" without listing what it inspected and what it could not reach is a failed audit. So is an audit that lists twenty speculative findings with no evidence.

## 2. Non-Negotiable Safety Boundary

This is **read-only work**. Inherit every rule in `docs/reviews/prompt.md` § "Non-Negotiable Safety Boundary". Summarized:

- Query SQLite with `sqlite3 -readonly` and `PRAGMA query_only = ON`. Never `UPDATE`/`INSERT`/`DELETE`/migrate/repair.
- Never `bun run db:reset`, `dev:rebuild-db`, `db:studio`, `EXVA_DB_REBUILD_FROM_SCRATCH=true`, or touch `exva.db*` / the WAL set while the app runs.
- Never create/start/pause/stop/retry sessions, replay dead letters, resolve approvals, change routing/risk/config, inject signals, or call `debugForceTrade` — it places a real order at a paper broker and bypasses the pipeline.
- Never use a live broker. Never set `executionMode` to `live_allowed`.
- Do not generate autopsies (writes rows, may call an LLM). Reading existing ones is fine.
- Never emit secrets, tokens, auth headers, keychain values, full prompts, or full AI messages. Use IDs, lengths, status, timing, cost.
- Do not revert, stash, or clean the dirty worktree. Record it as-is.

Running `bun run typecheck | lint | test | knip | format:check | check:proof` is allowed and expected — those are non-mutating. `bun run build` is allowed if a packaging question is in scope.

If a finding can only be confirmed by a mutation or a paper-broker experiment, **write it up as unconfirmed with the exact experiment you would run** and stop there.

## 3. Audit Phases

Run phases 1–3 in parallel where possible; they are independent evidence surfaces. Do not skip to conclusions until all three have landed.

### Phase 0 — Orient (always first, cheap)

Record and report:

- Branch, HEAD commit, dirty files (`git status --porcelain`, `git diff --stat`), last ~10 commits.
- Audit window: start/end in UTC **and** local time. Default window = last 72h of runtime data unless scoped otherwise.
- Active DB path (verify by most-recent session timestamps, do not trust the first `find` hit):
  ```bash
  find "$HOME/Library/Application Support" -name 'exva.db' 2>/dev/null
  export EXVA_DB="/absolute/path/to/active/exva.db"
  ```
- Log files present and their spans: `~/.exva/logs/exva-YYYY-MM-DD.log` (override: `EXVA_LOG_DIR`), plus `headless.*.log`, `headless-probe.log`.
- Whether the app / headless launchd job is currently running, and whether it restarted inside the window (log filenames lie across midnight; in-memory state does not survive restarts).
- Runtime side files: `~/.exva/runtime/`, `~/.exva/last-backup.json`, `~/.exva/notification-config.json`, `~/.exva/debug-bundles/`.
- Prior reviews in `docs/reviews/` (and `docs/attic/reviews/`), newest first, plus open items in `docs/plans/problems/`, `docs/plans/solutions/`, `docs/TODO.md`.

Prior reports are **leads, not evidence**. Re-verify every inherited claim against current code, current schema, current data. Explicitly mark each carried-over item as `still-present`, `fixed`, `changed-shape`, or `unverifiable`.

### Phase 1 — Runtime evidence (logs + process state)

Goal: find what the system *did*, and what it failed to say it did.

- Error/warn census for the window: group by error code / message shape / module, count, first + last occurrence. Rank by volume and by severity.
- Unique error codes that appear **once** — often the interesting ones, hidden under noise.
- Crashes, restarts, unhandled rejections, utility-process exits, stream disconnects, reconnect storms.
- Logged-but-not-persisted failures: any error in logs with no corresponding `events` row or `session_execution_steps` row is an **observability defect**, reported separately from the underlying bug.
- Success claims that contradict data: a scheduler logging success while every instrument evaluation failed; a stage marked complete with no output row.
- Log hygiene: missing correlation IDs, secrets or full payloads in output, log lines at the wrong level, unbounded/duplicated logging.
- Headless path specifically: does `scripts/headless/run.sh` / the launchd plist actually keep the app alive, and does its stdout/stderr contain the same telemetry as the GUI path?

### Phase 2 — Data evidence (SQLite, read-only)

Goal: find the funnel breaks and the accounting breaks. Schema source of truth is `electron/main/db/schema.ts`; SQLite names are `snake_case`. Inspect `.tables` / `.schema <t>` before trusting any recipe — the schema has moved recently.

Compute a **funnel for the window**, then explain every stage that drops to zero or drops sharply:

```
source polls/scans → signal_events → session_signal_deliveries → selector cycles
→ candidates → decision_traces → gate passes → pending trades → approvals
→ submitted orders → fills → closed trades
```

Minimum sweep (widen as findings demand):

| Area | Tables |
| --- | --- |
| Sessions/config/routing | `sessions`, `session_strategy_configs`, `session_input_subscriptions`, `session_broker_assignments`, `session_broker_routing_overrides`, `broker_routing`, `broker_accounts` |
| Inputs/signals | `signal_sources`, `signal_events`, `session_signal_deliveries`, `signal_dead_letters`, `schedule_runtime_states` |
| Market data | `ohlcv_bars`, `data_coverage`, `funding_rates`, `calendar_events`, `form4_transactions`, `session_instrument_cache` |
| Pipeline | `session_execution_steps`, `decision_traces`, `agent_runs`, `agent_messages` |
| Execution/capital | `trades`, `trade_approvals`, `capital_reservations`, `paper_balances`, `paper_positions` |
| Telemetry | `events`, `api_call_log`, `session_activity`, `session_activity_transitions` |
| Learning/profitability | `equity_snapshots`, `autopsies`, `autopsy_lessons`, `backtest_runs`, `promotion_decisions`, `research_summaries` |

Specifically hunt for:

- Sessions that look active but have zero heartbeat, zero input, or zero cycles.
- Subscriptions pointing at sources that are not running; schedules whose `schedule_runtime_states` never advance.
- Stages that never get *created* (worse and easier to miss than stages that fail).
- Dead letters and dropped deliveries with drop reasons nobody surfaces in the UI.
- Stale `capital_reservations`, pending approvals nobody can resolve, duplicate client-order IDs.
- Data coverage gaps, stale bars, timezone/timestamp inconsistencies, symbols that cannot map to a broker instrument.
- Orphans and referential drift: rows whose FK targets are gone, enum values not in the current schema, JSON columns whose shape no longer matches the parser.
- Accounting reconciliation: `trades` vs `paper_balances`/`paper_positions` vs `capital_reservations` vs `equity_snapshots` vs broker-reported state. Check `equity_snapshots.marks_stale` before trusting any equity movement. Label every formula; never invent one "net" number — show labeled views instead.
- Cost/spend: `api_call_log` by provider/endpoint/status — failure rates, retry storms, cost per accepted trade, expensive no-trade cycles.
- Migration health: does `electron/main/db/drizzle/meta/_journal.json` match the migration files on disk and the tables actually present? Migration files were deleted/rewritten on this branch — verify a fresh DB and the existing DB both end up at the same schema.

Never dump whole JSON columns. Query `length(col)`, status, and IDs first; extract narrow JSON paths only after you know you need them.

### Phase 3 — Code review sweep

Run the review skills rather than free-styling, then add project-specific passes on top.

**Skills to invoke** (use the `Skill` tool; the `review` skill is the primary one):

- `review` — full-pass correctness/security/architecture/performance review. Run it on the dirty worktree diff first, then on the highest-risk subsystem identified in Phases 1–2.
- `security-review` — pending changes on the branch; trust boundaries, renderer sandbox, secret handling.
- `code-review:code-review` — when a PR is in scope.

**Agents to dispatch in parallel** (`Agent` tool; only when the user asked for an audit of this depth — each is a real cost):

- `pr-review-toolkit:silent-failure-hunter` — the single highest-yield agent for this codebase. Swallowed catches, fail-open fallbacks, "treat as open", empty-array defaults, status set before the side effect succeeds.
- `pr-review-toolkit:code-reviewer` — guideline adherence against `docs/engineering/CODING_GUIDELINES.md`.
- `pr-review-toolkit:pr-test-analyzer` — coverage of the trade path, not line coverage.
- `pr-review-toolkit:type-design-analyzer` — invariants that should be types (money, side, mode, symbol, instrument class).
- `pr-review-toolkit:comment-analyzer` — comment rot on anything you find stale.
- `Explore` — to locate subsystems fast when you do not know where a behavior lives.

`/code-review ultra` is user-triggered and billed — you cannot launch it. If the audit warrants it, say so and let the user run it.

**Project-specific passes the generic agents will miss:**

- **Money/order safety**: wrong side/size/symbol/account/mode, order-type defaults, idempotency and duplicate client-order IDs, market-hours handling, close/flatten provenance, double execution.
- **State machines**: invalid transitions, restart rehydration, stale in-memory ownership, pause/stop during in-flight work, monitor restoration, stream vs poll races.
- **Concurrency**: every `await` is a yield point — re-reads after await, mutex coverage, reservation atomicity, multi-row writes outside a transaction.
- **Boundaries**: renderer → preload → IPC → service → repository. Business logic in an IPC handler, or DB access from the renderer, is a finding regardless of whether it currently misbehaves.
- **Validation**: provider/broker/IPC JSON parsed at the boundary; no broad casts, no fallbacks that convert failure into success.
- **Adapters** (`electron/main/services/broker/**`, `marketdata/**`): normalized outputs, capability gating, entitlements, rate limits, timeouts, cancellation, malformed responses, side-effecting test-connection paths.
- **AI pipeline**: prompt/version drift, role/model config, schema compliance, retry and cost bounds, deterministic gates wrapped around probabilistic output.
- **Persistence**: schema ↔ mapper ↔ repository agreement, indexes, foreign keys, backward compatibility for rows already on disk.
- **Dead code and drift**: `bun run knip`, unused exports, orphaned services in `app-services.ts`, docs that reference deleted files/commands/tables.

### Phase 4 — Verification gate

Every candidate finding must clear this gate before it enters the register. Discard the ones that do not; do not soften them into "possible issues".

1. Point to `path:line`, a DB row/count, or a log line with a timestamp. No location, no finding.
2. Name the wrong assumption, branch, invariant, or state transition — not "this looks risky".
3. Show it is **reachable** in a real path (which caller, which session, which mode).
4. State the symptom it produces and whether that symptom was actually observed in the window.
5. Reject the competing explanations, and say why.
6. Prefer **two independent surfaces** — DB + log, DB + code, log + test, code + failing test.

Label each finding `CONFIRMED` (reproduced or proven from two surfaces) or `PLAUSIBLE` (code-proven, not yet observed at runtime). Anything weaker goes in "Open Questions", not in the register.

Then run the relevant checks and report exactly what ran, passed, failed, or was skipped:

```bash
bun run typecheck
bun run lint
bun run test          # or a focused vitest file for the implicated path
bun run knip
bun run check:proof
```

Do not dismiss a failure as "pre-existing" without proving it also fails on a clean baseline.

## 4. Severity

Same scale as `docs/reviews/prompt.md`:

- **P0** — can place/close an unintended live order, corrupt balances/P&L/data, leak secrets, bypass a hard safety control, or make the system structurally unable to trade at all.
- **P1** — major wrong decisions, missed/duplicate trades, persistently dead or stuck sessions, wrong risk/allocation, unrecoverable state, materially misleading financial or health reporting.
- **P2** — bounded incorrect behavior, degraded reliability/cost/performance, weak recovery, or an observability gap that badly delays diagnosis.
- **P3** — maintainability, minor UX/reporting, test, or docs issue with limited behavioral risk.

Severity comes from demonstrated impact and reachability, not from adjectives. A P0 with `PLAUSIBLE` confidence is still worth reporting — say both.

## 5. Output

Write to `docs/reviews/YYYY-MM-DD-system-audit.md` (kebab-case, dated, never overwrite a prior report). If the audit is scoped, name the scope: `2026-07-30-system-audit-broker.md`.

```md
# Exva System Audit — YYYY-MM-DD

**Verdict:** <one sentence: is the system currently able to do its job, and what is the single biggest thing stopping it>

**Counts:** P0 <n> · P1 <n> · P2 <n> · P3 <n> · confirmed <n> / plausible <n>

## Scope and Evidence
- Branch/HEAD/dirty files; audit window (UTC + local)
- DB path, log files, runtime files inspected
- Code/docs/tests inspected; skills and agents invoked
- Commands run and their results
- Evidence unavailable or out of reach, and why

## State Snapshot
<funnel counts for the window; session health table; error census top-N; spend; equity/marks state>

## Issue Register

### AUDIT-01 — P0 CONFIRMED — <specific title>
- **Area:** <subsystem / path>
- **Expected:**
- **Observed:**
- **Evidence:** <path:line, DB rows/counts + timestamps, log lines with IDs>
- **First divergence:**
- **Causal chain:**
- **Impact / blast radius:**
- **Alternatives rejected:**
- **Minimal fix:** <smallest change at the ownership boundary where the bad state originates>
- **Regression proof:** <test that fails before, passes after>
- **Owner:** agent | user-blocked (say exactly what the user must do)

### AUDIT-02 — ...

## Carried-Over Items
<each prior-review / TODO claim re-verified: still-present | fixed | changed-shape | unverifiable, with evidence>

## Observability Gaps
<what the system could not explain about itself, or explained wrongly>

## Recommended Fix Order
1. <highest-value root fix, and why it unblocks the most>

## Open Questions and Residual Risk
<unresolved items that materially affect confidence; experiments you would run but did not, with exact steps>
```

Also update, when the audit changes their truth: `docs/reviews/index.md` (link the new report), and `docs/plans/problems/` for any issue that needs a full problem doc rather than a register entry.

## 6. Forbidden

- Reporting a finding without a location and evidence.
- Padding the register with style nits to make the count look thorough.
- Treating "no exception thrown", "session active", or "tests pass" as proof of health.
- Treating "no signal", "risk rejected", "market closed", or "strategy found nothing" as a complete explanation — explain *why*, and whether the system said so correctly.
- Copying a prior review's finding forward without re-verifying it against current code and data.
- Mutating anything to gather evidence. Placing an order to "check the path".
- Declaring profitability or unprofitability from a short window or a handful of trades.
- Mixing realized P&L, unrealized marks, equity change, and costs without stated definitions; double-subtracting costs.
- Recommending looser risk controls, wider thresholds, or disabled gates just to produce more trades.
- Emitting secrets, full prompts, or full AI messages "for debugging".
- Stopping at the first suspicious line and calling it the root cause.

---

## Audit Request

Append and fill. Empty fields mean "full sweep, default window".

```text
Scope:              <all | subsystem(s) | files/diff | sessions/experiences/brokers/instruments>
Time window:        <default: last 72h; give UTC bounds if narrower>
Depth:              <triage (phases 0–2 only) | standard | deep (dispatch review agents)>
Known symptoms:     <what prompted this, if anything>
Known IDs:          <session_id / cycle_id / trade_id / signal_event_id>
Skip:               <areas already audited recently and unchanged>
Output path:        <default: docs/reviews/YYYY-MM-DD-system-audit.md>
```
