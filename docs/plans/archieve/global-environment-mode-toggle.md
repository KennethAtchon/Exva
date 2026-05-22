# Global Environment Mode Toggle — Plan

> **Date:** 2026-05-20
> **Status:** Implemented (2026-05-21)
> **Deciders:** Kenneth Atchon

---

## 1. Problem Statement

Today the app has no concept of a global paper/live environment. Every session independently chooses `executionMode: "paper_only" | "live_allowed"`, and every broker account independently holds `mode: "paper" | "live"`. This means a user can accidentally assign a live broker to a paper session, or create sessions with mixed modes, or look at a sessions list that blends real-money trades with paper runs without any visual separation.

The deeper issue: there is no hard boundary between the "test" and "production" worlds. A user operating in a live trading environment must mentally track which rows are real. A user developing a new strategy may accidentally trigger a live order because the per-session mode was inherited from a template. The app treats paper vs live as an optional attribute of individual records rather than as a workspace-level environment stance.

This refactor adds a single workspace-level toggle — **Paper** vs **Live** — that becomes the authoritative source of truth for the environment the user is operating in. Every subsequent UI decision (which sessions are visible, what mode a new session gets, which brokers are shown, what the create modal defaults to) derives from this single toggle. The toggle surfaces in the Accounts page header as requested, and its state is reflected in the TopNav.

---

## 2. Goals & Non-Goals

**Goals**

| #   | Goal                                                                                                   | Success Looks Like                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Single global toggle for Paper vs Live on the Accounts page                                            | Toggle persists to DB, survives app restart                                                                                  |
| 2   | Session lists filter to show only sessions matching the active environment                             | Paper mode: only `paper_only` sessions visible. Live mode: only `live_allowed` sessions visible                              |
| 3   | Broker lists filter to show only broker accounts matching the active environment                       | Paper mode: only `mode="paper"` accounts shown                                                                               |
| 4   | Session creation auto-sets `executionMode` from global mode; per-session mode toggle removed           | No ambiguity in create flow                                                                                                  |
| 5   | Broker creation auto-sets `mode` from global mode; per-broker mode selector removed                    | Brokers always match the environment they were created in                                                                    |
| 6   | TopNav environment indicator reflects global mode                                                      | Visual signal is always accurate                                                                                             |
| 7   | All list-level `executionMode` / broker `mode` filter logic is eliminated from individual components   | Components read one global value, not per-record mode                                                                        |
| 8   | All old per-record mode selection code is deleted — no dead code, no fallbacks, no compatibility shims | Grep for `showMock`, `modeToggle`, `setMode`, `executionMode` state vars and `brokerMode` derivation confirms zero survivors |

**Non-Goals**

| #   | Non-Goal                                                | Reason                                                                      |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Backwards compatibility for old per-record mode UI      | No existing data to preserve. Delete old code completely.                   |
| 2   | Per-session mode override once the global toggle exists | Explicit scope of this refactor: one mode, no overrides                     |
| 3   | Role-based access control on live mode                  | Out of scope; no multi-user model today                                     |
| 4   | Modifying broker adapter endpoint logic                 | Already correct per `BrokerAccount.mode`; unchanged                         |
| 5   | Changing the `LiveReadinessModal` / live readiness gate | Gate is already correct; it validates at session start based on broker mode |

---

## 3. Background & Context

### Pre-Refactor State (historical)

**Data model before this refactor:**

```
workspacePreferences (singleton row id=1)
  globalIncludeArchived: boolean
  defaultSearchProviderId: text
  allocationEnforcementOverride: text
  defaultModelProviderKey: text
  defaultModelModelId: text
  ← NO global environment mode

sessions
  executionMode: "paper_only" | "live_allowed"   ← per-session

brokerAccounts
  mode: "paper" | "live"                          ← per-account
```

### Post-Implementation State

**Data model after this refactor:**

```
workspacePreferences (singleton row id=1)
  globalEnvironmentMode: "paper" | "live"         ← authoritative workspace env
  globalIncludeArchived: boolean
  ...

sessions.executionMode / brokerAccounts.mode
  Still stored per-record (set at creation from globalEnvironmentMode)
  UI lists filter by globalEnvironmentMode; no per-record mode selectors remain
```

**Session start gate** (`electron/main/services/session/session-service.ts:31-44`):
If `executionMode === "live_allowed"`, `liveReadiness.check()` validates that ALL assigned brokers have `mode === "live"` and user has acknowledged. This gate is sound and does not need to change.

