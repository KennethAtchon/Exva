# Exva Debugging Guide

## Purpose

This guide is the standard operating procedure for finding root causes in Exva.
It is written so a human or an agent can follow it end-to-end without guessing.

## Scope and Architecture Context

Exva is an Electron app with strict process boundaries:

- Main process (`electron/main/**`): business logic, DB access, orchestration, IPC handlers.
- Renderer (`src/**`): UI and state stores.
- Preload bridge (`electron/preload/**`): typed, limited API surface between renderer and main.

Debugging starts by locating which boundary is failing (renderer, preload/IPC, main/service, DB, or external provider).

## Non-Negotiable Root-Cause Workflow

Follow this exact sequence. Do not skip steps.

1. **Define failure precisely**
   - Expected behavior
   - Actual behavior
   - Repro steps (minimal, deterministic)
   - Last known good (commit/date/build)
2. **Classify failure layer**
   - UI only, IPC contract, service/domain logic, DB persistence, provider integration, runtime/orchestration
3. **Collect evidence before edits**
   - App logs (stdout + log file)
   - Error codes/messages (`AppError.code`)
   - Relevant entity IDs (`sessionId`, `tradeId`, `approvalId`, IPC `channel`)
4. **Trace execution path**
   - Entry point → branch points → side effects → output
5. **Bisect path**
   - Verify midpoint state; narrow until one function/branch/line explains divergence
6. **Prove root cause**
   - Show why this cause produces the symptom
   - Show why alternatives are less likely
7. **Fix minimally and validate broadly**
   - Validate specific repro
   - Run neighboring tests and typecheck
8. **Document**
   - What broke, why, signal that proved it, guardrail test/log added

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
  - Trace `ai-runtime.ts` and `run-agent-execute.ts` telemetry (tokens, duration, finish reason)
- **Secret/provider problems**
  - Trace `secrets-service.ts` metadata logs and provider registry lookup; never inspect or print secret values

## Observability in Exva

### Logs

- Logger: `pino`
- Main logger setup: `electron/main/services/infra/log.ts`
- Streams:
  - stdout (dev runtime)
  - file: `~/.exva/logs/exva-YYYY-MM-DD.log` (7-day retention)

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

## Repeatable Debug Procedure by Layer

### 1) Renderer/UI Layer

1. Confirm state source (`src/store/**`) and selector dependencies.
2. Confirm preload API call arguments and return shape.
3. Verify UI assumptions against shared schema/domain types.
4. If UI is wrong but IPC response is correct, bug is renderer-side.

### 2) IPC Boundary

1. Find channel registration in `electron/main/ipc/register.ts`.
2. Trace handler in `electron/main/ipc/*.ts`.
3. Check `ipc invoke start/success/failure` logs:
   - `channel`
   - `durationMs`
   - payload metadata flags
4. Confirm error mapping and code propagation (`toIpcError`, wrapped code).

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

Migrations and seed data run on next boot. See also `scripts/db-reset.ts`.

## High-Value Commands

```bash
bun run dev
bun run typecheck
bun run test
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

1. Capture expected vs actual vs repro vs last-known-good.
2. Classify layer and choose first trace point.
3. Gather logs with IDs and timestamps; avoid sensitive output.
4. Trace execution path and bisect to first divergence.
5. Write a single-sentence root-cause statement with file:line.
6. Propose minimal fix + validation steps.
7. Add/adjust logs or tests to prevent recurrence.

## Debugging Anti-Patterns (Forbidden)

- Guessing and patching without reproducing.
- Adding broad fallback logic that masks failure modes.
- Logging sensitive values “just for now”.
- Mixing unrelated refactors into a debug fix.
- Declaring “fixed” without replaying the original repro.

## References

- SQLite schema and table definitions: `electron/main/db/schema.ts`
- Electron process model and boundaries: https://www.electronjs.org/docs/latest/tutorial/process-model
- Node inspector/debugger flags (`--inspect`, `--inspect-wait`, `--inspect-brk`): https://nodejs.org/api/debugger.html
- Vitest debugging flags and single-file debugging: https://vitest.dev/guide/debugging
- Pino API (levels, child loggers, multistream, destination, redaction): https://github.com/pinojs/pino/blob/main/docs/api.md
