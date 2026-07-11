# Period Autopsy Migration — Plan

> **Date:** 2026-05-26
> **Status:** Implemented (2026-05-27)
> **Deciders:** Founder / Kenneth Atchon
> **Spec:** `docs/design/period-autopsy-product-spec.md`

> **Implementation update (2026-05-27):** Period Autopsy shipped through the full Phase 1-3 scope in code: new nav page, scoped history/runs, period lesson ledger, period-only Andon, trade-review demotion, manual promotion, exports, IPC/preload wiring, and service/test coverage. `bun run typecheck` passes. Targeted analytics tests pass. DB-backed migration smoke tests remain blocked in this environment by the existing `better-sqlite3` ABI mismatch.

---

## 1. Problem Statement

The v1 autopsy system treats **one closed trade** as the primary unit of analysis. Every autopsy is triggered per-trade (row action → full-screen overlay), the Andon Cord fires after every single trade generation, and the lesson validation loop is scoped to a session's trade history one trade at a time. There is no aggregate period review, no concept of a date window across many trades, and no way to ask "over the last two weeks, are we improving?"

This design underserves the product goal. Single-trade autopsies have limited strategic value — a trade that loses due to noise looks the same as a trade that exposes a structural problem. The meaningful signal emerges only across a period: recurring failure modes, behavioral drift, whether prior lessons were actually implemented. The current architecture makes none of that possible.

The Andon Cord is also misconfigured. It fires per trade autopsy, which means it triggers too often on low-signal recurrences in session data and creates noise rather than actionable escalations. Andon should only fire when a period review confirms a systemic learning failure — the current wiring is the opposite.

The forcing function is product coherence: `docs/TODO.md` and the founder's stated intent are both blocked by the v1 trade-centric spec. The "Autopsy" page that was built does not exist in the top-level nav, session-level review is unimplemented, and the lesson ledger has no concept of scope (global vs session). Nothing in v1 can be extended to support these goals — the primary surface and the data model both need to be upgraded.

---

## 2. Goals & Non-Goals

**Goals**

| #   | Goal                                            | Success Looks Like                                                                         |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Period Autopsy page ships as top-level nav item | "Autopsy" visible in TopNav; page renders period review for global and session scope       |
| 2   | Andon Cord fires only on period runs            | No `andon_cord_fired` events emitted by `TradeAutopsyService.summarize()`                  |
| 3   | Lesson ledger is scope-aware                    | `autopsy_lessons` distinguishes `source`, `scope`, `period_autopsy_id`; old rows readable  |
| 4   | Existing trade autopsies are not lost           | All `trade_autopsies` and `autopsy_lessons` rows remain in DB and viewable in Trade Review |
| 5   | Trade Review works as before (without Andon)    | Existing overlay UX preserved; row action renamed "Review Trade"                           |
| 6   | Schema migration is reversible per phase        | Each phase can be rolled back without data loss                                            |

**Non-Goals**

| #   | Non-Goal                                             | Reason                                                                   |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Rename existing `trades:autopsy:*` IPC channels      | Risk with no user-visible benefit in v2; defer to v3 or drop             |
| 2   | Backfill existing trade autopsies into period ledger | Existing trade lessons stay `source = "trade"`; promotion is manual only |
| 3   | Real-time autopsy on open trades                     | Out of product scope                                                     |
| 4   | Session attention hook for Andon                     | Deferred to v3 per spec                                                  |
| 5   | Lesson inheritance (global → session)                | Deferred to v3                                                           |
| 6   | Scheduled/recurring period autopsies                 | Out of scope                                                             |

---

## 3. Background & Context

### Current System State

**Frontend:**

- `src/pages/AutopsyPage.tsx` — full-screen overlay, not a nav page. Rendered conditionally when `ui.autopsyTradeId` is set in `App.tsx` state.
- `src/App.tsx` — `autopsyTradeId: string | null` in UI state; no `PageKey` for autopsy.
- `src/components/TopNav.tsx` — `PageKey` union has 8 values; no `"autopsy"`.
- `src/pages/TradesPage.tsx`, `src/pages/TradeDetail.tsx` — "⚕ Autopsy" row action sets `autopsyTradeId`.
- `src/components/autopsy/LessonsPanel.tsx`, `ChatHistoryModal.tsx` — trade-autopsy UI components.

**Backend:**

- `electron/main/services/analytics/trade-autopsy-service.ts` — `TradeAutopsyService.summarize(tradeId)` runs 5-phase pipeline; calls `this.validateLessons(sessionId, autopsyId, structured)` at line 382; `validateLessons` at line 430 emits Andon.
- `electron/main/ipc/trading/autopsy.ts` — registers 6 handlers, all under `trades:autopsy:*`.
- `electron/shared/ipc/channels.ts` — `channels.trades.autopsy.*` (6 channels).
- `electron/shared/domain/autopsy.ts` — `TradeAutopsyRecord`, `AutopsyLesson`, `AndonCordPayload` types.
- `electron/preload/exva-api.ts` — `window.exva.autopsy.*`.

