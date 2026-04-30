# Exva — Workspace & Session Management: Implementation Plan

> Grounded in: `docs/specs/workspace-session-and-model-management.md`
> Codebase state as of: 2026-04-29
> Breaking changes: permitted. No backward-compat layer required.

## Current State Summary

| Concern | Current | Target |
|---------|---------|--------|
| Sessions | One global singleton (`session_config` id=1, `session_state` id=1) | Multiple named sessions, one focused at a time |
| Instruments | `asset TEXT` column, hardcoded `["SPY","QQQ"]` watchlist | `instrument_symbol`, `instrument_type`, per-session scope |
| Brokers | Single Alpaca adapter, one keychain entry | Multiple broker accounts, per-class routing |
| AI providers | Hardcoded Anthropic, fixed model map in `AiSdkService` | Per-role provider+model, multiple providers |
| Prompts | Inline strings inside `AiSdkService` | Versioned Markdown assets loaded at runtime |
| Workspace mode | Always "session" (one) | `session` (focused) or `global` (aggregate) |
| Approval queue | In-memory `Map` in orchestrator, lost on restart | Persisted `trade_approvals` table |
| Templates | None | `session_templates` table |

## Phases

| # | File | Title | Scope |
|---|------|-------|-------|
| 1 | [phase-01-session-ownership.md](./phase-01-session-ownership.md) | Session Ownership Model | Types, DB schema design, domain rules |
| 2 | [phase-02-db-migration.md](./phase-02-db-migration.md) | Singleton → Session-Scoped Persistence | Drizzle schema, migrations, repo layer |
| 3 | [phase-03-instrument-rename.md](./phase-03-instrument-rename.md) | Asset → Instrument Rename | Find/replace across types, DB, UI, repos |
| 4 | [phase-04-sessions-page.md](./phase-04-sessions-page.md) | Sessions Page + Workspace Context | IPC, UI, global/session mode |
| 5 | [phase-05-strategy-ai-roles.md](./phase-05-strategy-ai-roles.md) | Strategy Page — Per-Role AI Config | UI expansion, IPC, edit-lock |
| 6 | [phase-06-approval-queue.md](./phase-06-approval-queue.md) | Persisted Approval Queue | DB, IPC, orchestrator wiring |
| 7 | [phase-07-ai-providers-prompts.md](./phase-07-ai-providers-prompts.md) | AI Provider Abstraction + Prompt Assets | Multi-provider, Markdown prompt loader |
| 8 | [phase-08-broker-routing.md](./phase-08-broker-routing.md) | Broker Accounts + Instrument Routing | Multi-broker, adapter abstraction, routing |
| 9 | [phase-09-instrument-selector.md](./phase-09-instrument-selector.md) | Instrument Selector Role + AI Universe | New agent role, session definition flow |
| 10 | [phase-10-services-refactor.md](./phase-10-services-refactor.md) | Services Layer Refactor | Domain subfolder split |

## Dependency Order

```
Phase 1 (types) → Phase 2 (DB) → Phase 3 (rename)
                                      ↓
Phase 4 (Sessions UI) ← must have session tables
Phase 5 (Strategy AI) ← depends on Phase 4 + Phase 7
Phase 6 (Approvals)   ← depends on Phase 2 + Phase 4
Phase 7 (AI providers)← Phase 2 prerequisite
Phase 8 (Brokers)     ← Phase 2 prerequisite
Phase 9 (Selector)    ← depends on Phase 7 + Phase 8
Phase 10 (Refactor)   ← can run after Phase 6; enables cleaner 7–9
```

## Hard Problems (global)

1. **Focused-session invariant** — exactly zero or one non-archived row can have `is_focused = true`. This must be enforced atomically (SQLite transaction) or race conditions between renders corrupt workspace state.
2. **Approval queue persistence vs. orchestrator in-memory state** — current `pendingApprovals` Map is lost on crash. Phase 6 replaces it with DB-backed records + IPC callback registration.
3. **Edit lock during active/paused runs** — IPC handlers must gate writes on session status. The UI must reflect the lock immediately and the backend must double-check (defense in depth).
4. **Cross-session instrument collision** — when two sessions share a broker, the runtime must deny a trade if the same `(broker_account_id, instrument_symbol)` pair is already open or pending in any other active session. This check must be in the DB layer, not just the service layer.
