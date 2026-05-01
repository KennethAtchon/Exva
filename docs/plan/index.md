# Exva — Workspace & Session Management: Implementation Plan

> Grounded in: `docs/specs/workspace-session-and-model-management.md`
> Codebase state as of: 2026-04-29
> Breaking changes: permitted. No backward-compat layer required.
>
> **Authoritative implementation rules:** [`CODING_GUIDELINES.md`](./CODING_GUIDELINES.md) — every phase doc and every PR must include the line `Implements: docs/plan/CODING_GUIDELINES.md`.
> **Pre-implementation review:** [`docs/reviews/plan-deep-dive-2026-04-30.md`](../reviews/plan-deep-dive-2026-04-30.md) — resolve all P0 items before starting Phase 0.

## Current State Summary


| Concern           | Current                                                            | Target                                                                 |
| ----------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Sessions          | One global singleton (`session_config` id=1, `session_state` id=1) | Multiple named sessions, one focused at a time                         |
| Runtime ownership | One singleton orchestrator/monitor path                            | `SessionRuntimeManager` with one long-lived runtime per active session |
| Instruments       | `asset TEXT` column, hardcoded `["SPY","QQQ"]` watchlist           | `instrument_symbol`, `instrument_type`, per-session scope              |
| Brokers           | Single Alpaca adapter, one keychain entry                          | Multiple broker accounts, per-class routing                            |
| AI providers      | Hardcoded Anthropic, fixed model map in `AiSdkService`             | Per-role provider+model, multiple providers                            |
| Search providers  | Web search toggle only                                             | Workspace default + optional per-session override                      |
| Prompts           | Inline strings inside `AiSdkService`                               | Versioned Markdown assets loaded at runtime                            |
| Workspace mode    | Always "session" (one)                                             | `session` (focused) or `global` (aggregate)                            |
| Approval queue    | In-memory `Map` in orchestrator, lost on restart                   | Persisted `trade_approvals` table                                      |
| Templates         | None                                                               | `session_templates` table                                              |


## Phases


| #   | File                                                                   | Title                                   | Scope                                          |
| --- | ---------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| 0   | [phase-00-runtime-management.md](./phase-00-runtime-management.md)     | Session Runtime Management              | Runtime ownership, lifecycle, restart behavior |
| 1   | [phase-01-session-ownership.md](./phase-01-session-ownership.md)       | Session Ownership Model                 | Types, DB schema design, domain rules          |
| 2   | [phase-02-db-migration.md](./phase-02-db-migration.md)                 | Singleton → Session-Scoped Persistence  | Drizzle schema, migrations, repo layer         |
| 3   | [phase-03-instrument-rename.md](./phase-03-instrument-rename.md)       | Asset → Instrument Rename               | Find/replace across types, DB, UI, repos       |
| 4   | [phase-04-sessions-page.md](./phase-04-sessions-page.md)               | Sessions Page + Workspace Context       | IPC, UI, global/session mode                   |
| 5   | [phase-05-strategy-ai-roles.md](./phase-05-strategy-ai-roles.md)       | Strategy Page — Per-Role AI Config      | UI expansion, IPC, edit-lock                   |
| 6   | [phase-06-approval-queue.md](./phase-06-approval-queue.md)             | Persisted Approval Queue                | DB, IPC, orchestrator wiring                   |
| 7   | [phase-07-ai-providers-prompts.md](./phase-07-ai-providers-prompts.md) | AI Provider Abstraction + Prompt Assets | Multi-provider, Markdown prompt loader         |
| 8   | [phase-08-broker-routing.md](./phase-08-broker-routing.md)             | Broker Accounts + Instrument Routing    | Multi-broker, adapter abstraction, routing     |
| 9   | [phase-09-instrument-selector.md](./phase-09-instrument-selector.md)   | Instrument Selector Role + AI Universe  | New agent role, session definition flow        |
| 10  | [phase-10-services-refactor.md](./phase-10-services-refactor.md)       | Services Layer Refactor                 | Domain subfolder split                         |


## Dependency Order