**Database (Drizzle ORM, SQLite):**

- `trade_autopsies` table: `id`, `trade_id NOT NULL`, `session_id NOT NULL`, `model_id`, `summary`, `summary_structured_json`, `phase_traces_json`, `quality_grade`, `quality_score`, `is_fallback`, `created_at`, `created_by`.
- `autopsy_lessons` table: `id`, `autopsy_id NOT NULL FK→trade_autopsies`, `trade_id NOT NULL FK→trades`, `session_id NOT NULL FK→sessions`, `lesson`, `severity`, `category`, `proposed_fix`, `status`, `recurrence_count`, `created_at`, `updated_at`, `validated_at`.
- No `period_autopsies` table exists.

**Tests:**

- `electron/main/services/analytics/__tests__/trade-autopsy-service.test.ts` — covers lesson validation logic and Andon emission. Tests will need updating in Phase 2.

### Key Constraints

1. SQLite (via Drizzle ORM). Column type changes and dropping `NOT NULL` constraints require table recreation — no `ALTER COLUMN` support. All column changes involve: create new table, copy data, drop old, rename.
2. Existing Drizzle migration files are in `electron/main/db/migrations/` (assumed conventional directory — verify before Phase 1).
3. IPC handler registration is at app boot in `registerAutopsyHandlers()` — no hot reload. All handler changes require app restart.
4. The EventBus `andon_cord_fired` event is listened to by `RuntimeEventToast.tsx` via `window.exva.events.*` preload subscription. The listener is not trade-specific — removing the emit from `TradeAutopsyService` is the only safe way to stop trade-level Andon.

### Prior Attempts

None — v1 is the first implementation. The v1 spec (`docs/design/autopsy-product-spec.md`) explicitly called out "Session-level or cross-session autopsy: out of scope." This migration corrects that architectural decision.

---

## 4. Research Summary

**SQLite schema migrations with Drizzle ORM**

SQLite does not support `ALTER COLUMN` or `DROP NOT NULL`. Drizzle's migration tooling generates raw SQL; making a column nullable requires: (1) create new table with desired schema, (2) `INSERT INTO new SELECT ... FROM old`, (3) `DROP TABLE old`, (4) `ALTER TABLE new RENAME TO old`. This is standard practice for SQLite schema evolution and is well-documented in Drizzle's migration guide. The key insight: these table-recreate migrations must be run in a transaction to avoid partial state. Drizzle's `migrate()` runner wraps each migration file in a transaction by default. Source: https://orm.drizzle.team/docs/migrations

**Feature flags in Electron/desktop apps**

Electron apps have no deployment server, so feature flags cannot be network-fetched. The two practical patterns are: (1) a local JSON config file (e.g., `workspace_preferences` table row or a `flags.json` in `userData`), or (2) compile-time environment variable (`VITE_FEATURE_*`). For this migration, the Andon cutover flag is simple enough to store as a `workspace_preferences` key (`andon_source: "period" | "trade"`, default `"period"` after Phase 2). Using the DB means it persists across app restarts and can be toggled without rebuilding. Source: https://www.electronjs.org/docs/latest/api/app#appgetpathname

**Large-context LLM prompt assembly patterns**

When a period window contains hundreds of trades, the naive approach (full trade detail per trade) blows token budgets. Production patterns include: (1) hierarchical summarization — compress batches into summaries, then summarize summaries; (2) retrieval-augmented selection — embed trades, retrieve top-k most anomalous by vector similarity; (3) structured aggregate stats + outlier drill-down (cheapest; used by this plan). Pattern 3 is well-established in financial ML pipelines where the "interesting" trades are typically the outliers and clusters, not every row. The spec's tier-based assembly (§D.2) implements pattern 3. Key insight: the aggregate stats phase is deterministic and free — do it first, always. Source: https://platform.openai.com/docs/guides/prompt-engineering (see "use structured data")

**Migration patterns for changing FK constraints**

The `autopsy_lessons.autopsy_id` column currently has `NOT NULL` + FK → `trade_autopsies`. Making it nullable while adding a new `period_autopsy_id` FK is a single migration but touches a live table. Pattern: add the new nullable column first (safe `ALTER TABLE ADD COLUMN`), then migrate the NOT NULL column via table-recreate. Doing both in one migration file reduces the number of migration steps and keeps the schema consistent. SQLite FK enforcement is off by default — enable via `PRAGMA foreign_keys = ON` (Drizzle does this at connection time). Source: https://www.sqlite.org/lang_altertable.html

---

## 5. Options Considered

**Option A: Status Quo — No Migration**

Keep the per-trade autopsy as the primary surface. Add session-level review as a separate secondary page that reads existing `trade_autopsies` and aggregates them ad hoc.

