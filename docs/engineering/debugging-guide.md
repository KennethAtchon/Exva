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

### 5) External Provider Layer (AI/Search/Broker)

1. Confirm account/route resolution (without printing secrets).
2. Confirm adapter selected and request shape.
3. Check latency, finish reason, and retry behavior.
4. Distinguish provider failure vs local validation failure.

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

- Electron process model and boundaries: https://www.electronjs.org/docs/latest/tutorial/process-model
- Node inspector/debugger flags (`--inspect`, `--inspect-wait`, `--inspect-brk`): https://nodejs.org/api/debugger.html
- Vitest debugging flags and single-file debugging: https://vitest.dev/guide/debugging
- Pino API (levels, child loggers, multistream, destination, redaction): https://github.com/pinojs/pino/blob/main/docs/api.md
