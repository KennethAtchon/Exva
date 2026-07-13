# 02 — Config Diet (Phase 6, executed in full)

> **Date:** 2026-07-12 · **Status:** Complete (code) — live-DB eye verify pending · **Depends on:** 01 (SessionConfig bridge gone)
> **Goal:** Nine per-session config tables + five preset tables collapse into ONE versioned, Zod-validated `session_strategy_config` JSON document (and one `config_presets` table). Every repo/IPC/UI surface that existed per-table is replaced, not wrapped. `phase-6-config-diet.md`'s deferral is hereby revoked.

## PROGRESS

- **2026-07-13 — T6 hygiene.** `phase-6-config-diet.md` → `docs/attic/`. Live eye verify (boot daily DB, edit every section, mock cycle consumes values) still **pending** — no `~/.exva/exva.sqlite` on implementing machine.
- **2026-07-13 — T5 landed (no commit).** Hard cutover cleanup:
  - Migration `0010_drop_legacy_session_config_tables.sql` (marker) + TS `dropLegacySessionConfigTables` after 0009 backfill.
  - Dropped fourteen tables from schema.ts / live migrate path: nine per-session config + five preset tables.
  - Seed writes `config_presets` directly via `seedBuiltinConfigPresets`; `SessionRepo.create` / `duplicate` write only `session_strategy_configs` (no dual-write).
  - Deleted nine session config repos + five preset repos (+ tests), `createStrategyConfigRepoAdapters`, old per-table `strategy:*` IPC/Zod/preload/exva wrappers (kept `strategy:get`, provider-models, workspace-default-model).
  - OrchestratorDeps / preflight / write+template services read via `strategyContextService` only.
  - **Exception kept:** `session_templates` + `template:*` IPC / `SessionTemplatesModal` — still a distinct session-bootstrap workflow (instrument classes, broker assignments). Backfill still maps templates → `config_presets` kind `full` when present; table itself not dropped.
  - `bun run check` green. **T6 live verify not claimed.**
- **2026-07-13 — T1–T4 landed (no commit).**
  - Domain + tables + backfill (T1/T2) as before.
  - **T3:** `SessionStrategyConfigService` is the sole config read/write path for main-process runtime (`get` / `update` with optimistic concurrency + `STALE_VERSION` / `applyPreset` / `history` / `rollback` / preset CRUD).
  - `SessionStrategyContextService` now maps `session_strategy_configs` → `SessionStrategyContext` / Strategy page data (selector + AI phases from doc).
  - `SessionRepo.create` (+ `duplicate`) inserts `session_strategy_configs` v1 via `assembleInitialSessionStrategyConfigDoc`.
  - New IPC: `strategyConfig:get|update|applyPreset|listPresets|savePreset|deletePreset|history|rollback` (+ preload + `src/lib/exva.ts`).
  - Old `strategy:*` channels kept as adapters over the new service (including global presets + workspace-default model backfill). No dual-write to old tables on UI/IPC saves.
  - Runtime readers that still take `sessionAiPhasesRepo` / `sessionSelectorSettingsRepo` shapes use `createStrategyConfigRepoAdapters` (thin adapters over the new service) until T5 deletes the deps.
  - **T4:** Strategy Config UI cut over to document API.
    - `strategyStore` loads via `strategyConfig.get` + `listPresets('full')` (keeps `strategy.get` only for providers/session lock metadata), saves via `update` with `expectedVersion`, applies presets via `applyPreset`, surfaces `STALE_VERSION` with reload + clear message (no silent overwrite).
    - Preset create/edit/delete uses `savePreset` / `deletePreset` with assembled full docs.
    - New **Config history** drawer: list versions, section JSON diff vs current, rollback with `expectedVersion`.
    - In-app Strategy overview + glossary (`strategy-config-history`) updated for versioned document / history (I9).
    - Unit tests: `src/__tests__/strategy-config-ui.test.ts`, `src/__tests__/strategy-store.test.ts`.
    - **Live screenshot verify pending** (no daily DB / Electron UI drive on this machine — same posture as doc 01).
  - **Not started:** T6 live verify.