| Dimension      | Assessment                                |
| -------------- | ----------------------------------------- |
| Complexity     | Low — no schema migration, no new service |
| Performance    | Adequate for small session sizes          |
| Reliability    | No new failure modes                      |
| Cost           | Low engineering time                      |
| Reversibility  | N/A                                       |
| Stack fit      | Good — no changes to existing patterns    |
| Team readiness | Full readiness                            |

**Risks:** The "aggregation" would be client-side over existing trade autopsy records — not a true period LLM review, just a summary of summaries. Andon Cord remains misconfigured (fires per trade). The lesson ledger remains unscopeable. This option does not satisfy the product goal stated by the founder.

**Option B: Additive Only — New Page, No Schema Changes**

Add `PeriodAutopsyPage` to the nav that reads `trade_autopsies` records and passes them to a new LLM synthesis call. Store period run results in a new table. Do not change `autopsy_lessons` — keep lesson storage trade-scoped. Disable Andon on trade runs via feature flag.

| Dimension      | Assessment                                                        |
| -------------- | ----------------------------------------------------------------- |
| Complexity     | Medium — new service, new page, new table; lesson model unchanged |
| Performance    | Adequate                                                          |
| Reliability    | New service is isolated; failure doesn't break Trade Review       |
| Cost           | Medium engineering time                                           |
| Reversibility  | High — new table can be dropped; no changes to existing tables    |
| Stack fit      | Good                                                              |
| Team readiness | Full readiness                                                    |

**Risks:** Lessons remain trade-scoped. The period autopsy cannot create a separate lesson ledger scoped to global or session — it would add lessons to `autopsy_lessons` with no period FK, making scope ambiguous. Andon cutover still needed. The lesson model mismatch creates confusion about where "the" lesson ledger lives. This option defers the hard schema work but doesn't actually solve the scoping problem.

**Option C (Recommended): Schema Migration + New Service + New Page**

Full migration per the spec: schema changes to `autopsy_lessons` (add nullable columns, `source`, `scope`, `period_autopsy_id`), new `period_autopsies` table, `PeriodAutopsyService`, `PeriodAutopsyPage`, Andon cutover. Phased across 3 phases, each independently shippable.

| Dimension      | Assessment                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Complexity     | Medium-high — SQLite table-recreate migration for `autopsy_lessons` is the only hard part               |
| Performance    | No regression — additive schema changes, new index on `period_autopsy_id`                               |
| Reliability    | Migration has a rollback path per phase; existing data preserved                                        |
| Cost           | Highest engineering time (~3 phases)                                                                    |
| Reversibility  | Phase 1 fully reversible. Phase 2 reversible with flag. Phase 3 partially irreversible (label renames). |
| Stack fit      | Excellent — follows existing Drizzle, IPC, EventBus patterns exactly                                    |
| Team readiness | Full readiness                                                                                          |

**Risks:** SQLite table-recreate migrations need careful testing with non-empty production DBs. The `autopsy_lessons` NOT NULL constraint change is the highest-risk step — mitigated by running in a transaction and testing with a seeded DB copy before release.

---

## 6. Recommendation

**We recommend Option C: Schema Migration + New Service + New Page.**

Option A (status quo) does not meet the product goal — there is no meaningful "period review" without a purpose-built LLM pipeline and a scoped lesson ledger. Option B is a good risk-reduction step but leaves a structural debt: lessons without scope context will create UX confusion and block the lesson lifecycle features the spec requires. Only Option C produces a system where the period autopsy is a first-class surface with its own scoped lesson ledger and correctly wired Andon.

The decisive advantage of Option C is correctness of the lesson model. Making `autopsy_id` nullable and adding `period_autopsy_id` + `scope` + `source` to `autopsy_lessons` is a one-time migration cost that avoids a much messier reconciliation later. The SQLite table-recreate is the only technically tricky step, and it is standard Drizzle practice.

**Key assumptions:**

- All existing `autopsy_lessons` rows can be safely backfilled with `source = "trade"` and `scope = "session"` (no row has a null `session_id` today — verify before Phase 1).
- The Drizzle migration runner is already in use (vs raw SQL migration scripts) — check `electron/main/db/migrations/`.
- The `validateLessons` method can be deleted without breaking any other call site (grep confirms it is only called in `summarize()`).

**Conditions that would change this recommendation:**

- If the migration runner is not Drizzle-managed and raw SQL is used instead: revise Phase 1 to output raw SQL migration files instead of schema.ts changes.
- If `autopsy_lessons` has millions of rows in production: add a batched migration step before the table-recreate.

---

## 7. Implementation Plan

### Phase 1: Schema + PeriodAutopsyService + Read-Only History Shell

**Goal:** `period_autopsies` table exists, `autopsy_lessons` is extended, the period service can run (or stub), and a read-only history shell page is accessible at the "Autopsy" nav item. Trade Review unchanged. Andon unchanged.

**Done criteria:**

