> PROGRESS: 2026-07-12 — **T1–T6 complete.** `bun run check` green (1388 tests). No live DB at `~/.exva/exva.sqlite` on this machine — migration 0006/0007 apply on next boot of Ken's daily DB; live row-count + mock-cycle eye verify still required on that machine before treating Done criteria as fully sealed.
>
> - T1: SessionConfig/toLegacySessionConfig deleted; consumers on SessionStrategyContext/SessionRiskConfig.
> - T2: Deleted `signal-bridge.ts`. Complete SignalEvents at emit; one-way `signalEventFromMarketSignal`; migration `0005` backfill. Legacy EDGAR columns kept (live readers).
> - T3: Migration `0006` purge timer/web_search sources; `SignalSourceType = LiveSignalSourceType`; `resolveSourceDefinitionId` replaces legacy map.
> - T4: Deleted 8 dead IPC channels; kept workspace view/prefs + scorecard experiences; inventory → `docs/attic/legacy-ipc-inventory.md`.
> - T5: Migration `0007` merge → `autopsies` + single lesson FK; dual UI pages kept.
> - T6: Moved configurable-experience plan to attic; rewrote `docs/plans/index.md` (Active = finish-line + 50→100 reference). phase-6 / polymarket drafts stay until docs 02/05 land.

# 01 — Residual Debt Teardown

> **Date:** 2026-07-12 · **Status:** Complete (code) — live-DB eye verify pending on Ken's machine · **Depends on:** nothing
> **Goal:** Zero compatibility bridges, zero deprecated types, zero dead surfaces remain anywhere in the codebase or the live DB. This doc finishes what every prior phase left "for later".

Read `00-INDEX.md` completion contract first. Everything here lands in full; nothing is re-deferred.

## Current state (verify before starting — anchors may have drifted)

1. **`SessionConfig` + `toLegacySessionConfig`** — DONE (T1).
2. **Legacy EDGAR-shaped `SignalEvent` bridge** — DONE (T2).
3. **Deprecated source types** — DONE (T3). `SignalSourceType = LiveSignalSourceType` only; migration 0006 purges leftover `timer`/`web_search` `signal_sources` rows.
4. **`legacy-source-definition-map.ts`** — DONE (T3). Replaced by `resolve-source-definition-id.ts` (`resolveSourceDefinitionId`); mapping table inlined into 0006 SQL comments.
5. **Preload orphans** — DONE (T4). Dead channels deleted; `workspace.viewGet`/`prefsPatch` kept (alive via endpoints); inventory at `docs/attic/legacy-ipc-inventory.md`.
6. **Three autopsy tables** — DONE (T5). Merged into `autopsies` + single-FK `autopsy_lessons` via `0007_merge_autopsies`.
7. **`docs/plans/` clutter** — completed plans (`configurable-experience-input-architecture-deep-plan.md` says Status: Complete) still sit in Active.

## Tasks (in order)

### T1 — Kill `SessionConfig`