```
Phase 0 (runtime) → Phase 1 (types) → Phase 2 (DB) → Phase 3 (rename)
                                                       ↓
Phase 4 (Sessions UI) ← must have session tables + runtime lifecycle shape
Phase 5 (Strategy AI) ← depends on Phase 4 + Phase 7
Phase 6 (Approvals)   ← depends on Phase 0 + Phase 2 + Phase 4
Phase 7 (AI providers)← Phase 2 prerequisite
Phase 8 (Brokers)     ← depends on Phase 0 + Phase 2
Phase 9 (Selector)    ← depends on Phase 0 + Phase 7 + Phase 8
Phase 10 (Refactor)   ← can run after Phase 6; enables cleaner 7–9
```

## Pre-Implementation Checklist

All items from the deep-dive review (`docs/reviews/plan-deep-dive-2026-04-30.md`) have been resolved in their owning phase docs as of 2026-04-30.

**P0 (blocking):**
- [x] P0.1 — `electron/shared/errors.ts` added to Phase 1.
- [x] P0.2 — Edit-Lock Matrix added to Phase 1.
- [x] P0.3 — Anthropic/OpenAI adapter pseudocode fixed in Phase 7 (`createAnthropic`, `createOpenAI`).
- [x] P0.4 — Focus-singleton triggers + CHECK constraints added to Phase 2 raw DDL.
- [x] P0.5 — `OrchestratorDeps` + per-session constructor added to Phase 0.
- [x] P0.6 — Capital-reservation lifecycle diagram + method list added to Phase 8.

**P1:**
- [x] P1.1 — `session-broker-assignments-repo.ts` moved to Phase 2.
- [x] P1.2 — `globalCapitalPoolUsd` conditional validation added to Phase 4.
- [x] P1.3 — Trade-status legal values enumerated + CHECK in Phase 2.
- [x] P1.4 — Search-provider files + tool wiring added to Phase 7.
- [x] P1.5 — OpenCode dynamic-models decision: free-text input.
- [x] P1.6 — Mock adapter `supportedInstrumentClasses` declared in Phase 8.
- [x] P1.7 — Session-Start Preflight Pipeline added to Phase 0.
- [x] P1.8 — Pause-cancellation yield-point rule added to Phase 0.
- [x] P1.9 — Templates IPC contracts inlined in Phase 4.
- [x] P1.10 — `SessionTemplatePayload` interface defined in Phase 1.

**P2:**
- [x] P2.1 — Test infra files added to Phase 0.
- [x] P2.2 — ESLint/Prettier/husky added to Phase 0.
- [x] P2.3 — Logging conventions referenced in Phase 0 + `services/log.ts` created.
- [x] P2.4 — Renderer event subscription API documented in Phase 4.
- [x] P2.5 — `workspace_preferences.updated_at` default added to Phase 2 DDL.
- [x] P2.6 — FK on `session_instrument_cache.selectorAgentRunId` added in Phase 9.
- [x] P2.7 — Events catalog added to Phase 0.
- [x] P2.8 — Prompt path resolution added to Phase 5.
- [x] P2.9 — Phase 3 grep checklist expanded for bracket notation.
- [x] P2.10 — Retry/backoff policy added to Phase 7 (applies to Phase 8 broker calls too).
- [x] P2.11 — `index.md` references guideline + review.
- [x] P2.12 — Strategy 3-state spec added to Phase 5.

## Hard Problems (global)

1. **Focused-session invariant** — exactly zero or one non-archived row can have `is_focused = true`. This must be enforced atomically (SQLite transaction) or race conditions between renders corrupt workspace state.
2. **Runtime ownership** — multi-session UI only works if execution moves from app-level singletons to one runtime per active session. Phase 0 adds that missing ownership layer.
3. **Approval queue persistence vs. restart safety** — current `pendingApprovals` Map is lost on crash. Phase 6 replaces it with DB-backed records and a restart-safe re-evaluation path instead of promise re-registration.
4. **Edit lock during active/paused runs** — IPC handlers must gate writes on session status. The UI must reflect the lock immediately and the backend must double-check (defense in depth).
5. **Cross-session instrument collision** — when two sessions share a broker, the runtime must deny a trade if the same `(broker_account_id, instrument_symbol)` pair is already open or pending in any other active session. This check must be in the DB layer, not just the service layer.
6. **Shared global pool enforcement** — the app must reserve capital across concurrent sessions, not just persist a preference toggle. The reservation lifecycle is defined in Phases 2 and 8.