**Broker endpoint selection** (`electron/main/services/broker/adapters/alpaca-adapter.ts:24-27`):
Already uses `account.mode` to pick `paper-api.alpaca.markets` vs `api.alpaca.markets`. Correct and unchanged.

**UI removed during implementation:**

- `CreateEditSessionModal.tsx` — Paper/Live mode toggle (Execution Setup section retained for broker assignment only)
- `AddBrokerModal.tsx` — per-broker mode state + selector UI
- `TopNav.tsx` / `exva.ts` — `showMock` prop system replaced by store-driven Paper/Live pill

**State management:**
`useWorkspaceStore` (Zustand) holds `preferences: WorkspacePreferences | null`. The new field slots naturally here.

### Conventions to Match

- Workspace-level preferences: stored in `workspacePreferences` singleton row, accessed via `api.patchWorkspacePreferences()`, reflected in `workspaceStore.preferences`
- DB migration: Drizzle Kit migrations in `electron/main/db/drizzle/`, single SQL file per migration
- Validation: Zod schemas in `electron/shared/validation/schemas.ts`
- Domain types: `electron/shared/domain/workspace.ts`

---

## 4. Research Summary

**Global environment mode in trading applications**
Established pattern in trading platforms (Alpaca dashboard, IBKR TWS, TD Ameritrade thinkorswim): a top-level "paper trading" vs "live trading" switch that is session-global, not per-order. The UI typically renders the switch prominently in the header with a color contrast (yellow/amber for paper, red/green for live) so users always know which world they're in. Paper and live data are kept in completely separate views — no mixing. This pattern is directly applicable here.
Key insight: the toggle should feel like switching an environment, not filtering a list. The framing matters for UX.
Sources: Alpaca Docs — Paper Trading (https://docs.alpaca.markets/reference/paper-trading), Interactive Brokers TWS documentation on paper trading accounts.

**Persisting UI preferences in Electron apps**
Common approach: store environment preferences in the app database (not electron-store or localStorage) so they survive DB-backed restores and are queryable alongside other user data. This codebase already does this for `globalIncludeArchived` — the pattern is established and the new field slots in identically.
Key insight: no new persistence mechanism needed; `workspacePreferences` singleton row is the right home.

**Zustand global state for cross-component mode reads**
Reading one global preference from a Zustand store (vs prop-drilling or Context) is already the pattern in this codebase. `useWorkspaceStore` is imported by `TopNav`, `AccountsPage`, `SessionsPage`, etc. Adding a derived selector `environmentMode` costs nothing and avoids prop drilling.
Key insight: zero new state infrastructure needed. One new field, one new selector.

---

## 5. Options Considered

### Option A: Status Quo — Do Nothing

Leave `executionMode` per-session and `mode` per-broker. Rely on existing indicators.

| Dimension      | Assessment                                     |
| -------------- | ---------------------------------------------- |
| Complexity     | Zero build cost                                |
| Performance    | No change                                      |
| Reliability    | Current bugs remain (mixed-mode session lists) |
| Cost           | $0 engineering                                 |
| Reversibility  | N/A                                            |
| Stack fit      | N/A                                            |
| Team readiness | N/A                                            |

**Risks:** Users continue mixing paper and live data in the same view. Live order risk from wrong mode on session creation remains. No hard environment boundary.

---

### Option B: Client-side Only Toggle (No DB Persistence)

Add a React state variable in `App.tsx` for `environmentMode`, pass it down via props or Context. Does not write to DB. Resets to "paper" on every app restart.

| Dimension      | Assessment                                                      |
| -------------- | --------------------------------------------------------------- |
| Complexity     | Low — no schema changes, no migration                           |
| Performance    | No IPC round trip on toggle                                     |
| Reliability    | Resets on restart — users must re-select live mode each session |
| Cost           | ~1 day                                                          |
| Reversibility  | Easy to extend later                                            |
| Stack fit      | Against existing pattern — preferences that matter live in DB   |
| Team readiness | Easy                                                            |

**Risks:** Forgetting live mode is off by default could cause confusion. Inconsistent with how `globalIncludeArchived` is handled. Not a durable signal.

---

### Option C: Persisted Global Mode in `workspacePreferences` (Recommended)

Add `globalEnvironmentMode: "paper" | "live"` to `workspacePreferences`. Surface in `WorkspacePreferences` type, `workspacePrefsPatchSchema`, Zustand store. Build toggle in Accounts page header. All list views filter by this value. Session and broker creation auto-sets mode from this value and removes redundant per-record mode selectors.

| Dimension      | Assessment                                                          |
| -------------- | ------------------------------------------------------------------- |
| Complexity     | Medium — schema migration + 8-12 files changed, all mechanical      |
| Performance    | One extra field in existing `getWorkspaceView` response; negligible |
| Reliability    | Survives restart; consistent with existing prefs pattern            |
| Cost           | ~3-4 days engineering                                               |
| Reversibility  | Fully reversible — field can be ignored without removing it         |
| Stack fit      | Exact match of existing `globalIncludeArchived` pattern             |
| Team readiness | Pattern is already in codebase; low ramp                            |

**Risks:**

- Migration must default to `"paper"` to avoid accidentally enabling live mode for existing users (low likelihood, high impact if wrong — mitigated by explicit default)
- Removing per-session mode toggle removes flexibility; a user can't have one paper session and one live session running simultaneously — acceptable given the goal is hard environment separation

**Open questions:**

- Should switching from Live → Paper while a live session is active warn the user? The live session would disappear from the filtered view but continue running.
- Should creating a broker account in paper mode prevent it from ever being used in live mode (even if user switches modes later)? Current design: no — mode is set at creation time, switching global mode just changes what's visible and what defaults are.

---

## 6. Recommendation

**We recommend Option C: Persisted Global Mode in `workspacePreferences`.**

Over the status quo: the status quo leaves a real risk of live orders being placed from incorrectly-configured sessions. It also makes the UI actively misleading (sessions list shows paper and live trades intermixed).

Over the simpler Option B: the app already has a pattern for persisted workspace preferences. A mode that resets to paper on every restart is noise, not a feature. The extra complexity is a schema migration (one SQL line) and updating `workspacePrefsPatchSchema` — trivial.

Key assumptions this recommendation depends on:

1. Drizzle migration can add a nullable/defaulted column to `workspacePreferences` without breaking the existing singleton row — true for SQLite `ALTER TABLE ADD COLUMN` with a default.
2. No use case requires simultaneously running a paper session and a live session (the toggle is global, so only one mode is visible at a time).

Conditions that would change the recommendation:

- If the product later requires "paper and live side-by-side" views, reintroduce per-session mode as a secondary filter layer. The DB column structure for that already exists; it's a UI scope question.

---

## 7. Implementation Plan

Each phase is independently deployable and leaves the system in a valid state.

### Phase 1: Data Layer

**Goal:** Add `globalEnvironmentMode` to the DB schema and domain types. Nothing visible changes in the UI — the field just exists with a default of `"paper"`.

**Done criteria:** App boots, existing workspace preferences load without error, new field is accessible via `api.getWorkspaceView()`.

**Deliverables:**

- [x] `electron/main/db/schema.ts:325` — Add column `globalEnvironmentMode: text("global_environment_mode").notNull().default("paper")` to `workspacePreferences` table
- [x] Generate Drizzle migration: `bunx drizzle-kit generate` → produces `electron/main/db/drizzle/0001_global_env_mode.sql`
- [x] `electron/shared/domain/workspace.ts:87-95` — Add `globalEnvironmentMode: "paper" | "live"` to `WorkspacePreferences` interface
- [x] `electron/shared/validation/schemas.ts:380-389` — Add `globalEnvironmentMode: z.enum(["paper", "live"]).optional()` to `workspacePrefsPatchSchema`
- [x] `electron/main/db/drizzle/meta/_journal.json` — Updated automatically by drizzle-kit

**Dependencies:** None.

**Rollback:** Remove the DB column addition from schema; run migration to drop column. Domain type change is a no-op if field is absent from DB.

---

### Phase 2: State Layer

**Goal:** Expose `environmentMode` in `workspaceStore` so all components can read one value.

**Done criteria:** `useWorkspaceStore.getState().environmentMode` returns `"paper"` on cold boot; returns `"live"` after toggling (tested manually in DevPanel or console).

**Deliverables:**

- [x] `src/store/workspaceStore.ts` — Add `environmentMode: "paper" | "live"` field derived from `preferences.globalEnvironmentMode` (default `"paper"` while loading). Add `setEnvironmentMode(mode)` action that calls `api.patchWorkspacePreferences({ globalEnvironmentMode: mode })` then updates store (also syncs `preferences` from patch response; rolls back on failure)
- [x] `src/lib/exva.ts:151` — Confirm `patchWorkspacePreferences` already accepts the new field (it will, since the Zod schema is updated in Phase 1). No change needed here.

**Dependencies:** Phase 1 complete.

**Rollback:** Remove added fields from store; store falls back gracefully since `preferences` loading already handles null.

---

### Phase 3: Accounts Page Toggle

**Goal:** Render the Paper/Live toggle in the Accounts page header. Toggling it persists to DB and updates the store.

**Done criteria:** Toggle appears to the right of "Accounts" heading. Clicking Live switches to live; clicking Paper switches back. State persists on app restart.

**Deliverables:**

- [x] `src/pages/AccountsPage.tsx:328-342` — Restructure header `<div>` to use `display: flex; justify-content: space-between; align-items: flex-start`. Add toggle control to the right side.
- [x] Toggle component: two-button pill (inline styles). Values: `"paper"` (default, amber color) / `"live"` (green color with visual weight). Reads from `useWorkspaceStore(s => s.environmentMode)`. On click: calls `useWorkspaceStore.getState().setEnvironmentMode(mode)`.
- [x] **Blocking confirmation on Live → Paper:** Before switching from `"live"` to `"paper"`, check for active live sessions (unfiltered `listSessions` — must see all modes). If any exist, show blocking `window.confirm()`: "You have X active live session(s). Switching to Paper will hide them — they will continue running." Cancel aborts; confirm proceeds.
- [x] No new component file required — inline in `AccountsPage.tsx`.

**Dependencies:** Phase 2 complete.

**Rollback:** Revert `AccountsPage.tsx` header section.

---

### Phase 4: TopNav Environment Indicator

**Goal:** Delete `showMock` prop system entirely. Replace with store-driven environment mode pill.

**Done criteria:** TopNav pill reads "Paper" (amber) or "Live" (green) based on store value. No `showMock` reference survives anywhere in the codebase.

**Deliverables:**

- [x] `src/components/TopNav.tsx:44-55` — **DELETE** `showMock: boolean` from Props interface
- [x] `src/components/TopNav.tsx:150-171` — **DELETE** entire `showMock` conditional block. **REWRITE** as: `const environmentMode = useWorkspaceStore(s => s.environmentMode)`, render amber pill "Paper" or green pill "Live". No static strings.
- [x] `src/App.tsx` — **DELETE** `showMock={showMock}` prop, **DELETE** `import { showMock }` import
- [x] `src/lib/exva.ts:387` — **DELETE** `export const showMock = false`
- [x] Verify: `grep -r "showMock" src/` returns zero results

**Dependencies:** Phase 2 complete.

**Rollback:** Revert `TopNav.tsx`, `App.tsx`, `exva.ts`.

---

### Phase 5: Broker List Filtering & Broker Creation

**Goal:** The Brokers page and Accounts page broker section show only accounts matching the global environment. New broker accounts are created with mode auto-set from global environment (mode selector removed).

**Done criteria:** In Paper mode, only paper brokers appear. Switching to Live, only live brokers appear. AddBrokerModal has no mode selector; broker is created with `mode = environmentMode`.

**Deliverables:**

- [x] `src/pages/BrokersPage.tsx` — Add `environmentMode` from store. Filter broker list: `brokers.filter(b => b.mode === environmentMode)`. **DELETE** any existing per-page mode dropdown/filter UI and `{broker.mode}` badges.
- [x] `src/pages/AccountsPage.tsx:707-836` — Same filter. **DELETE** any `{b.mode}` badge or mode-labeling UI that was there for disambiguation (mode is now implied by environment).
- [x] `src/components/accounts/AddBrokerModal.tsx:34` — **DELETE** `const [mode, setMode] = useState<"paper" | "live">("paper")`. Add `const environmentMode = useWorkspaceStore(s => s.environmentMode)`.
- [x] `src/components/accounts/AddBrokerModal.tsx:146,182-189` — **DELETE** mode selector UI block entirely. **DELETE** all `setMode` calls. Pass `mode: environmentMode` directly in form submission.
- [x] Verify: `grep -n "setMode\|useState.*paper.*live" src/components/accounts/AddBrokerModal.tsx` returns zero results.

**Dependencies:** Phase 2 complete.

**Rollback:** Revert `BrokersPage.tsx`, `AccountsPage.tsx` broker section, `AddBrokerModal.tsx`.

---

### Phase 6: Session List Filtering & Session Creation

**Goal:** Sessions page shows only sessions matching global environment. CreateEditSessionModal removes mode toggle; execution mode is auto-set from global environment. Broker picker in modal filters to environment-matching brokers only.

**Done criteria:** In Paper mode, only `paper_only` sessions visible. In Live mode, only `live_allowed` sessions visible. New session modal has no "Paper / Live" toggle section.

**Deliverables:**

- [x] `src/pages/SessionsPage.tsx` — Pass `executionMode` to `api.listSessions()` (backend filter; no client-side `.filter()` on mode). **DELETE** any existing per-page execution mode dropdown.
- [x] `src/components/sessions/CreateEditSessionModal.tsx` — **DELETE** Paper/Live mode toggle UI. Execution Setup section retained for broker assignment only.
- [x] `src/components/sessions/CreateEditSessionModal.tsx` — **DELETE** `modeToggleStyle`, `modeToggleButtonStyle`, `modeToggleButtonActiveStyle` style objects.
- [x] `src/components/sessions/CreateEditSessionModal.tsx` — Form init `useEffect`: set `executionMode: environmentMode === "live" ? "live_allowed" : "paper_only"`. Same for edit. Re-runs when `environmentMode` changes while modal is open.
- [x] `src/components/sessions/CreateEditSessionModal.tsx:161-170` — **DELETE** `const brokerMode = form.executionMode === "live_allowed" ? "live" : "paper"`. **REPLACE** with `const brokerMode = environmentMode`.
- [x] `src/components/sessions/CreateEditSessionModal.tsx:661` — **DELETE** `{broker.mode}` badge in broker picker. Redundant — all shown brokers already match environment.
- [x] Verify: `grep -n "modeToggle\|paper_only\|live_allowed\|executionMode.*form\b" src/components/sessions/CreateEditSessionModal.tsx` — only valid survivors are the `form.executionMode` field set at init.

**Dependencies:** Phase 2 complete.

**Rollback:** Revert `SessionsPage.tsx` and `CreateEditSessionModal.tsx`.

---

### Phase 7: Trades Filtering

**Goal:** Trades page shows only trades matching global environment mode.

**Done criteria:** In Paper mode, only `paper_only` execution mode trades visible. In Live mode, only `live_allowed` trades visible. The manual executionMode dropdown filter in the trades UI is removed.

**Note:** `TradesPage.tsx` already passes `executionMode` to `getActiveTrades()` as a backend filter (`src/pages/TradesPage.tsx:42-48`). The backend already supports this filter. No backend change needed.

**Deliverables:**

- [x] `src/pages/TradesPage.tsx:20` — **DELETE** `const [executionMode, setExecutionMode] = useState<"" | ExecutionMode>("")`. Add `const environmentMode = useWorkspaceStore(s => s.environmentMode)`.
- [x] `src/pages/TradesPage.tsx:48` — **DELETE** `if (executionMode) f.executionMode = executionMode`. **REPLACE** with unconditional `f.executionMode = environmentMode === "live" ? "live_allowed" : "paper_only"`.
- [x] `src/pages/TradesPage.tsx:~177` — **DELETE** the executionMode `<ShadcnSelect>` dropdown from filter UI entirely.
- [x] `src/pages/TradesPage.tsx:50-56` — Remove `executionMode` from `useMemo` dependency array.
- [x] Verify: `grep -n "setExecutionMode\|executionMode.*useState" src/pages/TradesPage.tsx` returns zero results.
- [x] *(beyond plan)* `TradesPage` session dropdown and `WorkspaceContextChip` also pass `executionMode` to `listSessions`; session filter resets on env change.

**Dependencies:** Phase 2 complete.

**Rollback:** Revert `TradesPage.tsx`.

---

### Phase 8: Session Filter Schema (Backend)

**Goal:** Move session environment filtering to the backend. Delete the client-side filter added in Phase 6.

**Done criteria:** `api.listSessions({ executionMode: "paper_only" })` returns only paper sessions from DB. `SessionsPage` sends the filter, does not filter client-side.

**Deliverables:**

- [x] `electron/shared/validation/schemas.ts:348-355` — Add `executionMode: executionModeSchema.optional()` to `sessionListFiltersSchema`
- [x] `electron/main/db/repositories/sessions/session-repo.ts` — Add `WHERE execution_mode = ?` clause when filter present (`SessionListingService` passes filter through to repo; search/instrumentClass remain in-memory)
- [x] `src/pages/SessionsPage.tsx` — Pass `executionMode` in `api.listSessions()` call; no client-side mode filter.

**Dependencies:** Phase 6 complete.

**Rollback:** Revert schema and service changes; restore Phase 6 client-side filter.

---

## 8. Risk Register

| #   | Risk                                                                                | Likelihood | Impact | Mitigation                                                                                               |
| --- | ----------------------------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------- |
| 1   | Live sessions disappear from view after switching to Paper mode while still running | Medium     | Medium | Blocking modal gating the switch — decided                                                               |
| 2   | Dead code from old mode system left behind causing confusion                        | Medium     | Low    | Each phase has an explicit grep verify step. Phase completeness gate: zero survivors of deleted symbols. |
| 3   | Drizzle migration breaks on existing dev DB                                         | Low        | Medium | Run migration on local DB before merging. Default `"paper"` is safe.                                     |
| 4   | Broker picker in session modal shows brokers from wrong mode after toggle change    | Low        | Low    | Broker list re-derives from `environmentMode` via store subscription — updates reactively                |

---

## 9. Success Criteria

| Goal                        | Metric                                           | Baseline        | Target | How Measured                                     |
| --------------------------- | ------------------------------------------------ | --------------- | ------ | ------------------------------------------------ |
| Hard environment separation | Mixed-mode session visibility possible           | Yes (currently) | No     | Manual test: Paper mode shows zero live sessions |
| Toggle persists             | Mode survives app restart                        | N/A             | Yes    | Restart app, confirm mode unchanged              |
| Session creation auto-mode  | User can set wrong execution mode at create time | Yes             | No     | Create session modal — no mode selector visible  |
| Broker list filtered        | Broker page shows brokers of both modes          | Yes             | No     | Paper mode shows only paper brokers              |
| TopNav reflects mode        | TopNav shows static "Connected" / "Mock"         | Yes (hardcoded) | No     | TopNav shows "Paper" or "Live" dynamically       |

**Leading indicators:** Phase 1 migration completes without boot errors. Phase 2 store field accessible in DevPanel.

**Dead code audit (completed 2026-05-21):**

```bash
grep -rn "showMock" src/                          # → 0 results ✓
grep -rn "modeToggleStyle" src/                   # → 0 results ✓
grep -rn "setMode.*paper\|useState.*paper.*live" src/  # → 0 results ✓
grep -rn "executionMode.*useState" src/pages/     # → 0 results ✓
grep -rn "form\.executionMode" src/components/sessions/CreateEditSessionModal.tsx  # → init assignment only ✓
```

**Intentional exceptions (not filtered by global env):**

- `TopNav` focused-session lookup by ID — focused session may be live while user is in Paper mode (after confirmed switch); session continues running.
- `AccountsPage` Live→Paper guard — uses unfiltered `listSessions` to detect active live sessions.
- `DevPanel` — developer tool; lists all sessions regardless of env.

**Lagging indicator:** Zero reports of accidental live orders from paper-mode sessions.

---

## 10. Open Questions

| #   | Question                                                                                  | Owner | Needed By      | Status                                                                                               |
| --- | ----------------------------------------------------------------------------------------- | ----- | -------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Should switching from Live → Paper while a live session is active show a warning modal?   | Ken   | Phase 3 start  | **Implemented: blocking `window.confirm()` on Accounts page**                                        |
| 2   | Do trade rows in `TradesPage` already carry `executionMode`?                              | Ken   | Phase 7 start  | **Closed: yes — `getActiveTrades` already accepts `executionMode` filter; no backend change needed** |
| 3   | Should the edit flow for existing sessions show the mode read-only, or allow changing it? | Ken   | Phase 6 start  | **Closed: no existing sessions, edit sets mode from global env same as create**                      |
| 4   | Is there a use case for comparing paper vs live P&L in the same view?                     | Ken   | Before Phase 1 | **Decided: no — paper and live are fully separated**                                                 |

---

## 11. Alternatives Rejected

| Option                                                                    | Why Rejected                                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Client-side only toggle (no DB persistence)                               | Resets on restart; inconsistent with existing preference pattern (`globalIncludeArchived`)                      |
| Per-page mode filter (dropdown on each page)                              | Requires user to set mode on every page; fragmented; doesn't prevent creation of mismatched records             |
| Separate "paper workspace" and "live workspace" at the window level       | Overkill for current use case; requires multi-workspace architecture that doesn't exist                         |
| Adding `executionMode` filter to session list API only (no global toggle) | Solves display issue but not the creation-time problem; user still has to remember to pick mode on each session |