1. Read `trading-cycle-context.ts` and every field it actually consumes from the legacy shape. Rewrite it to consume canonical `SessionStrategy` + per-role AI config + `session_risk_config` values directly (after doc 02 these come from the strategy-config document; this task must not block on 02 — consume today's canonical sources).
2. Delete `SessionConfig`, `toLegacySessionConfig`, and the TODO block from `session.ts`. Fix all type fallout (`grep -rn "SessionConfig" electron src` must return zero non-test hits; update or delete tests that existed only to pin the bridge).
3. `bun run check` green; start the app, run one full mock trade cycle, confirm `decision_traces` still populate identically (diff one trace JSON before/after).

### T2 — Kill the signal bridge

1. `grep -rn "signal-bridge\|LegacySignalEvent" electron src`. Migrate any remaining runtime caller to `MarketSignal` directly. If the only callers are tests, rewrite those tests against `MarketSignal` constructors.
2. Delete `electron/shared/domain/signal-bridge.ts` and its re-export from `domain.ts`.
3. Drop dual-read paths in `SignalBus`/repos that accept the old envelope shape (search for `payload_json` vs `payload_v2`-era column reads). If old `signal_events` columns (`accession_number` top-level, etc.) are no longer read anywhere, write a migration that drops them. Back up DB first (`scripts/db-backup.sh`, doc 04 T1 — if it doesn't exist yet, create it now as part of this task; it's a 5-line sqlite `.backup` wrapper).

### T3 — Purge deprecated source types and legacy identity rows

1. Migration `0006_purge_deprecated_signal_sources`: delete `signal_sources` rows typed `timer`/`web_search`. **Do not** reference `session_signal_sources` (dropped in 0003). Before delete, abort if any `session_input_subscriptions.source_definition_id` still equals a deprecated `signal_sources.id` (print diagnostic SELECT in RAISE message). Assert post-delete count = 0. Leave historical `signal_events` (no Zod reject on read).
2. Delete `DeprecatedSignalSourceType`, collapsing `SignalSourceType = LiveSignalSourceType`. Fix fallout in Zod schemas, UI enums, seeds, capabilities, registry (no WebSearch stub), docs.
3. Replace runtime `mapLegacySourceToDefinitionId` (still used by `signal-bus` for edgar/mock/prediction fanout) with `resolveSourceDefinitionId` in `resolve-source-definition-id.ts`; delete `legacy-source-definition-map.ts`. Inline the old mapping table into the migration SQL comments.

### T4 — Preload orphans and dead IPC

1. For each of `session.buildCycleFixture`, `experiences.listExperiments` (+ unexposed siblings), `workspace.viewGet`: grep renderer, preload, control-agent toolset (`electron/main/services/control/build-control-toolset.ts`), and scripts. If nothing invokes the channel end-to-end, delete channel key + main handler + Zod schema together. If the control agent uses it, it is alive — keep and remove it from the orphan list in `legacy-ipc-inventory.md`.
2. Update `docs/plans/legacy-ipc-inventory.md` to Status: Complete, with a final table of what was deleted vs kept-because-alive. This inventory doc then moves to `docs/attic/`.

### T5 — Autopsy table merge

1. New table `autopsies(id, scope TEXT CHECK(scope IN ('trade','period')), trade_id NULL, session_id, period_start NULL, period_end NULL, verdict, narrative, created_at, ...)` — union of the two parents' columns; `autopsy_lessons.autopsy_id` becomes the single FK (drop `period_autopsy_id`).
2. Migration: create new table, copy both old tables in (scope-tagged), rewrite `autopsy_lessons` FKs, drop old tables. Row-count assertions on all three moves; abort on mismatch.
3. Update repos, services (`analytics/` autopsy writers, nightly period-autopsy job), IPC, and both autopsy UI pages to the merged shape. The two pages keep working (doc 07 later merges them into the Research hub — do not do that here; Rule: surgical).

### T6 — Plans-folder hygiene

1. Move completed plan docs (`configurable-experience-input-architecture-deep-plan.md`, `legacy-ipc-inventory.md`, and `phase-6-config-diet.md` once doc 02 lands) to `docs/attic/` with a one-line tombstone each in `docs/plans/index.md`.
2. Rewrite `docs/plans/index.md`: Active = this `finish-line/` folder (link `00-INDEX.md`) + `exva-50-to-100-deep-plan.md` (kept as the architecture rationale, marked "superseded for execution by finish-line/").

## Done criteria

- [x] `grep` residual-debt symbols → clean in electron/src (SessionConfig, toLegacySessionConfig, signal-bridge, LegacySignalEvent, DeprecatedSignalSourceType, legacy-source-definition-map). `web_search` only in migration SQL / attic / removed-doc copy.
- [ ] Live DB after migrations apply: `SELECT COUNT(*) FROM signal_sources WHERE type IN ('timer','web_search')` → 0 (no DB on implementing machine — **Ken: run on next boot**).
- [x] `trade_autopsies` / `period_autopsies` gone from schema; `autopsies` + single lesson FK (migration `0007`); both autopsy pages still separate routes.
- [x] `bun run check` green (1388 tests).
- [ ] App boots on daily DB; one mock cycle end-to-end produces a decision trace (**Ken: eye verify** — no daily DB here).
- [x] In-app docs/glossary updated for removed timer/web_search source types.
- [x] T6 plans hygiene: configurable-experience → attic; index Active = finish-line + 50→100 reference.

### User journey

Invisible by design: Ken notices nothing except that both autopsy pages still render his history (now from one table) and that nothing in the app ever mentions timers or web-search sources again. The payoff is for the next agent reading the code: no bridge, no dual shape, no "which of these two types is real".

### TLDR: shortcuts taken

- Anchors (`session.ts:273/536`, `domain.ts:8`) are from a 2026-07-12 grep; re-verify, code moves.
- I did not query the live DB for actual `timer`-typed row counts; T3's abort-on-unmappable guard is the safety net for whatever is really there. (No live DB at `$HOME/.exva/exva.sqlite` on the implementing machine — migration still correct for when daily DB has leftovers.)
- Autopsy merged-column union sketched, not enumerated field-by-field — the implementing agent derives it from schema.ts and must not drop any populated column.
- T3 plan text originally referenced `session_signal_sources` + "mapLegacy only for migration then delete"; both were stale — subscriptions are V2 `session_input_subscriptions`; the map was still live fanout for edgar/mock/prediction.

### Core decisions (sign-off required)

| #   | Decision                                                                                                 | Why                                                     |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | Drop old `signal_events` legacy columns in this doc (T2) instead of waiting for a "two clean weeks" bake | Single-user contract; backup script covers the risk     |
| 2   | Autopsy merge happens now, not with the config diet                                                      | It's independent schema work; batching invites deferral |
| 3   | Any orphan channel used by the control agent is kept                                                     | Control agent is a real caller even if no React page is |
