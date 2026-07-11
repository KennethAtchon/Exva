# Preset DB Seed Migration — Plan

> **Date:** 2026-05-16
> **Status:** Draft
> **Deciders:** Kenneth

---

## 1. Problem Statement

There are five preset collections in the application: global strategy, risk, timeframe, research posture, and trade rules. Today, four of them (risk, timeframe, research posture, trade rules) exist exclusively as in-memory JSON constants imported at build time. Only one — global strategy — has a DB table (`global_presets`), and it was built exclusively for user-created presets, not for the built-in variants.

This creates two separate lookup paths for preset data. The renderer cannot query a single source; `session-repo.ts` resolves sub-preset defaults by calling `.find()` against in-memory arrays keyed by string ID at module load time (lines 61–76). If a preset ID in a session row has no matching in-memory entry, resolution silently fails. When user-created global presets ship, the UI will need to merge DB rows and in-memory objects into a single list every time it renders a preset picker — logic that must be repeated at every call site.

The forcing function is the upcoming user-created presets feature. Once users can save their own versions of risk, timeframe, and posture presets (the natural next step after global presets), every caller must distinguish origin type. Retrofitting an `isBuiltIn` flag onto existing rows after user data exists requires a backfill migration. The correct time to add it is before any user rows exist.

---

## 2. Goals & Non-Goals

**Goals**

| #   | Goal                                                                                        | Success Looks Like                                                                                           |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | All five preset types are seeded into DB tables at startup                                  | `runSeed()` inserts all built-in rows idempotently; querying any preset table returns the full expected list |
| 2   | Every DB preset row carries an `isBuiltIn` flag                                             | UI and repos can filter or protect built-ins without string-ID heuristics                                    |
| 3   | `session-repo.ts` resolves session defaults from DB, not in-memory arrays                   | Module-load fallbacks eliminated                                                                             |
| 4   | The `globalPresets` IPC list returns built-ins + user presets from a single query           | No client-side merge required                                                                                |
| 5   | `docs/engineering/ai-model-configuration-guide.md` reflects the new data source for presets | Guide accuracy maintained                                                                                    |

**Non-Goals**

| #   | Non-Goal                                                     | Reason                                                                                         |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1   | User-facing CRUD UI for sub-presets (risk, timeframe, etc.)  | Out of scope; this plan only handles built-in seeding                                          |
| 2   | Backwards-compatible migrations                              | DB is reset on every dev iteration; no migration compatibility needed                          |
| 3   | Foreign-key constraints from session tables to preset tables | Adds coupling with no current payoff; preset IDs in session rows remain plain strings          |
| 4   | Removing the JSON files from `electron/shared/presets/`      | JSON files remain as the authoritative source for seed data and for TypeScript type derivation |

---

## 3. Background & Context

### Current file map

| Preset type      | JSON source                     | In-memory constant         | DB table         | User-editable              |
| ---------------- | ------------------------------- | -------------------------- | ---------------- | -------------------------- |
| Global strategy  | `presets/global-strategy.json`  | `GLOBAL_STRATEGY_PRESETS`  | `global_presets` | Yes (user rows only today) |
| Risk             | `presets/risk.json`             | `RISK_PRESETS`             | None             | No                         |
| Timeframe        | `presets/timeframe.json`        | `TIMEFRAME_PRESETS`        | None             | No                         |
| Research posture | `presets/research-posture.json` | `RESEARCH_POSTURE_PRESETS` | None             | No                         |
| Trade rules      | `presets/trade-rules.json`      | `TRADE_RULE_PRESETS`       | None             | No                         |

### Key files to change

- `electron/main/db/schema.ts` — add four new tables and extend `globalPresets`
- `electron/main/db/seed.ts` — seed all five preset types
- `electron/main/db/repositories/global-presets-repo.ts` — update to include `isBuiltIn` in read/write
- `electron/main/db/repositories/session-repo.ts` — resolve session defaults from DB instead of in-memory arrays
- `electron/shared/presets/index.ts` — constants remain; used only as seed source and for TypeScript types
- `docs/engineering/ai-model-configuration-guide.md` — update §6 and the source-of-truth table

### Migration behavior

