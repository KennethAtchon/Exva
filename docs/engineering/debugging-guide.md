# Exva Debugging Guide

> **Procedure authority:** This guide defines how to investigate. The signal,
> correlation, safety, and evidence-bundle requirements are defined in the
> [Observability Contract](./observability-guide.md).
> **Last verified:** 2026-07-21.

## Purpose

This is the standard operating procedure for finding root causes in Exva. It
prevents guessing; it cannot recover evidence that the application never emitted.
If a required signal is absent, report **not currently observable** and name the
instrumentation gap instead of inferring causality from nearby timestamps.

## Scope and Architecture Context

Exva is an Electron app with strict process boundaries:

- Main process (`electron/main/**`): business logic, DB access, orchestration, IPC handlers.
- Renderer (`src/**`): UI and state stores.
- Preload bridge (`electron/preload/**`): typed, limited API surface between renderer and main.

Debugging starts by locating which boundary is failing (renderer, preload/IPC, main/service, DB, or external provider).

## Investigation Output

Every investigation must produce:

```text
symptom and invariant violated
exact build/boot and time window
trace/domain correlation keys used
first divergent operation and supporting evidence IDs
root cause with code location
alternatives rejected and why
observability gaps that limited confidence
minimal fix
reproduction and verification results
```

Confidence is `high` only when a causal ID/link connects the evidence. Timestamp
proximity without correlation is circumstantial and must be labeled as such.

## Non-Negotiable Root-Cause Workflow

Follow this exact sequence. Do not skip steps.

1. **Freeze the incident scope**
   - Expected behavior
   - Actual behavior
   - Repro steps (minimal, deterministic)
   - First/last observed UTC timestamp
   - App version, commit/build ID, environment mode, platform
   - Last known good commit/date/build
2. **Collect before changing or restarting**
   - Export Bundle V2 if available; inspect its scope coverage and warnings
   - Preserve logs and IDs; do not dump prompts/messages or copy a live DB file
   - Record every missing/truncated section and collection error
3. **Classify failure layer**
   - UI only, IPC contract, service/domain logic, DB persistence, provider integration, runtime/orchestration
4. **Build the correlation set**
   - App logs (stdout + log file)
   - Error codes/messages (`AppError.code`)
   - Available IDs: `sessionId`, `cycleId`, `tradeId`, `approvalId`, `agentRunId`, `clientOrderId`, `brokerOrderId`, schedule/source IDs
   - Causal IDs: `traceId`, `spanId`, `parentSpanId`, `ipcInvocationId`, `utilityRequestId`, and `bootId` in structured logs
5. **Trace execution path**
   - Entry point → branch points → side effects → output
   - Mark where evidence is authoritative, inferred, or absent
6. **Find the first divergence**
   - Verify midpoint state; narrow until one function/branch/line explains divergence
   - Later failures are consequences, not the root cause
7. **Prove root cause**
   - Show why this cause produces the symptom
   - Show why alternatives are less likely
8. **Fix minimally and validate broadly**
   - Validate specific repro
   - Run neighboring tests, typecheck, and the matching failure injection
9. **Close the evidence gap**
   - Add the smallest signal/test that would have made first divergence obvious
   - Update the observability failure matrix if the gap is structural

## Fast Triage Matrix

Use this matrix to choose your first trace point.

- **UI stale/wrong data**
  - Check store update path in `src/store/**`
  - Check preload call + IPC channel mapping
- **Action fails with user-visible error**
  - Start at `electron/main/ipc/handle.ts`, inspect `channel`, `code`, `durationMs`
- **Session won’t start/pause/resume/stop**
  - Start at `electron/main/services/session/session-runtime-manager.ts`
- **No trade opened / unexpected rejection**
  - Trace `agent-orchestrator.ts` → `risk-engine.ts` → broker routing/place order
- **AI behavior/cost/latency issue**
  - Trace `electron/main/services/llm/runtime.ts`, pipeline execution, and `run-agent-execute.ts`; join `agent_runs`, `agent_messages`, and `api_call_log`