- `period_autopsies` table exists in schema and migration applied.
- `autopsy_lessons` extended with `period_autopsy_id`, `source`, `scope` nullable columns; `autopsy_id` and `trade_id` made nullable.
- All existing `autopsy_lessons` rows have `source = "trade"`, `scope = "session"`.
- `"autopsy"` PageKey in TopNav; `PeriodAutopsyPage.tsx` renders scope toggle + empty state only (no run capability yet).
- `PeriodAutopsyService` class exists with `listByScope()` returning empty list (stub, no run method yet).
- `autopsy:period:list` and `autopsy:period:get` IPC handlers registered.
- Trade Review overlay: no changes (Andon still fires from trade level in Phase 1 — disabled in Phase 2).
- All existing tests pass.

**Deliverables:**

- [ ] `electron/main/db/schema.ts` — add `periodAutopsies` table definition; update `autopsyLessons` to reflect new columns
- [ ] `electron/main/db/migrations/[timestamp]_period_autopsies.sql` — migration SQL (see §Lesson & Andon Migration below)
- [ ] `electron/shared/domain/autopsy.ts` — add `PeriodAutopsyRecord`, `PeriodAutopsyFilters`, `PeriodAutopsyStructured` types; extend `AutopsyLesson` with `source`, `scope`, `periodAutopsyId`; extend `AndonCordPayload` with `scope`, `periodAutopsyId`, `severity`
- [ ] `electron/shared/ipc/channels.ts` — add `channels.autopsy.period.*` channel constants
- [ ] `electron/main/services/analytics/period-autopsy-service.ts` — new file; `PeriodAutopsyService` with `listByScope()`, `getById()` stubs; `run()` method stubbed to throw `"Not yet implemented"`
- [ ] `electron/main/ipc/trading/period-autopsy.ts` — new file; registers `autopsy:period:list`, `autopsy:period:get` handlers
- [ ] `electron/main/services/app-services.ts` — add `periodAutopsy: PeriodAutopsyService` to `AppServices`
- [ ] `electron/preload/exva-api.ts` — add `window.exva.autopsy.period.list`, `.get` stubs
- [ ] `src/components/TopNav.tsx` — add `"autopsy"` to `PageKey` union; add `{ id: "autopsy", label: "Autopsy" }` to `NAV_ITEMS` after `"trades"`
- [ ] `src/App.tsx` — handle `page === "autopsy"` case; render `<PeriodAutopsyPage />`
- [ ] `src/pages/PeriodAutopsyPage.tsx` — new file; scope toggle, empty state, history list (read from `autopsy:period:list`); no "Run" button yet
- [ ] `src/lib/exva.ts` — add `autopsy.period.*` types/wrappers if applicable

**Dependencies:** None — no existing code is modified in a breaking way.

**Risks in this phase:**

- SQLite table-recreate for `autopsy_lessons` not-null columns could fail mid-migration → mitigation: run against a copy of the production DB before merging; wrap in transaction.
- `PeriodAutopsyPage` import breaks build if any dependency is missing → mitigation: stub all hooks and return an empty page component until wired.

**Rollback:** Drop `period_autopsies` table. Reverse `autopsy_lessons` table-recreate migration (separate down-migration file). Remove `"autopsy"` PageKey and nav item. App returns to v1 behavior. Trade Review unaffected.

---

### Phase 2: Full Period Pipeline + Lessons + Andon Cutover

**Goal:** `PeriodAutopsyService.run()` is fully implemented (3-phase LLM pipeline, aggregate stats, scale tiers). "Run Autopsy" button functional. New lessons inserted into `autopsy_lessons` with `source = "period"`. Andon Cord moved to period-only via feature flag. Trade Review Andon emit disabled.

**Done criteria:**

- "Run Autopsy" button on PeriodAutopsyPage triggers the full 3-phase LLM pipeline.
- Results render in all result cards (exec summary, performance patterns, recurring failures, lessons, Andon).
- `autopsy_lessons` rows created for period runs with `source = "period"`, `scope`, `period_autopsy_id` populated.
- `TradeAutopsyService.validateLessons()` call removed from `summarize()`. No Andon emit in `TradeAutopsyService`.
- `PeriodAutopsyService.run()` emits `andon_cord_fired` when conditions met.
- Feature flag `andon_source` in `workspace_preferences` defaults to `"period"` for new installs; existing installs get `"period"` on first run of Phase 2.
- Period autopsy Andon toast is non-dismissing; existing trade toast pattern unchanged.
- `autopsy:period:run`, `autopsy:period:lessons:list`, `autopsy:period:lessons:update`, `autopsy:period:lessons:add` handlers registered.
- Test coverage for `PeriodAutopsyService.run()` happy path, fallback path, Andon trigger path.
- Test coverage verifying `TradeAutopsyService.summarize()` does NOT emit `andon_cord_fired`.

**Deliverables:**

