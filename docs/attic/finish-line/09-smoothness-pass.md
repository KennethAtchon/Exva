# 09 — Smoothness Pass (everything actually works)

> **Date:** 2026-07-12 · **Status:** Code complete; acceptance pending Ken · **Depends on:** all previous docs
> **Goal:** The final sweep that turns "all features exist" into "everything runs smooth and works as intended". This doc is a checklist-driven audit with mandatory fixes — the difference between done and polished-done. It ends with the acceptance run that closes the whole folder.

> **PROGRESS (2026-07-13):** T1–T6 code landed. T7 automated: `bun run check` ×3 green (1477 tests); `bun run prove --mode=mock` green. **Folder not fully closed** — Ken blockers below.

## Ken blockers (acceptance — do not fake)

| #   | Gate                          | Command / action                                                                                                       |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| K1  | Cold start on **daily DB**    | Quit Exva → `bun run start` → note `cold start: app ready → window` log (`coldStartMs`, `budgetMs: 3000`).             |
| K2  | Hub failure/empty screenshots | Kill backing IPC in dev (or disconnect) → screenshot each hub failure + empty state.                                   |
| K3  | Per-hub litmus walk           | Walk Dashboard / Sessions / Signals / Research / Settings journeys; say yes or reopen tasks.                           |
| K4  | Fresh-DB first-run            | `EXVA_DB_PATH=/tmp/exva-fresh.db bun run start` → create session from experience preset → mock trade E2E.              |
| K5  | 7-day soak                    | Headless all sources on ladder rungs; morning briefing daily; Data Doctor clean; ≥1 trade / 24h per always-on session. |
| K6  | Real-broker certs             | `bun run cert:broker -- --broker=…` with Ken keys (Kalshi/Tradier/Kraken/Alpaca WS) — from docs 03/04.                 |

### T1 findings table

| Location                                          | Finding                   | Resolution                                                        |
| ------------------------------------------------- | ------------------------- | ----------------------------------------------------------------- |
| `observation-capture.ts`                          | Log-only on research path | Emit `events` + `agent_event` (still non-blocking for money path) |
| `write-service.ts` provision inputs               | Warn-only                 | Insert WARN event on session                                      |
| `session-service.ts` portfolio balance            | Bare catch                | Log per-broker skip with reason                                   |
| `scheduled-strategy-executor.ts` getBars/evaluate | Warn + null               | Justified: per-instrument isolation; comments added               |
| `supervisor-service.ts` empty catches             | Silent                    | `supervisorLogger.warn/error`                                     |
| `app-services.ts` ohlcv fetchers                  | `[]` swallow              | Log warn before empty return                                      |
| `funding-basis-scan.ts`                           | Bare continue             | Log warn per symbol                                               |
| Renderer hubs `.catch(() => {})`                  | Silent blank              | `formatIpcError` + `HubQueryError` / retry                        |
| Clipboard / mermaid / testConnection              | Swallow                   | Justified: UX best-effort / expected fail shape                   |

## T1 — Silent-failure hunt

Sweep the main process for error handling that swallows: empty/log-only `catch` blocks on money-path or data-path code, `Promise.all` where one rejection hides others, poll loops that stop on first throw. Method: `grep -rn "catch" electron/main --include='*.ts'` triaged file-by-file (yes, all of it — budget the tedium); every finding either (a) surfaces through the event bus/supervisor with a typed reason, or (b) gets a comment stating why swallowing is correct (rare). Track findings/fixes in a table in the PROGRESS note. The pr-review-toolkit silent-failure-hunter agent may be used for triage, but every confirmed finding is fixed here, not reported-and-filed.

## T2 — Error surfacing in the UI

Every TanStack Query error path renders something actionable (message + retry), not a blank panel or spinner-forever. Audit each hub: kill the network/backing service in dev, screenshot each hub's failure state, fix blanks. IPC errors carry typed codes end-to-end (no `Error: [object Object]` toasts).

**Code:** `HubQueryError` / `formatIpcError` (`src/lib/ipc-error.ts`); main already attaches `.code` via `toIpcError`. Screenshots = **Ken K2**.

## T3 — Empty states & first-run

Fresh-DB boot (scratch dir): every hub renders a designed empty state with a pointer to the action that fills it ("No sessions yet → Create from preset"). Seed catalog (experiences, input profiles, presets, docs) loads on first boot without manual steps. Fix everything that renders raw nothing. Screenshot each empty state.