- **2026-07-13 — T1–T3 landed (no commit).**
  - Domain + tables + backfill (T1/T2) as before.
  - **T3:** `SessionStrategyConfigService` is the sole config read/write path for main-process runtime (`get` / `update` with optimistic concurrency + `STALE_VERSION` / `applyPreset` / `history` / `rollback` / preset CRUD).
  - `SessionStrategyContextService` now maps `session_strategy_configs` → `SessionStrategyContext` / Strategy page data (selector + AI phases from doc).
  - `SessionRepo.create` (+ `duplicate`) inserts `session_strategy_configs` v1 via `assembleInitialSessionStrategyConfigDoc`.
  - New IPC: `strategyConfig:get|update|applyPreset|listPresets|savePreset|deletePreset|history|rollback` (+ preload + `src/lib/exva.ts`).
  - Old `strategy:*` channels kept as adapters over the new service (including global presets + workspace-default model backfill). No dual-write to old tables on UI/IPC saves.
  - Runtime readers that still take `sessionAiPhasesRepo` / `sessionSelectorSettingsRepo` shapes use `createStrategyConfigRepoAdapters` (thin adapters over the new service) until T5 deletes the deps.
  - **Not started:** T4 UI cutover, T5 drop old tables, T6 live verify.
- **2026-07-12 — T1 + T2 landed (no commit).**
  - Domain: `electron/shared/domain/session-strategy-config.ts` + `session-strategy-config-defaults.ts` (schemaVersion 1, `.strict()`, section sub-schemas).
  - Schema tables: `session_strategy_configs`, `config_presets`, `session_strategy_config_history` in `schema.ts`.
  - Migrations: `0008_session_strategy_config_tables.sql` (CREATE only); `0009_session_strategy_config_backfill.sql` (marker). Zod-validated backfill runs in TS via `session-strategy-config-backfill.ts` after migrate+seed in `migrations.ts`. No drizzle meta snapshots for 0005–0009 (SQL + journal only — matched).
  - Preset IDs namespaced (`risk/…`, `timeframe/…`, `research/…`, `rules/…`, `full/…`, `full/template:…`) to avoid collisions (`custom`, `edgar_catalyst`, etc.).
  - Seed validation: built-in presets + freshly created sessions assemble cleanly. Deliberate abort path covered for invalid `entry_style='breakout'` (schema column default historically invalid vs domain enum — defaults file uses `catalyst`).
  - **Backup:** run `scripts/db-backup.sh` before applying these migrations to a live daily DB (script no-ops if `~/.exva/exva.sqlite` missing).
  - **Was open after T2:** T3–T6; `SessionRepo.create` gap closed in T3.

## Current state (verify)

Per-session config tables in `electron/main/db/schema.ts` (line anchors 2026-07-12): `session_strategies` (284), `session_research_posture` (310), `session_ai_settings` (325), `session_trade_rules` (377), `session_risk_config` (392), `session_timeframe_config` (422), plus `session_ai_phases`, `session_ai_phase_workers`, `session_selector_settings` (grep for exact positions). Preset tables: `global_presets` (505), `risk_presets` (515), `timeframe_presets` (524), `research_posture_presets` (533), `trade_rule_presets` (542). Each table has its own repo under `db/repositories/sessions/`, IPC channels, Zod schemas, and UI panels (mostly `StrategyConfig.tsx` + session settings surfaces). `session_templates` (551) composes presets.

## Target design

### Schema

```ts
export const sessionStrategyConfigs = sqliteTable("session_strategy_configs", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), // monotonic per session, bump on every write
  schemaVersion: integer("schema_version").notNull(), // document shape version, starts at 1
  doc: text("doc", { mode: "json" }).notNull(), // SessionStrategyConfigDoc
  updatedAt: text("updated_at").notNull(),
});
export const configPresets = sqliteTable("config_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'full' | 'risk' | 'timeframe' | 'research' | 'rules' | 'ai'
  doc: text("doc", { mode: "json" }).notNull(), // partial SessionStrategyConfigDoc matching `kind`
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});
export const sessionStrategyConfigHistory = sqliteTable(
  "session_strategy_config_history",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    version: integer("version").notNull(),
    doc: text("doc", { mode: "json" }).notNull(),
    savedAt: text("saved_at").notNull(),
  },
); // every write appends prior doc here → free config-change audit trail + rollback
```

### Document shape (`electron/shared/domain/session-strategy-config.ts`)

```ts
interface SessionStrategyConfigDoc {
  schemaVersion: 1;
  strategy: { /* every column of session_strategies, camelCased */ };
  risk: { /* session_risk_config columns */ };
  timeframe: { /* session_timeframe_config columns */ };
  tradeRules: { /* session_trade_rules columns */ };
  researchPosture: { /* session_research_posture columns */ };
  ai: {
    settings: { /* session_ai_settings columns */ };
    phases: Array<{ /* session_ai_phases row */ ; workers: Array<{ /* session_ai_phase_workers row */ }> }>;
  };
  selector: { /* session_selector_settings columns */ };
}
```