- [ ] `electron/main/services/analytics/period-autopsy-service.ts` — implement `run()`: aggregate stats, `pattern_analysis` phase, `lesson_validation` phase, `synthesis` phase, Andon check, DB writes
- [ ] `electron/main/services/analytics/period-autopsy-service.ts` — implement `listLessons()`, `addLesson()`, `updateLesson()`, `promoteLesson()`
- [ ] `electron/main/services/analytics/trade-autopsy-service.ts` — **remove** `this.validateLessons(...)` call at line 382; **remove** Andon emit from `validateLessons()` (keep method signature for now, mark `@deprecated`)
- [ ] `electron/main/ipc/trading/period-autopsy.ts` — add remaining handlers: `run`, `lessons:list`, `lessons:update`, `lessons:add`, `lessons:promote`, `export`
- [ ] `electron/preload/exva-api.ts` — add full `window.exva.autopsy.period.*` API
- [ ] `src/pages/PeriodAutopsyPage.tsx` — add "Run Autopsy" button, loading states, all result cards (exec summary, performance, failures, lessons, Andon, included trades)
- [ ] `src/pages/PeriodAutopsyPage.tsx` — scope config strip (date range presets, filters panel, model picker)
- [ ] `src/pages/PeriodAutopsyPage.tsx` — version selector chips, past autopsies history drawer
- [ ] `src/components/autopsy/PeriodLessonsPanel.tsx` — new component; lesson rows with tabs (New/Open/Resolved), add inline form, status picker
- [ ] `src/components/autopsy/AndonCordCard.tsx` — new component; Andon event list, dismiss button
- [ ] `src/components/RuntimeEventToast.tsx` — update Andon toast to use extended `AndonCordPayload` (scope, periodAutopsyId); add "View Autopsy" action
- [ ] `electron/main/services/analytics/__tests__/trade-autopsy-service.test.ts` — update: assert no Andon emit post-Phase 2; remove tests for `validateLessons` Andon trigger
- [ ] `electron/main/services/analytics/__tests__/period-autopsy-service.test.ts` — new test file

**Dependencies:** Phase 1 complete (schema exists, PageKey exists, IPC channels defined).

**Risks in this phase:**

- LLM pipeline correctness — `PeriodAutopsyStructured` JSON parsing failures if model output is malformed → mitigation: Zod schema validation with fallback; `is_fallback = true` on parse error.
- Token budget exceeded on large windows → mitigation: scale tier logic (§D.2) in service; enforce 120k token hard cap before LLM call.
- Test file updates breaking CI if old Andon tests assert behaviors we're removing → mitigation: update tests before removing code, not after.
- `validateLessons` method still referenced somewhere → mitigation: run `grep -r "validateLessons"` across entire codebase before deletion.

**Rollback:** Re-add `this.validateLessons(...)` call in `TradeAutopsyService.summarize()`. Disable "Run" button on PeriodAutopsyPage (render stub only). Period autopsies remain in DB but no new ones can be created. Lessons already created with `source = "period"` remain; they won't affect Trade Review behavior.

---

### Phase 3: UX Demotion + Cleanup + Lesson Link Migration

**Goal:** Trade Review is visually demoted (renamed, label changes), `validateLessons()` method deleted, dead code removed, documentation updated. No new functionality — cleanup only.

**Done criteria:**

- Trade row action label: "Review Trade" (not "Autopsy").
- Trade Review overlay title: "Trade Review."
- `TradeAutopsyService.validateLessons()` method deleted from source.
- "Promote" button implemented in Trade Review lessons panel (§F.2 of spec).
- `docs/design/autopsy-product-spec.md` has supersession banner linking to new spec.
- `docs/TODO.md` period autopsy items marked as designed/linked.
- `docs/engineering/project-qa-guide.md` autopsy section updated with new AC.
- All test files pass against final state.

**Deliverables:**

- [ ] `src/pages/TradesPage.tsx` — rename row action from "⚕ Autopsy" to "⚕ Review Trade"
- [ ] `src/pages/TradeDetail.tsx` — same rename
- [ ] `src/pages/AutopsyPage.tsx` — rename to `TradeReviewOverlay.tsx` (or keep filename, change internal title to "Trade Review")
- [ ] `src/pages/AutopsyPage.tsx` (or `TradeReviewOverlay.tsx`) — update page title copy to "Trade Review"
- [ ] `src/components/autopsy/LessonsPanel.tsx` — add "Promote →" button per lesson row; wire to `autopsy:period:lessons:promote` IPC
- [ ] `electron/main/services/analytics/trade-autopsy-service.ts` — delete `validateLessons()` method and all supporting code (`extractKeywords` can stay if used elsewhere; check with grep)
- [ ] `electron/main/services/analytics/__tests__/trade-autopsy-service.test.ts` — remove all `validateLessons` test cases
- [ ] `docs/design/autopsy-product-spec.md` — add supersession banner at top (see §Documentation Updates below)
- [ ] `docs/TODO.md` — mark period autopsy items as complete, link to spec
- [ ] `docs/engineering/project-qa-guide.md` — rewrite Autopsy section with new AC