`runMigrations()` in `migrations.ts` calls `dropApplicationTables()` when `rebuildFromScratch: true`, which drops all tables and re-runs from scratch. In development this is the default. No backwards-compat migration SQL is needed — the new schema is the only schema.

---

## 4. Research Summary

**Idempotent seed patterns in SQLite / Drizzle**

Drizzle's `.onConflictDoNothing()` is the standard mechanism for idempotent seeds — insert fails silently if the primary key already exists. This is safe for built-in rows because their IDs are stable strings defined in JSON. The risk is stale built-in data if a JSON entry is updated and the DB row is not. The mitigation is `onConflictDoUpdate` with a `version` or `updatedAt` field to detect drift. For this project's dev-only context, `onConflictDoNothing` is sufficient now; a version field can be added later if the JSON files evolve frequently.

Source: [Drizzle ORM conflict handling](https://orm.drizzle.team/docs/insert#on-conflict-do-nothing)

`**isBuiltIn` flag vs separate tables\*\*

Two dominant patterns exist: a single table with an `is_built_in` boolean, and separate tables (`built_in_presets`, `user_presets`). The single-table approach avoids UNION queries and keeps the IPC list handler trivial. The separate-table approach gives stronger schema constraints (e.g., built-in rows are physically immutable). For this codebase, where both types share the same shape and the UI needs a unified sorted list, single-table with `isBuiltIn` is the right fit.

Source: Practical experience; see also Martin Fowler's discussion of discriminator columns in _Patterns of Enterprise Application Architecture_.

**Sub-preset DB tables vs in-memory only**

The question is whether risk, timeframe, posture, and trade-rules presets need DB tables or can remain in-memory. They need DB tables as soon as users can create custom variants — and that is the explicitly stated next capability. Seeding them into DB now means the user-CRUD surface is a trivial `INSERT` addition, not a schema change. Building DB tables now is the lower-total-cost path.

**Drizzle schema evolution in SQLite**

Because SQLite does not support `ALTER COLUMN` or `ADD CONSTRAINT` after the fact easily, schema-breaking changes (adding `NOT NULL` columns to existing tables) require a table rebuild — which is exactly what `rebuildFromScratch` does. This removes the normal migration-compatibility burden for the development phase.

---

## 5. Options Considered

**Option A: Status quo — keep presets in memory, do nothing**

Leave all five JSON files as in-memory constants. The `globalPresets` DB table continues to hold only user rows. Built-in global strategy presets are shown in the UI by importing the in-memory array separately and merging at the call site.

| Dimension      | Assessment                                                                              |
| -------------- | --------------------------------------------------------------------------------------- |
| Complexity     | Low now; grows with each user-preset feature added                                      |
| Performance    | Fastest — no DB round trips                                                             |
| Reliability    | Module-load `.find()` failures are silent; no runtime observability                     |
| Cost           | Zero engineering time now; increases every time a new preset type becomes user-editable |
| Reversibility  | Trivially reversible                                                                    |
| Stack fit      | Misaligned — DB already exists for global presets; this creates a growing inconsistency |
| Team readiness | No new patterns required                                                                |

Risks: Every new user-editable preset type forces a retroactive DB table + backfill + migration. Silent resolution failures have no alerting path.

**Option B: Seed only `globalPresets`, add `isBuiltIn` flag there**

Add `isBuiltIn` to the existing `globalPresets` table and seed the five entries from `global-strategy.json`. Leave risk, timeframe, posture, and trade-rules as in-memory arrays.

| Dimension      | Assessment                                                                  |
| -------------- | --------------------------------------------------------------------------- |
| Complexity     | Minimal — one table change, one seed function update                        |
| Performance    | DB hit only for global preset list; sub-presets stay fast                   |
| Reliability    | Session default resolution still uses module-load `.find()` for sub-presets |
| Cost           | ~2h implementation                                                          |
| Reversibility  | Easy                                                                        |
| Stack fit      | Partial fix — only solves the global preset merge problem                   |
| Team readiness | No new patterns                                                             |

Risks: Deferred until user-created sub-preset CRUD is needed, at which point four more table additions are required simultaneously. Leaves silent `.find()` failures unresolved.

**Option C (Recommended): Seed all five preset types into DB tables, add `isBuiltIn` to each**

Add four new tables (`risk_presets`, `timeframe_presets`, `research_posture_presets`, `trade_rule_presets`) and extend `globalPresets` with `isBuiltIn`. Seed all five from their JSON files in `runSeed()`. Update `session-repo.ts` to resolve defaults from DB. Remove in-memory `.find()` chains.

| Dimension      | Assessment                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| Complexity     | Moderate — four new tables, five seed functions, one repo update             |
| Performance    | Five additional DB queries at session creation; negligible for SQLite        |
| Reliability    | DB is observable; missing rows are detectable; no silent resolution failures |
| Cost           | ~4–6h implementation                                                         |
| Reversibility  | Easy in dev (reset DB); harder in production (migration required)            |
| Stack fit      | Fully aligned — single query path for all preset types                       |
| Team readiness | Follows existing `onConflictDoNothing` pattern already in `seed.ts`          |

Risks: Sub-preset tables introduce schema surface that must be maintained. If preset shapes change (new fields), the DB column set must change too. Mitigation: keep the full preset payload in a `presetJson` TEXT column (same as `globalPresets` today) and store only `id`, `label`, `isBuiltIn`, and `presetJson` — not individual value columns.

---

## 6. Recommendation

**We recommend Option C: seed all five preset types into DB tables.**

Over Option A: the growing inconsistency between in-memory and DB-backed data is a known liability. Silent `.find()` failures are unobservable. This is the right time to fix it.

Over Option B: seeding only global presets defers four more schema additions to a worse moment — when user data already exists and migrations must be backwards-compatible. Doing all five now is the same pattern repeated five times while the DB is clean.

Key assumptions this recommendation depends on:

- Sub-preset shapes (risk, timeframe, etc.) will not change so rapidly that maintaining DB columns is burdensome. Mitigation: store full payload as JSON, not as individual columns.
- Dev DB resets remain acceptable. If the project moves to a production DB before this work is done, the plan must be amended to include proper migration SQL.

Conditions that would change the recommendation toward Option B:

- Sub-preset user-CRUD is explicitly descoped for 6+ months. In that case, Option B is sufficient and simpler.

---

## 7. Implementation Plan

### Phase 1: Extend schema and seed all five preset types

**Goal:** All five preset types exist in DB tables, seeded idempotently from JSON. No existing behavior changes.

**Done criteria:**

- `global_presets` table has `isBuiltIn` column; 5 built-in rows seeded
- `risk_presets`, `timeframe_presets`, `research_posture_presets`, `trade_rule_presets` tables exist; rows seeded from JSON
- DB reset + `runMigrations()` → all tables populated, zero duplicates on re-run
- Existing `globalPresets.list()` still returns rows (now including built-ins)

**Deliverables:**

- `electron/main/db/schema.ts` — add `isBuiltIn: integer (boolean)` to `globalPresets`; add four new preset tables with columns `(id text PK, label text, isBuiltIn integer, presetJson text)`
- `electron/main/db/seed.ts` — add seed blocks for all five types using `onConflictDoNothing()`; built-in rows have `isBuiltIn = true`
- `electron/main/db/repositories/global-presets-repo.ts` — update `UserGlobalPresetRow` type to include `isBuiltIn: boolean`; update `list()` to return it; `insert()` always sets `isBuiltIn = false`; `delete()` should guard against deleting built-ins
- Add `RiskPresetsRepo`, `TimeframePresetsRepo`, `ResearchPosturePresetsRepo`, `TradeRulePresetsRepo` — each with a `list()` method only (no insert/update/delete yet)
- Register new repos in `electron/main/services/app-services.ts`
- Drizzle snapshot + journal updated via `drizzle-kit generate`

**Dependencies:** None.

**Risks in this phase:** Drizzle migration generation may require a fresh DB rebuild. Expected — `rebuildFromScratch` handles it.

**Rollback:** Reset DB. No persistent user data exists.

---

### Phase 2: Update session-repo.ts to resolve defaults from DB

**Goal:** Module-load `.find()` calls against in-memory arrays are replaced by DB lookups.

**Done criteria:**

- `session-repo.ts` no longer imports `RISK_PRESETS`, `TIMEFRAME_PRESETS`, `RESEARCH_POSTURE_PRESETS`, `TRADE_RULE_PRESETS`, or `GLOBAL_STRATEGY_PRESETS` for default resolution
- New session creation still applies the correct default preset values
- Existing session creation tests pass

**Deliverables:**

- `session-repo.ts` — remove module-level preset constant imports and `.find()` chains (lines 23–76); inject repos or accept a `defaults` object resolved from DB at construction time
- New session creation uses `riskPresetsRepo.findById("moderate")` (or equivalent) instead of `RISK_PRESETS.find(...)`
- If a preset ID resolves to nothing, throw a descriptive error (not silent `undefined`)

**Dependencies:** Phase 1 complete.

**Risks in this phase:** The default preset ID (`trend_momentum` / `moderate` / etc.) must be present in the DB for session creation to succeed. Seeding must run before the first session creation. This is already guaranteed: `runMigrations` calls `runSeed` before the app starts accepting IPC.

**Rollback:** Reset DB.

---

### Phase 3: Update IPC and renderer-facing data

**Goal:** The `strategy.globalPresets.list` IPC channel returns built-ins and user presets in one response. Renderer no longer imports in-memory preset arrays.

**Done criteria:**

- `strategy.globalPresets.list` response includes `isBuiltIn` per row
- Built-in rows are returned first, sorted by original JSON order (use `createdAt` or explicit `sortOrder`)
- `strategy.globalPresets.delete` rejects built-in IDs with `AppError`
- Any renderer code that imports `GLOBAL_STRATEGY_PRESETS` directly is updated to use the IPC channel

**Deliverables:**

- `electron/main/ipc/strategy.ts` — `globalPresets.delete` handler: if `isBuiltIn === true`, throw `AppError("Cannot delete built-in preset", "FORBIDDEN")`
- `electron/shared/ipc/channels.ts` — no changes needed (channels already exist)
- Renderer preset picker components — replace any `import { GLOBAL_STRATEGY_PRESETS }` with IPC call result
- `docs/engineering/ai-model-configuration-guide.md` — update §6 ("Strategy presets") and the source-of-truth table to reflect DB-backed presets; update "Change strategy presets" how-to section

**Dependencies:** Phase 2 complete.

**Risks in this phase:** Renderer components that currently render presets synchronously (from in-memory import) will need to handle async IPC. If no renderer currently imports these constants directly (confirmed: grep returned no results), this phase reduces to the IPC guard and the docs update.

**Rollback:** Reset DB.

---

### Phase 4: Lock down the old pattern so it cannot be re-introduced

**Goal:** The in-memory preset arrays are no longer exported as a public API. Code that needs preset data must go through DB. If someone tries to import the constants to look up a preset by ID, they hit a compile-time dead end.

**Done criteria:**

- `RISK_PRESETS`, `TIMEFRAME_PRESETS`, `RESEARCH_POSTURE_PRESETS`, `TRADE_RULE_PRESETS` are no longer exported from `shared/domain.ts` or `shared/presets/index.ts`
- `GLOBAL_STRATEGY_PRESETS` is not exported from `shared/presets/index.ts` (it was the worst offender — used for module-load default resolution)
- JSON imports in `shared/presets/index.ts` remain, but are used only internally by `seed.ts` (re-exported as seed helpers, not as browsable arrays)
- TypeScript type exports (`GlobalStrategyPreset`, `RiskPreset`, etc.) remain — types are fine to share; data is not
- `grep -r "RISK_PRESETS\|TIMEFRAME_PRESETS\|RESEARCH_POSTURE_PRESETS\|TRADE_RULE_PRESETS\|GLOBAL_STRATEGY_PRESETS" electron/` returns only `seed.ts` hits

**Deliverables:**

- `electron/shared/presets/index.ts` — remove `export const GLOBAL_STRATEGY_PRESETS`, `RISK_PRESETS`, `TIMEFRAME_PRESETS`, `RESEARCH_POSTURE_PRESETS`, `TRADE_RULE_PRESETS`; replace with unexported `BUILT_IN_`\* names used only by seed helpers
- `electron/shared/presets/index.ts` — export named seed helper functions instead: `builtInGlobalStrategyPresets()`, `builtInRiskPresets()`, etc. — these return the raw JSON arrays for use in `seed.ts` only
- `electron/shared/domain.ts` — remove re-exports of the four sub-preset constants
- `electron/main/db/seed.ts` — import from the new seed helper functions, not from the removed constants
- Confirm TypeScript build is clean after removals — any remaining import of the deleted exports is a compile error that must be fixed before this phase closes

**Dependencies:** Phase 2 and Phase 3 complete (all callers already migrated off the constants).

**Risks in this phase:** If a caller was missed in Phase 2 or 3, this phase surfaces it as a compile error. That is the intended behavior — fail loud, fix it.

**Rollback:** Trivial — re-export the constants from `shared/presets/index.ts`. No DB changes.

---

## 8. Risk Register

| #   | Risk                                                             | Likelihood | Impact                                                               | Mitigation                                                                         |
| --- | ---------------------------------------------------------------- | ---------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Built-in JSON preset IDs change, leaving stale DB rows           | Low        | Medium — session default resolution picks wrong preset               | Use `onConflictDoUpdate` keyed on `id`; or rely on `rebuildFromScratch` in dev     |
| 2   | `runSeed` runs before new tables exist (migration ordering)      | Low        | High — seed fails, app won't start                                   | Drizzle `migrate()` runs before `runSeed()`; existing pattern already handles this |
| 3   | Sub-preset table columns diverge from JSON shape over time       | Medium     | Low — only `presetJson` TEXT is stored, not individual value columns | Store full JSON payload; column set is minimal                                     |
| 4   | Renderer still imports in-memory constants after migration       | Low        | Low — confirmed by grep: no renderer imports today                   | Grep check in Phase 3                                                              |
| 5   | Missed caller of deleted constants causes silent runtime failure | Low        | Medium — only possible if TypeScript build is skipped                | Phase 4 done-criteria requires clean TS build; compile errors force fixes          |

---

## 9. Success Criteria

| Goal                                 | Metric                          | Baseline                          | Target                                                   | How Measured                           |
| ------------------------------------ | ------------------------------- | --------------------------------- | -------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| All built-in presets seeded          | Row count per table             | 0 built-in rows in DB             | 5 global, 5 risk, 4 timeframe, 6+ posture, 5+ rules rows | Query each table after `runMigrations` |
| No silent preset resolution failures | `requirePreset()` calls removed | 4 module-load `.find()` chains    | 0                                                        | Code review / grep                     |
| Single list query                    | IPC response shape              | Built-ins served from JSON array  | Built-ins + user presets from one DB query               | IPC handler inspection                 |
| Docs current                         | Guide accuracy                  | §6 describes JSON files as source | §6 describes DB seed as source                           | Manual review                          |
| Old pattern removed                  | Constant export count           | 5 public constant exports         | 0 — only seed helper functions exported                  | `grep -r "RISK_PRESETS                 | GLOBAL_STRATEGY_PRESETS" electron/`returns only`seed.ts` |

---

## 10. Open Questions

| #   | Question                                                                     | Owner   | Needed By      | Status                                              |
| --- | ---------------------------------------------------------------------------- | ------- | -------------- | --------------------------------------------------- |
| 1   | Should built-ins be editable (fork/clone) or strictly read-only?             | Kenneth | Before Phase 3 | Open                                                |
| 2   | Should `createdAt` on built-in rows be a meaningful timestamp or epoch 0?    | Kenneth | Phase 1        | Open                                                |
| 3   | Do sub-preset tables need IPC channels now, or only when user CRUD is added? | Kenneth | Phase 3        | Open — Phase 3 defers this unless renderer needs it |

---

## 11. Alternatives Rejected

| Option                                                   | Why Rejected                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Status quo (Option A)                                    | Silent `.find()` failures; forces retroactive migration under user data                                                                    |
| Seed only `globalPresets` (Option B)                     | Defers four schema additions to a worse moment; leaves sub-preset paths inconsistent                                                       |
| Store individual value columns per table (not JSON blob) | Would require a column-level schema change every time a preset field is added; the blob approach is already established in `globalPresets` |