Field-by-field: derive from schema.ts, camelCase, keep semantics identical — this doc intentionally does not re-design any knob. One Zod schema `sessionStrategyConfigDocSchema` validates the whole document; sub-schemas exported per section so IPC endpoints can validate partial updates. **Defaults live in one file** `session-strategy-config-defaults.ts` replacing today's scattered per-table seed defaults.

### Service & IPC

- `SessionStrategyConfigService` (new, `services/session/`): `get(sessionId)`, `update(sessionId, patch, expectedVersion)` (optimistic concurrency — reject stale writes), `applyPreset(sessionId, presetId)`, `history(sessionId)`, `rollback(sessionId, version)`.
- IPC: `strategyConfig:get / update / applyPreset / listPresets / savePreset / deletePreset / history / rollback` — replaces every `strategy:*` per-table channel. Delete the old channels, handlers, Zod schemas, and preload wrappers in the same session.
- All main-process readers (orchestrator cycle context, pipeline runtime, risk engine, scheduler planner, preflight checks) read via `SessionStrategyConfigService.get()` — grep each old repo's callers and migrate every one. Delete the nine repos + five preset repos and their tests when caller count hits zero.

## Tasks

1. **T1 — Domain + schema.** Doc type, Zod schemas, defaults file, three new tables + Drizzle migration (create only; no data moves yet). Unit tests: round-trip every section; unknown-key rejection; schemaVersion gate.
2. **T2 — Backfill migration.** One migration function: for every session, read all nine tables, assemble the doc, validate with Zod, insert `session_strategy_configs` row (version 1). Same for presets → `config_presets` (each old preset table maps to its `kind`; `global_presets`/`session_templates` map to `kind:'full'`). **Abort loudly on any validation failure** — a session whose config doesn't validate is a real bug to fix, not skip. Run `scripts/db-backup.sh` first. Row-count + per-session spot-check assertions inside a migration test using a fixture DB seeded from current seeds.
3. **T3 — Service + IPC.** Build service, new channels, preload. Migrate every main-process reader (enumerate with grep per repo; the migration is done when each old repo has zero imports).
4. **T4 — UI cutover.** `StrategyConfig.tsx` and any session-settings panels move to the new endpoints. Preset picker reads `config_presets`. Add a "Config history" drawer (list versions, view diff as JSON, rollback button) — small, but it's the payoff feature of the history table. Screenshot every changed panel and look at it.
5. **T5 — Delete.** Drop the fourteen old tables (migration), delete repos/IPC/Zod/tests/UI code for them. `grep -rn "session_ai_settings\|session_risk_config\|risk_presets\|..."` (all fourteen names) → zero non-migration hits.
6. **T6 — Verify live.** Boot on daily DB (post-backfill), open each config surface, edit a value in every section, restart app, confirm persistence; run one mock cycle and confirm the orchestrator/risk gate consume the edited values (assert in decision trace).

## Done criteria

- [ ] Fourteen old tables gone from schema.ts and live DB; three new tables populated.
- [ ] All config reads/writes flow through `SessionStrategyConfigService`; old repos deleted.
- [ ] Optimistic-concurrency test: two racing updates → second rejected with stale-version error surfaced in UI.
- [ ] Config history + rollback works end-to-end (edit → history row → rollback → values restored).
- [ ] `bun run check` green; live verification T6 performed and described in the PROGRESS note.
- [ ] `phase-6-config-diet.md` moved to attic with tombstone.

### User journey

Ken opens a session's Strategy Config page. One page, sectioned (Strategy / Risk / Timeframe / Rules / Research / AI / Selector), loads instantly from one document. He tweaks stop-loss, hits save — version bumps, history records the old doc. He fat-fingers a preset apply — opens Config history, sees v7→v8 diff, taps Rollback, back to v7 values. No behavior of the trading runtime changes; only where config lives.

### TLDR: shortcuts taken

- Document sections mirror today's tables 1:1 rather than re-designing the config vocabulary — deliberate (surgical), but it means some awkward knobs survive.
- Exact column lists not transcribed here; agent derives from schema.ts. Risk: a column with subtle semantics (nullable meaning "inherit") gets flattened wrong — the Zod round-trip tests against seeded fixtures are the guard.
- Assumed `session_templates` maps cleanly to `kind:'full'` presets; if templates compose per-kind preset IDs by reference, the backfill must resolve them into a concrete doc.

### Core decisions (sign-off required)

| #   | Decision                                                         | Why                                                                      |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Hard cutover with same-session deletion of the fourteen tables   | Completion contract; dual-read was the old plan's deferral vector        |
| 2   | Add config history/rollback (new capability) as part of the diet | Cheap once doc-shaped; makes the migration a net feature, not just churn |
| 3   | Optimistic concurrency via version column                        | Single user, but two windows / control-agent + UI can race               |