**Dependencies:** Phase 2 complete and stable.

**Risks in this phase:**

- `extractKeywords` util may be used by other services beyond `validateLessons` → verify with grep before deletion.
- File rename (`AutopsyPage.tsx` → `TradeReviewOverlay.tsx`) breaks imports in `App.tsx` → mitigation: update import at same time; verify build passes.
- "Promote" button IPC handler must be registered in Phase 2 → confirm `autopsy:period:lessons:promote` is live before Phase 3 ships.

**Rollback:** Label renames are cosmetic — reverting is safe. Promoting lessons is additive (creates new rows) — no rollback needed. `validateLessons` deletion is permanent but the method was already a no-op after Phase 2 (no callers, no Andon emit). Restoring it would require git revert; it cannot be partially undone.

---

## 4 (Code Touch List / Checklist)

### Phase 1

- [ ] `electron/main/db/schema.ts`
- [ ] `electron/main/db/migrations/[ts]_period_autopsies.sql`
- [ ] `electron/shared/domain/autopsy.ts`
- [ ] `electron/shared/ipc/channels.ts`
- [ ] `electron/main/services/analytics/period-autopsy-service.ts` (new)
- [ ] `electron/main/ipc/trading/period-autopsy.ts` (new)
- [ ] `electron/main/services/app-services.ts`
- [ ] `electron/preload/exva-api.ts`
- [ ] `src/components/TopNav.tsx`
- [ ] `src/App.tsx`
- [ ] `src/pages/PeriodAutopsyPage.tsx` (new)
- [ ] `src/lib/exva.ts` (if applicable)

### Phase 2

- [ ] `electron/main/services/analytics/period-autopsy-service.ts` (implement)
- [ ] `electron/main/services/analytics/trade-autopsy-service.ts` (remove validateLessons call + Andon emit)
- [ ] `electron/main/ipc/trading/period-autopsy.ts` (add remaining handlers)
- [ ] `electron/preload/exva-api.ts` (full period API)
- [ ] `src/pages/PeriodAutopsyPage.tsx` (full implementation)
- [ ] `src/components/autopsy/PeriodLessonsPanel.tsx` (new)
- [ ] `src/components/autopsy/AndonCordCard.tsx` (new)
- [ ] `src/components/RuntimeEventToast.tsx`
- [ ] `electron/main/services/analytics/__tests__/trade-autopsy-service.test.ts` (update)
- [ ] `electron/main/services/analytics/__tests__/period-autopsy-service.test.ts` (new)

### Phase 3

- [ ] `src/pages/TradesPage.tsx`
- [ ] `src/pages/TradeDetail.tsx`
- [ ] `src/pages/AutopsyPage.tsx` → `TradeReviewOverlay.tsx` (rename optional; internal title change required)
- [ ] `src/components/autopsy/LessonsPanel.tsx`
- [ ] `electron/main/services/analytics/trade-autopsy-service.ts` (delete validateLessons)
- [ ] `electron/main/services/analytics/__tests__/trade-autopsy-service.test.ts` (remove validateLessons tests)
- [ ] `docs/design/autopsy-product-spec.md`
- [ ] `docs/TODO.md`
- [ ] `docs/engineering/project-qa-guide.md`

---

## 5. Lesson & Andon Data Migration

### Existing `autopsy_lessons` Rows

**Decision: archive as `source = "trade"` (Option A).**

Existing rows are preserved exactly as-is. The migration adds new nullable columns with defaults, so existing rows automatically get:

- `period_autopsy_id = NULL`
- `source = "trade"` (backfilled)
- `scope = "session"` (backfilled — all existing rows have a non-null `session_id`)

These rows remain visible in Trade Review's Lessons Panel sidebar, keyed by `autopsy_id → trade_autopsies.id`. They do **not** appear in the Period Autopsy lessons ledger.

**Rationale for Option A over Options B and C:**

- Option B (import into period ledger): would require creating synthetic `period_autopsies` rows to act as FK parents. This creates fake data and pollutes the period autopsy history.
- Option C (read-only legacy): no practical difference from Option A for the user, but adds complexity (a separate "legacy" query path). Option A is simpler — the existing display in Trade Review is already the right surface for trade-sourced lessons.

### Migration SQL