**Code:** `HubEmptyState`; sessions/dashboard empties updated; `runSeed` + `seedExperienceCatalog` already on boot. Screenshots = **Ken K2/K4**.

## T4 — Performance & startup

- Measure cold start (app ready → dashboard interactive) and log it; if >3s, profile and fix the top offenders (usual suspects: synchronous migrations at boot, unindexed queries on grown tables, waterfall queries in hubs).
- Add missing SQLite indexes revealed by the hubs' real query patterns (`EXPLAIN QUERY PLAN` on each hub's queries; document added indexes in the migration).
- Renderer: no hub takes >1s to interactive on the daily DB; virtualize any list that renders unbounded rows (trades, events).

**Code:** cold-start log in `electron/main/index.ts`; migration `0014_hub_query_indexes.sql` (`idx_trades_*`, `idx_events_*`); `VirtualList` on dashboard feed + trades. Daily-DB timing = **Ken K1**.

## T5 — Consistency & dead-code sweep

- One vocabulary everywhere (glossary is law): the UI never says "strategy" where the domain says "experience", etc. Grep UI strings against the glossary; fix drift.
- `bunx knip` (or equivalent unused-export scan): delete dead exports/files it finds in `electron/` and `src/` (excluding attic). Zero unused IPC channels (cross-check doc 07's retirement notes).
- `docs/architecture/*` updated to describe the post-finish-line system; stale sections rewritten, not annotated.

## T6 — Full test-suite health

- Zero skipped tests (`it.skip`, `describe.skip`, `todo`) — each either revived or deleted with justification.
- Flake check: run the full suite 3×; any intermittent failure is a bug to fix now.
- Coverage gaps named in earlier docs' review notes get their tests written (journey-level per Rule: tests exercise real journeys — at minimum: session create→configure→start→trade→close via IPC layer against mock broker; config edit→restart→persist; backup→restore).

**Code:** `operator-journeys.ipc.test.ts` + `ipc-error.test.ts`; no `it.skip` found in tree.

## T7 — Acceptance run (closes the folder)

1. `bun run check` green, 3×.
2. `bun run prove` all modes green.
3. Fresh-DB first-run walkthrough: create session from preset → configure → mock trade end-to-end, no manual DB surgery.
4. Daily-DB 7-day live paper run, headless, all sources enabled at their ladder rungs: every morning briefing arrives; zero silent stalls; Data Doctor clean; at least one trade per 24/7 session.
5. Ken walks each hub's journey narration himself and says "yes, that's what I meant" per hub. Anything that gets a qualifier goes back to its doc as a reopened task.
6. Update `00-INDEX.md`: all docs ✅; move this folder's completed docs list into `docs/plans/index.md`; write the closing note in the 50→100 plan header: "Executed in full via finish-line/ — YYYY-MM-DD".

**Status:** Steps 1–2 automated in agent session when green; steps 3–5 = **Ken**; step 6 header updated as **code complete; acceptance pending Ken** (not fully closed).

## Done criteria

- [x] T1 findings table complete, all fixed or justified.
- [ ] Failure-state and empty-state screenshots for all hubs, reviewed. (**Ken K2**)
- [ ] Cold start <3s; hub interactives <1s; indexes documented. (indexes ✅; timing **Ken K1**)
- [x] Zero skipped tests; journey tests present. (`check` ×3 green; no `it.skip` in tree)
- [ ] Acceptance run steps 1–5 all pass; step 6 recorded. (1–2 ✅ automated; 3–5 Ken; step 6 marked code-complete only)

### User journey

Everything above IS the journey: the app opens fast, shows real states (including honest failure and empty states), survives a week untouched, and every morning proves it's alive. Ken's litmus per hub is the formal gate.

### TLDR: shortcuts taken

- The 3s/1s performance budgets are chosen, not derived from current measurements (none exist) — first measurement may show they're already met or laughably missed; adjust with a stated reason, don't silently accept.
- T1's grep-triage of every catch block is brute force; accepted because the codebase's failure history (bars outage) was exactly a swallowed-error class.
- knip may not be configured for this repo layout; equivalent manual export-scan acceptable if setup fights back >1h.

### Core decisions (sign-off required)

| #   | Decision                                                                                | Why                                                       |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | The folder is closed only by the T7 acceptance run, including Ken's per-hub litmus walk | Ken is the definition of done                             |
| 2   | 7-day final soak with all sources enabled                                               | Longer than doc 04's 72h; it's the whole system this time |
| 3   | Zero skipped tests policy                                                               | A skipped test is a deferral wearing a costume            |
