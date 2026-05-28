# Signal-Driven Architecture — Migration Plan Index

> **Spec:** `docs/specs/signal-driven-architecture.md`
> **Date:** 2026-05-28
> **Status:** In Progress
> **Principle:** No backward compatibility. Delete and redesign when existing code conflicts.

---

## Phase Map

| Phase | File                                                                           | Section of Spec                                                          | Status |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------ |
| 0     | [phase-00-db-migration.md](./phase-00-db-migration.md)                         | §6.1–6.2, §6.5–6.7                                                       | Todo   |
| 1     | [phase-01-enum-type-overhaul.md](./phase-01-enum-type-overhaul.md)             | §6.3.1, §6.3.2                                                           | Todo   |
| 2     | [phase-02-signal-infrastructure.md](./phase-02-signal-infrastructure.md)       | §3 (ISignalSource, SignalBus, EdgarSignalSource, IPC, EventBus)          | Todo   |
| 3     | [phase-03-orchestrator-integration.md](./phase-03-orchestrator-integration.md) | §5.2, §5.3 (Orchestrator trigger, FIFO queue, preflight)                 | Todo   |
| 4     | [phase-04-pipeline-phase-cleanup.md](./phase-04-pipeline-phase-cleanup.md)     | §3 (worker adds/removes), §5.2 (catalyst pipeline)                       | Todo   |
| 5     | [phase-05-signal-sources-ui.md](./phase-05-signal-sources-ui.md)               | §4.1–4.4 (Signal Sources page, cards, modals)                            | Todo   |
| 6     | [phase-06-session-ui-and-drawer.md](./phase-06-session-ui-and-drawer.md)       | §4.5–4.8, §6.3.3–6.3.4 (Session modal, drawer, card, Strategy Config UI) | Todo   |

---

## Execution Order

Phases are ordered by dependency. Do not start a phase until all its dependencies are complete.

```
Phase 0 (DB)
  └── Phase 1 (Enums/Types)
        ├── Phase 2 (Signal Infrastructure)  ← needs new DB tables + ProcessingMode
        │     └── Phase 3 (Orchestrator)     ← needs SignalBus wired
        │           └── Phase 4 (Pipeline)   ← needs catalyst context from orchestrator
        └── Phase 5 (Sources UI)             ← needs IPC channels from Phase 2
              └── Phase 6 (Session UI)       ← needs session_signal_sources + Sources UI
```

Phases 4 and 5 can run in parallel once Phase 3 is complete (they don't depend on each other).

---

## Key Invariants

- `signal_events` = source-global facts. Never session-specific.
- `session_signal_deliveries` = per-session truth. The drawer always reads this table.
- `waiting` is a **computed display state**, not a DB column. Sessions stay `running` at the DB level.
- Every session owns a FIFO delivery queue. One active cycle at a time. New signals append behind it.
- Manual tickers inject as `ManualSignalEvent`s at session start, processed once per run.
- `processingMode` replaces `discoveryMode` everywhere — no compatibility shim.