```sql
-- Migration: period_autopsies + autopsy_lessons extension
-- Run in a single transaction.

BEGIN;

-- 1. Create period_autopsies table
CREATE TABLE period_autopsies (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  model_id TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  trade_count INTEGER NOT NULL DEFAULT 0,
  trade_ids_json TEXT NOT NULL DEFAULT '[]',
  summary_structured_json TEXT NOT NULL DEFAULT '{}',
  phase_traces_json TEXT NOT NULL DEFAULT '[]',
  quality_grade TEXT,
  quality_score REAL,
  is_fallback INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'user'
);
CREATE INDEX idx_period_autopsies_scope ON period_autopsies(scope);
CREATE INDEX idx_period_autopsies_session ON period_autopsies(session_id);
CREATE INDEX idx_period_autopsies_created ON period_autopsies(created_at);

-- 2. Add new nullable columns to autopsy_lessons (safe ALTER TABLE ADD COLUMN)
ALTER TABLE autopsy_lessons ADD COLUMN period_autopsy_id TEXT REFERENCES period_autopsies(id) ON DELETE CASCADE;
ALTER TABLE autopsy_lessons ADD COLUMN source TEXT NOT NULL DEFAULT 'trade';
ALTER TABLE autopsy_lessons ADD COLUMN scope TEXT NOT NULL DEFAULT 'session';

-- 3. Backfill existing rows
UPDATE autopsy_lessons SET source = 'trade', scope = 'session';

-- 4. Recreate autopsy_lessons to make autopsy_id and trade_id nullable
-- (SQLite requires full table recreate to drop NOT NULL)
CREATE TABLE autopsy_lessons_new (
  id TEXT PRIMARY KEY,
  autopsy_id TEXT REFERENCES trade_autopsies(id) ON DELETE CASCADE,         -- NOW NULLABLE
  period_autopsy_id TEXT REFERENCES period_autopsies(id) ON DELETE CASCADE,
  trade_id TEXT REFERENCES trades(id) ON DELETE CASCADE,                    -- NOW NULLABLE
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lesson TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  category TEXT NOT NULL DEFAULT 'strategy',
  proposed_fix TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  recurrence_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'trade',
  scope TEXT NOT NULL DEFAULT 'session',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  validated_at TEXT
);

INSERT INTO autopsy_lessons_new
  SELECT id, autopsy_id, period_autopsy_id, trade_id, session_id, lesson,
         severity, category, proposed_fix, status, recurrence_count,
         source, scope, created_at, updated_at, validated_at
  FROM autopsy_lessons;

DROP TABLE autopsy_lessons;
ALTER TABLE autopsy_lessons_new RENAME TO autopsy_lessons;

-- Recreate indexes
CREATE INDEX idx_autopsy_lessons_autopsy ON autopsy_lessons(autopsy_id);
CREATE INDEX idx_autopsy_lessons_period ON autopsy_lessons(period_autopsy_id);
CREATE INDEX idx_autopsy_lessons_session ON autopsy_lessons(session_id);
CREATE INDEX idx_autopsy_lessons_status ON autopsy_lessons(status);
CREATE INDEX idx_autopsy_lessons_scope ON autopsy_lessons(scope);

COMMIT;
```

### Andon Cutover Steps

1. Phase 2: Remove `this.validateLessons(sessionId, record.id, structured)` call from `TradeAutopsyService.summarize()` (line ~382).
2. Phase 2: In `validateLessons()`, remove the `this.deps.eventBus.emit("andon_cord_fired", cord)` call (keep lesson update logic for reference until Phase 3).
3. Phase 2: Add Andon emit to `PeriodAutopsyService.run()` in the synthesis phase post-processing.
4. Phase 3: Delete `validateLessons()` entirely after verifying no other callers via grep.
5. Phase 3: Delete test cases asserting Andon fires from `TradeAutopsyService`.

**Feature flag (`andon_source`):** A `workspace_preferences` key `andon_source` with values `"period" | "trade"` can be added if the team wants a temporary escape hatch to restore trade-level Andon during rollout. Default = `"period"`. If this flag is not needed (founder is the sole operator), skip it and just hard-cut in Phase 2.

---

## 6. Documentation Updates

| Document                                      | Action                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `docs/design/autopsy-product-spec.md`         | Add supersession banner at top (Phase 3)                                                  |
| `docs/plans/period-autopsy-migration-plan.md` | This document — update status to "In Review" → "Decided" as phases complete               |
| `docs/TODO.md`                                | Mark period autopsy items as designed; link to `period-autopsy-product-spec.md` (Phase 3) |
| `docs/engineering/project-qa-guide.md`        | Rewrite Autopsy section with acceptance criteria from spec §I (Phase 3)                   |
| `docs/plans/autopsy-impl-plan.md`             | Add note: "superseded by period-autopsy-migration-plan.md" (Phase 1)                      |

**Supersession banner for `docs/design/autopsy-product-spec.md` (add at very top, above existing title):**

```markdown
> ⚠ **Superseded.** This document describes the v1 trade-centric autopsy (per-trade only).
> The primary autopsy feature is now specified in [`docs/design/period-autopsy-product-spec.md`](./period-autopsy-product-spec.md).
> This document remains for historical reference only. Do not build new features from it.
```

---

## 8. Risk Register