- **Secret/provider problems**
  - Trace `secrets-service.ts` metadata logs and provider registry lookup; never inspect or print secret values

## Observability in Exva

### Evidence order

Use evidence in this order:

1. Crash/load/process artifacts when the process or window disappeared.
2. Domain state in SQLite for durable workflow truth.
3. Structured logs for branch, stack, and dependency detail.
4. Replay fixtures for deterministic proof.
5. Source inspection to map evidence to code.

Do not treat the Developer Workbench as a complete evidence store. Its current
event pagination/filtering and debug-bundle behavior have known gaps documented in
the [Verified Gap Register](./observability-guide.md#12-verified-gap-register).

### Logs

- Logger: `pino`
- Main logger setup: `electron/main/services/infra/log.ts`
- Streams:
  - stdout (dev runtime)
- file: `~/.exva/logs/exva-YYYY-MM-DD.log` (7-day retention)
- override directory: `EXVA_LOG_DIR`

Recommended runtime flags:

```bash
EXVA_LOG_LEVEL=debug bun run dev
```

For deeper traces:

```bash
EXVA_LOG_LEVEL=trace bun run dev
```

### Safe logging policy

- Never log keys, tokens, passwords, auth headers, cookies, full prompt/message bodies.
- Log metadata only: length/size, boolean detection flags, IDs, result state.
- See `docs/engineering/logging-guide.md` for full policy.

Primary LLM and provider-retry paths emit metadata instead of raw AI/provider
content. Raw logs still require review because retained-sink leak scanning is not
comprehensive across every application path.

### Evidence Bundle V2 limitations

`developer:export-debug-bundle` exports bounded runtime/DB health, events,
execution steps, decision traces, runs/messages, calls, trades, approvals,
schedules, and source state. Prompt/tool content is independently opt-in and the
manifest declares scope coverage. It does not collect ordinary logs, crash dumps,
durable traces, telemetry health, or replay fixtures; a successful export does not
mean evidence is complete.

## Repeatable Debug Procedure by Layer

### 1) Renderer/UI Layer

1. Confirm state source (`src/store/**`) and selector dependencies.
2. Confirm preload API call arguments and return shape.
3. Verify UI assumptions against shared schema/domain types.
4. If UI is wrong but IPC response is correct, bug is renderer-side.
5. For crashes/hangs/load failures, search `runtime.render_process_gone`,
   `runtime.did_fail_load`, `runtime.preload_error`, `runtime.window_unresponsive`,
   renderer exception/rejection, bootstrap, and React-boundary diagnostics. The
   durable event marker links by incident and boot ID; detailed envelopes remain
   in logs, not the bundle.

### 2) IPC Boundary

1. Find channel registration in `electron/main/ipc/register.ts`.
2. Trace handler in `electron/main/ipc/*.ts`.
3. Check `ipc invoke start/success/failure` logs:
   - `channel`
   - `durationMs`
   - payload metadata flags
4. Confirm error mapping and code propagation (`toIpcError`, wrapped code).
5. A start without a terminal record is ambiguous because invocation IDs,
   deadlines, and an inflight registry are not implemented. Reproduce under a
   focused test rather than matching by channel and time alone.

### 3) Service/Domain Layer

1. Identify service entry method.
2. Check preconditions and status guards.
3. Verify branching decisions with logs and state snapshots.
4. Confirm side effects are atomic where required (transactions, reservations, status updates).

### 4) Database Layer

1. Trace repository method called.
2. Verify schema assumptions and mapper transformations (`snake_case` ↔ `camelCase`).
3. Confirm transaction boundaries for multi-write flows.
4. Validate persistence outcome by re-reading canonical row(s).
5. If logs are inconclusive, query the runtime SQLite DB directly — see [Querying the SQLite Database](#querying-the-sqlite-database).

### 5) External Provider Layer (AI/Search/Broker)

1. Confirm account/route resolution (without printing secrets).
2. Confirm adapter selected and request shape.
3. Check latency, finish reason, and retry behavior.
4. Distinguish provider failure vs local validation failure.
5. Account for every attempt using `api_call_log.call_type='llm_attempt'`. A
   successful retry does not erase failed-attempt latency or provider outcome;
   attempt-level tokens and cost are still incomplete.
6. **Stop before retrying an order with an unknown outcome.** If placement timed
   out or disconnected after submission may have begun, query/reconcile the broker
   using `clientOrderId` and `brokerOrderId`. Do not submit another live order
   until the first attempt is proven rejected/absent or the idempotency contract
   guarantees the retry cannot duplicate the side effect.

### 6) Utility Process Layer

1. Start at `utility-process-runtime-host.ts` and
   `utility-process-session-runtime.ts`.
2. Correlate by `sessionId`, `traceId`, and `utilityRequestId` in structured logs.
3. Check sanitized worker stderr, `utility.command.timeout`,
   `utility.heartbeat.missed`, exit records, and durable runtime-diagnostic events.
4. Normal commands and worker RPCs time out after 30 seconds; approval rechecks
   time out after five minutes. Heartbeats run every 15 seconds and terminate the
   worker after three unanswered probes.
5. If the bundle lacks logs, use the durable incident marker but report missing
   last-pong age, active-command state, and restart history as evidence gaps.

### 7) Scheduler and Signal Source Layer

1. Query `schedule_runtime_states` for due time, start/finish/success, duration,
   consecutive failures, and last scan summary.
2. Query `signal_source_runtime_states` and `signal_source_polls` to distinguish a
   quiet feed from a failed poll.
3. Compare `next_run_at` with current UTC time. An overdue row is suspicious but
   not proof of a lost tick because a missed-fire detector is not implemented.
4. Check system sleep, timezone, wall-clock jump, and market calendar assumptions.
   Current telemetry does not retain all of these facts.

## Querying the SQLite Database

Use direct SQL when you need ground truth about persisted state — especially when logs and UI disagree, or when a cycle failed before surfacing a user-visible error.

Schema source of truth: `electron/main/db/schema.ts`. Table and column names in SQLite are `snake_case`.

### DB location

The DB file is `exva.db`, created on boot by `electron/main/db/client.ts`:

- Default path: `{userData}/exva.db` where `userData` is Electron `app.getPath("userData")`.
- Override: set `EXVA_DB_PATH` before starting the app.

On macOS during local dev, the file is usually under `~/Library/Application Support/exva/exva.db`. Packaged builds may use a different parent folder name; do not hardcode one path across machines.

Find the active file:

```bash
find "$HOME/Library/Application Support" -name 'exva.db' 2>/dev/null
```

Set a shell variable for the recipes below:

```bash
export EXVA_DB="$HOME/Library/Application Support/exva/exva.db"
# or: export EXVA_DB="/path/from/find/or/EXVA_DB_PATH"
```

### Safety rules

- **Read-only by default.** Use `SELECT` queries. Do not `UPDATE`, `DELETE`, or `INSERT` against a live dev DB unless you are deliberately repairing state.
- **WAL mode.** While the app is running, SQLite uses WAL (`exva.db-wal`, `exva.db-shm`). Reads still work; avoid copying or deleting the DB mid-session.
- **No secrets in output.** `broker_accounts` and `provider_accounts` store `secret_ref` pointers to the OS keychain — not the secret values. Still avoid dumping `metadata_json`, `messages_json`, or other large payloads into chat logs unless you need them and they are safe to share.
- **Prefer IDs from logs first.** Collect `sessionId`, `tradeId`, `cycleId`, or `approvalId` from pino/IPC logs, then query by those keys.
- **Do not open the original as an incident experiment.** SQLite may recover or
  checkpoint WAL state on open/close. Analyze a verified backup or duplicate.
- **Integrity has two dimensions.** `PRAGMA quick_check` is a fast screen, not a
  complete proof. `PRAGMA integrity_check` does not check foreign keys; run
  `PRAGMA foreign_key_check` separately on an offline/read-only duplicate.

### Debug workflow

Follow this chain after you have at least one entity ID from logs or the UI:

1. **Confirm the entity exists** — session/trade/approval row and its `status`.
2. **Walk the cycle** — `session_execution_steps` and `decision_traces` for the same `cycle_id`.
3. **Check side effects** — trades, `trade_approvals`, `capital_reservations`, signal delivery rows.
4. **Correlate telemetry** — `events`, `agent_runs`, `api_call_log` for the same IDs and time window.
5. **Compare to code path** — map the row state to the service/repository you traced in step 4 of the root-cause workflow.

### Table map by symptom

| Symptom                            | Start here        | Then check                                                                     |
| ---------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| Session won't start / stuck status | `sessions`        | `session_execution_steps`, `session_broker_assignments`, `session_risk_config` |
| Signal not reaching session        | `signal_events`   | `session_signal_deliveries`, `session_signal_sources`                          |
| Trade not opened / rejected early  | `decision_traces` | `session_execution_steps`, `trades`, `trade_approvals`                         |
| Open trade wrong or missing exit   | `trades`          | `capital_reservations`, `events`                                               |
| AI cost / latency / wrong output   | `agent_runs`      | `agent_messages`, `api_call_log`                                               |
| Provider or broker call failed     | `api_call_log`    | `broker_accounts` (metadata only), `events`                                    |
| UI event log mismatch              | `events`          | matching `agent_runs` / `trades` for same `session_id`                         |

### Query recipes

List tables:

```bash
sqlite3 "$EXVA_DB" ".tables"
```

Read-only operational health snapshot:

```bash
sqlite3 -readonly -header -column "$EXVA_DB" "
SELECT sqlite_version() AS sqlite_version;
PRAGMA journal_mode;
PRAGMA synchronous;
PRAGMA quick_check;
PRAGMA foreign_key_check;
"
```

Do not run `wal_checkpoint`, including `NOOP`, while preserving live incident
evidence: it is not read-only and fails through a read-only connection or may
checkpoint frames through a writable one. WAL frame/backlog state must come from
dedicated application telemetry or a preserved duplicate. Run full
`integrity_check` on a backup, not as routine work against the active app database.

Schema for one table:

```bash
sqlite3 "$EXVA_DB" ".schema trades"
```

Row counts (quick health check):

```bash
sqlite3 -header -column "$EXVA_DB" "
SELECT 'sessions' AS tbl, COUNT(*) AS n FROM sessions
UNION ALL SELECT 'trades', COUNT(*) FROM trades
UNION ALL SELECT 'agent_runs', COUNT(*) FROM agent_runs
UNION ALL SELECT 'events', COUNT(*) FROM events;
"
```

Sessions (find ID by name or list recent):

```bash
sqlite3 -header -column "$EXVA_DB" "
SELECT id, name, status, execution_mode, experience_id, updated_at
FROM sessions
ORDER BY updated_at DESC
LIMIT 20;
"
```

Replace `<session-id>` in the queries below.

Trades for a session:

```bash
sqlite3 -header -column "$EXVA_DB" "
SELECT id, instrument_symbol, side, status, position_size_usd,
       entry_price, exit_reason, opened_at, closed_at, created_at
FROM trades
WHERE session_id = '<session-id>'
ORDER BY created_at DESC
LIMIT 30;
"
```

Execution steps for the latest cycle (or filter by `cycle_id` from logs):

```bash
sqlite3 -header -column "$EXVA_DB" "
SELECT cycle_id, stage, status, outcome, last_error_code,
       last_error_message, started_at, completed_at
FROM session_execution_steps
WHERE session_id = '<session-id>'
ORDER BY created_at DESC
LIMIT 40;
"
```

Decision trace for a cycle (includes full JSON in `trace_json`):

```bash
sqlite3 -header -column "$EXVA_DB" "
SELECT cycle_id, trade_id, instrument_symbol, created_at, length(trace_json) AS trace_bytes
FROM decision_traces
WHERE session_id = '<session-id>'
ORDER BY created_at DESC
LIMIT 10;
"
```

Recent events for a session (mirrors much of what the Dev Panel shows):

```bash
sqlite3 -header -column "$EXVA_DB" "
SELECT created_at, level, agent_type, message, trade_id, cycle_id
FROM events
WHERE session_id = '<session-id>'
ORDER BY created_at DESC
LIMIT 50;
"
```

Agent runs for a trade or session:

```bash
sqlite3 -header -column "$EXVA_DB" "
SELECT id, agent_type, model, finish_reason,
       input_tokens, output_tokens, cost_usd, duration_ms, created_at
FROM agent_runs
WHERE session_id = '<session-id>'
ORDER BY created_at DESC
LIMIT 20;
"
```

Signal pipeline (event → session delivery):

```bash
sqlite3 -header -column "$EXVA_DB" "
SELECT se.id, se.ticker, se.dispatch_status, se.detected_at,
       ssd.session_id, ssd.status, ssd.drop_reason, ssd.trade_id
FROM signal_events se
LEFT JOIN session_signal_deliveries ssd ON ssd.signal_event_id = se.id
ORDER BY se.detected_at DESC
LIMIT 20;
"
```

Pending trade approvals:

```bash
sqlite3 -header -column "$EXVA_DB" "
SELECT id, session_id, trade_id, instrument_symbol, proposed_side,
       proposed_size_usd, status, requested_at
FROM trade_approvals
WHERE status = 'pending'
ORDER BY requested_at DESC;
"
```

Broker/provider accounts (metadata only — no keychain values):

```bash
sqlite3 -header -column "$EXVA_DB" "
SELECT id, name, broker_type, mode, balance_cache_usd, balance_cached_at
FROM broker_accounts;
"

sqlite3 -header -column "$EXVA_DB" "
SELECT id, name, category, provider_type, is_configured, last_test_status
FROM provider_accounts;
"
```

Export one row as JSON (useful for nested `*_json` columns):

```bash
sqlite3 -json "$EXVA_DB" "
SELECT * FROM trades WHERE id = '<trade-id>';
"
```

### Wiping the DB during dev

Only when you intentionally want a clean slate — stop the app first:

```bash
rm "$EXVA_DB" "${EXVA_DB}-wal" "${EXVA_DB}-shm" 2>/dev/null
```

Migrations and seed data run on next boot. See also `scripts/db/reset.ts`.

## High-Value Commands

```bash
bun run dev
bun run typecheck
bun run test
bun run test:e2e
bun run check
bun run test -- electron/main/services/session/__tests__/runtime-manager.test.ts
EXVA_LOG_LEVEL=debug bun run dev
```

If debugging test hangs/timeouts, run focused tests and avoid watch-mode noise.

## Playbooks for Common Exva Failures

### Session start fails

1. Check `main` startup logs.
2. Check runtime manager logs for `runtime start failed`.
3. Check preflight checks under `electron/main/services/session/preflight/**`.
4. Validate provider credentials/search provider/broker reachability/capital checks.

### Trade rejected unexpectedly

1. Trace orchestrator cycle for target `sessionId` + `tradeId`.
2. Inspect risk logs in `risk-engine.ts` (denial reason, size reductions).
3. Confirm instrument conflict and broker routing constraints.
4. Confirm approval flow state if human approval is enabled.

### AI run is expensive or slow

1. Use `ai-runtime` and `run-agent-execute` logs:
   - `inputTokens`, `outputTokens`, `durationMs`, `costUsd`, finish reason
2. Check retries/backoff behavior.
3. Verify prompt size flags and step caps.
4. Compare across roles (`technical`, `fundamental`, `reviewer`, `decision_maker`, `instrument_selector`).

### IPC call succeeds but UI still wrong

1. Confirm IPC success log + expected payload shape.
2. Verify renderer store reducer/merge path.
3. Check stale state race (polling overwrites, optimistic updates, focus/session switch).

### Blank, crashed, or frozen window

1. Preserve main logs and Playwright artifacts before relaunching.
2. Reproduce with renderer devtools and capture console/network evidence.
3. Check preload path, sandbox/context-isolation assumptions, and packaged asset
   path in `electron/main/window.ts`.
4. Record that Electron `did-fail-load`, `render-process-gone`, `unresponsive`,
   and renderer global exception envelopes are not implemented. Without a repro,
   the original cause may be unresolvable.

### Session or utility process stalls

1. Find the newest `running` execution step and calculate its age.
2. Check utility exit/stderr records and runtime/session status.
3. Determine whether the external dependency has a deadline.
4. Do not call a stale step “slow” or “dead” without heartbeat/progress evidence;
   current command deadline and last-pong telemetry is incomplete.

### Schedule appears not to fire

1. Inspect `schedule_runtime_states` and its subscription IDs.
2. Inspect source runtime state/polls and session activity conditions.
3. Compare due time and actual start time in UTC.
4. If `next_run_at` is overdue with no start record, report a probable missed fire
   plus the missing missed-tick/clock-jump evidence, not a proven timer root cause.

### Packaged-only failure

1. Prove the E2E harness launched the packaged artifact, not its source fallback.
2. Capture platform/arch, Electron/app versions, commit/build ID, artifact hash,
   resource paths, DB migration head, and crash/load artifacts.
3. Current packaging does not guarantee all of that provenance. Unknown build
   identity blocks high-confidence comparison with a source checkout.

## What “Root Cause Found” Means

A root cause statement must include:

- Exact code location (`path:line`)
- Specific bad assumption/state transition
- Why this causes the observed symptom
- Why adjacent paths are not the primary cause

Example format:

`In electron/main/services/session/session-runtime-manager.ts:54, status is persisted before runtime initialization success. On initialize failure, DB state can remain mismatched, causing subsequent resume logic to operate on stale status.`

## Agent Checklist (Copy/Paste)

Use this checklist verbatim for debugging tasks:

1. Freeze expected, actual, invariant, UTC window, build, boot, and last known good.
2. Collect evidence before restart/edit; list missing bundle sections and safety risks.
3. Classify the layer and assemble all available causal/domain IDs.
4. Trace from root operation to side effect; label facts, inferences, and unknowns.
5. Find the first divergence, not the loudest downstream error.
6. Write one root-cause sentence with `path:line` and evidence IDs.
7. Reject alternatives explicitly; do not use timestamp adjacency as causality.
8. Apply the minimal fix and replay the original reproduction/failure injection.
9. Add the signal/test that would have made the first divergence immediate.
10. Return unresolved ambiguity as `not currently observable`, never as certainty.

## Debugging Anti-Patterns (Forbidden)

- Guessing and patching without reproducing.
- Adding broad fallback logic that masks failure modes.
- Logging sensitive values “just for now”.
- Mixing unrelated refactors into a debug fix.
- Declaring “fixed” without replaying the original repro.
- Treating missing logs, events, rows, or heartbeats as proof that work did not happen.
- Correlating independent operations only because timestamps are close.
- Restarting, resetting, or opening the original DB before preserving volatile evidence.
- Claiming a debug bundle is complete without checking its manifest and omissions.

## References

- SQLite schema and table definitions: `electron/main/db/schema.ts`
- Electron process model and boundaries: https://www.electronjs.org/docs/latest/tutorial/process-model
- Node inspector/debugger flags (`--inspect`, `--inspect-wait`, `--inspect-brk`): https://nodejs.org/api/debugger.html
- Vitest debugging flags and single-file debugging: https://vitest.dev/guide/debugging
- Pino API (levels, child loggers, multistream, destination, redaction): https://github.com/pinojs/pino/blob/main/docs/api.md
- Exva observability contract and known gaps: [observability-guide.md](./observability-guide.md)
- Electron crash/process events: https://electronjs.org/docs/latest/api/app
- Electron crash reporter: https://electronjs.org/docs/latest/api/crash-reporter
- SQLite PRAGMA semantics: https://sqlite.org/pragma.html
- SQLite WAL behavior: https://sqlite.org/wal.html