| #   | Risk                                                                                                       | Likelihood | Impact                                            | Mitigation                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | `autopsy_lessons` table-recreate migration fails on production DB with existing rows                       | Low        | High — data loss if not in transaction            | Wrap in transaction; test against seeded DB copy before release                               |
| 2   | `validateLessons` call site missed during removal (called from another service)                            | Low        | Medium — trade autopsy still fires Andon          | `grep -r "validateLessons"` before Phase 2 merge                                              |
| 3   | LLM synthesis produces malformed JSON for `PeriodAutopsyStructured`                                        | Medium     | Medium — run fails or shows fallback              | Zod parsing with fallback; `is_fallback = true` on parse error                                |
| 4   | Large trade window (500+) exceeds 120k token cap before scale tier logic engages                           | Low        | Low — blocked run with error                      | Enforce hard cap check before LLM call; show toast with "reduce window or add filters"        |
| 5   | PeriodAutopsyService imported in main process before `period_autopsies` table exists (Phase 1 schema race) | Low        | Low — app crashes at boot                         | Ensure migration runs before service instantiation (standard Drizzle migrate-at-boot pattern) |
| 6   | `RuntimeEventToast` Andon listener doesn't handle new `AndonCordPayload` fields (scope, periodAutopsyId)   | Medium     | Low — toast renders without "View Autopsy" action | TypeScript will surface this as a type error during Phase 2 compile                           |
| 7   | Phase 3 file rename (`AutopsyPage.tsx`) breaks a test or import not caught in review                       | Low        | Low — build failure caught in CI                  | TypeScript compile catches missing imports                                                    |

---

## 9. Success Criteria

| Goal                          | Metric                                                                                | Baseline                  | Target                                      | How Measured                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Period Autopsy ships          | Nav item visible + run completes                                                      | 0                         | 1 functional period autopsy run             | Manual QA: Acceptance Criteria §I                                                           |
| Andon not on trade runs       | `andon_cord_fired` events in `events` table with `agent_type = "period_autopsy"` only | agent_type = null (trade) | 0 events with agent_type null after Phase 2 | SQL query: `SELECT * FROM events WHERE level='critical' AND agent_type != 'period_autopsy'` |
| Old trade autopsies preserved | `trade_autopsies` row count pre/post migration                                        | N rows                    | N rows (unchanged)                          | SQL: `SELECT COUNT(*) FROM trade_autopsies` before and after                                |
| Lesson scope correct          | `autopsy_lessons` rows with `source = "period"` after first run                       | 0                         | ≥ 1 after first period run                  | SQL: `SELECT COUNT(*) FROM autopsy_lessons WHERE source = 'period'`                         |
| Trade Review still works      | Generate trade autopsy, see results                                                   | Working                   | Working (no regression)                     | Manual QA: generate a new trade autopsy, verify no Andon fires                              |

**Leading indicators (Phase 2):**

- `PeriodAutopsyService.run()` unit tests pass in CI.
- `TradeAutopsyService` test suite updated and passing (no Andon assertions).

**Lagging indicators (Phase 3):**

- A full period autopsy run completes end-to-end with LLM in the real app.
- Andon fires correctly on a simulated repeat-lesson scenario (manual test with seeded data).

---

## 10. Open Questions

| #   | Question                                                                                                                                                                                             | Owner   | Needed By     | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------- | ------ |
| 1   | Is the Drizzle migration runner already in use (conventional `migrations/` directory with SQL files), or is schema sync used? If schema sync, Phase 1 migration SQL is not the right format.         | Kenneth | Phase 1 start | Open   |
| 2   | Should `extractKeywords()` util in `trade-autopsy-service.ts` be kept (used by period service for lesson validation keyword matching) or re-implemented in period service?                           | Kenneth | Phase 2 start | Open   |
| 3   | Is a feature flag for `andon_source` needed, or can Phase 2 hard-cut without an escape hatch? Given founder = sole operator, likely safe to hard-cut.                                                | Kenneth | Phase 2 start | Open   |
| 4   | `src/pages/AutopsyPage.tsx` rename to `TradeReviewOverlay.tsx` in Phase 3 — is there any external tooling (test snapshots, Storybook stories) that references the filename directly and would break? | Kenneth | Phase 3 start | Open   |

---

## 11. Alternatives Rejected

| Option                                                                             | Why Rejected                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Option A: Status Quo                                                               | Does not meet product goal; Andon misconfigured; no period review                                                               |
| Option B: Additive Only (no schema changes)                                        | Lesson model remains unscopeable; period autopsy cannot own its lesson ledger                                                   |
| Store period autopsy results in existing `trade_autopsies` with a `is_period` flag | Conflates two different entities in one table; query complexity grows; lesson FK semantics break                                |
| New `period_autopsy_lessons` table (separate from `autopsy_lessons`)               | Schema duplication; lesson lifecycle UI would need two code paths; migration to unified model later is harder than doing it now |
| Import existing trade lessons into period ledger automatically                     | Creates synthetic FK parents; pollutes period history with trade-sourced data; manual promotion is cleaner                      |
