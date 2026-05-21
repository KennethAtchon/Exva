# Global Environment Mode Toggle — Plan

> **Date:** 2026-05-20
> **Status:** Draft
> **Deciders:** Kenneth Atchon

---

## 1. Problem Statement

Today the app has no concept of a global paper/live environment. Every session independently chooses `executionMode: "paper_only" | "live_allowed"`, and every broker account independently holds `mode: "paper" | "live"`. This means a user can accidentally assign a live broker to a paper session, or create sessions with mixed modes, or look at a sessions list that blends real-money trades with paper runs without any visual separation.

The deeper issue: there is no hard boundary between the "test" and "production" worlds. A user operating in a live trading environment must mentally track which rows are real. A user developing a new strategy may accidentally trigger a live order because the per-session mode was inherited from a template. The app treats paper vs live as an optional attribute of individual records rather than as a workspace-level environment stance.

This refactor adds a single workspace-level toggle — **Paper** vs **Live** — that becomes the authoritative source of truth for the environment the user is operating in. Every subsequent UI decision (which sessions are visible, what mode a new session gets, which brokers are shown, what the create modal defaults to) derives from this single toggle. The toggle surfaces in the Accounts page header as requested, and its state is reflected in the TopNav.

---

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
|---|------|--------------------|
| 1 | Single global toggle for Paper vs Live on the Accounts page | Toggle persists to DB, survives app restart |
| 2 | Session lists filter to show only sessions matching the active environment | Paper mode: only `paper_only` sessions visible. Live mode: only `live_allowed` sessions visible |
| 3 | Broker lists filter to show only broker accounts matching the active environment | Paper mode: only `mode="paper"` accounts shown |
| 4 | Session creation auto-sets `executionMode` from global mode; per-session mode toggle removed | No ambiguity in create flow |
| 5 | Broker creation auto-sets `mode` from global mode; per-broker mode selector removed | Brokers always match the environment they were created in |
| 6 | TopNav environment indicator reflects global mode | Visual signal is always accurate |
| 7 | All list-level `executionMode` / broker `mode` filter logic is eliminated from individual components | Components read one global value, not per-record mode |

**Non-Goals**

| # | Non-Goal | Reason |
|---|----------|--------|
| 1 | Migrating existing sessions/brokers to match a mode | Data already in DB retains its mode; filtering just shows the right subset |
| 2 | Per-session mode override once the global toggle exists | Explicit scope of this refactor: one mode, no overrides |
| 3 | Role-based access control on live mode | Out of scope; no multi-user model today |
| 4 | Modifying broker adapter endpoint logic | Already correct per `BrokerAccount.mode`; unchanged |
| 5 | Changing the `LiveReadinessModal` / live readiness gate | Gate is already correct; it validates at session start based on broker mode |
| 6 | API/backend filtering by mode at the DB query level | Frontend filtering is sufficient; DB queries remain unchanged |

---

## 3. Background & Context

### Current State

**Data model:**

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

**Session start gate** (`electron/main/services/session/session-service.ts:31-44`):
If `executionMode === "live_allowed"`, `liveReadiness.check()` validates that ALL assigned brokers have `mode === "live"` and user has acknowledged. This gate is sound and does not need to change.

**Broker endpoint selection** (`electron/main/services/broker/adapters/alpaca-adapter.ts:24-27`):
Already uses `account.mode` to pick `paper-api.alpaca.markets` vs `api.alpaca.markets`. Correct and unchanged.

**Current UI toggles that will be removed:**
- `CreateEditSessionModal.tsx:572-610` — "Paper / Live" button pair that sets `form.executionMode`
- `AddBrokerModal.tsx:34,146,182-189` — `mode` state + mode selector UI

**Current mock indicator:**
`TopNav.tsx:150-171` receives `showMock: boolean` prop (from `exva.ts:387` hardcoded `false`). Currently static. This becomes the environment mode indicator.

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

| Dimension | Assessment |
|-----------|------------|
| Complexity | Zero build cost |
| Performance | No change |
| Reliability | Current bugs remain (mixed-mode session lists) |
| Cost | $0 engineering |
| Reversibility | N/A |
| Stack fit | N/A |
| Team readiness | N/A |

**Risks:** Users continue mixing paper and live data in the same view. Live order risk from wrong mode on session creation remains. No hard environment boundary.

---

### Option B: Client-side Only Toggle (No DB Persistence)

Add a React state variable in `App.tsx` for `environmentMode`, pass it down via props or Context. Does not write to DB. Resets to "paper" on every app restart.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — no schema changes, no migration |
| Performance | No IPC round trip on toggle |
| Reliability | Resets on restart — users must re-select live mode each session |
| Cost | ~1 day |
| Reversibility | Easy to extend later |
| Stack fit | Against existing pattern — preferences that matter live in DB |
| Team readiness | Easy |

**Risks:** Forgetting live mode is off by default could cause confusion. Inconsistent with how `globalIncludeArchived` is handled. Not a durable signal.

---

### Option C: Persisted Global Mode in `workspacePreferences` (Recommended)

Add `globalEnvironmentMode: "paper" | "live"` to `workspacePreferences`. Surface in `WorkspacePreferences` type, `workspacePrefsPatchSchema`, Zustand store. Build toggle in Accounts page header. All list views filter by this value. Session and broker creation auto-sets mode from this value and removes redundant per-record mode selectors.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — schema migration + 8-12 files changed, all mechanical |
| Performance | One extra field in existing `getWorkspaceView` response; negligible |
| Reliability | Survives restart; consistent with existing prefs pattern |
| Cost | ~3-4 days engineering |
| Reversibility | Fully reversible — field can be ignored without removing it |
| Stack fit | Exact match of existing `globalIncludeArchived` pattern |
| Team readiness | Pattern is already in codebase; low ramp |

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
- [ ] `electron/main/db/schema.ts:325` — Add column `globalEnvironmentMode: text("global_environment_mode").notNull().default("paper")` to `workspacePreferences` table
- [ ] Generate Drizzle migration: `bunx drizzle-kit generate` → produces `electron/main/db/drizzle/0001_global_env_mode.sql`
- [ ] `electron/shared/domain/workspace.ts:87-95` — Add `globalEnvironmentMode: "paper" | "live"` to `WorkspacePreferences` interface
- [ ] `electron/shared/validation/schemas.ts:380-389` — Add `globalEnvironmentMode: z.enum(["paper", "live"]).optional()` to `workspacePrefsPatchSchema`
- [ ] `electron/main/db/drizzle/meta/_journal.json` — Updated automatically by drizzle-kit

**Dependencies:** None.

**Rollback:** Remove the DB column addition from schema; run migration to drop column. Domain type change is a no-op if field is absent from DB.

---

### Phase 2: State Layer

**Goal:** Expose `environmentMode` in `workspaceStore` so all components can read one value.

**Done criteria:** `useWorkspaceStore.getState().environmentMode` returns `"paper"` on cold boot; returns `"live"` after toggling (tested manually in DevPanel or console).

**Deliverables:**
- [ ] `src/store/workspaceStore.ts` — Add `environmentMode: "paper" | "live"` field derived from `preferences.globalEnvironmentMode` (default `"paper"` while loading). Add `setEnvironmentMode(mode)` action that calls `api.patchWorkspacePreferences({ globalEnvironmentMode: mode })` then updates store
- [ ] `src/lib/exva.ts:151` — Confirm `patchWorkspacePreferences` already accepts the new field (it will, since the Zod schema is updated in Phase 1). No change needed here.

**Dependencies:** Phase 1 complete.

**Rollback:** Remove added fields from store; store falls back gracefully since `preferences` loading already handles null.

---

### Phase 3: Accounts Page Toggle

**Goal:** Render the Paper/Live toggle in the Accounts page header. Toggling it persists to DB and updates the store.

**Done criteria:** Toggle appears to the right of "Accounts" heading. Clicking Live switches to live; clicking Paper switches back. State persists on app restart.

**Deliverables:**
- [ ] `src/pages/AccountsPage.tsx:328-342` — Restructure header `<div>` to use `display: flex; justify-content: space-between; align-items: flex-start`. Add toggle control to the right side.
- [ ] Toggle component: two-button pill (reuse `modeToggleStyle` from `CreateEditSessionModal` or inline equivalent). Values: `"paper"` (default, amber color) / `"live"` (red/green color with visual weight). Reads from `useWorkspaceStore(s => s.environmentMode)`. On click: calls `useWorkspaceStore.getState().setEnvironmentMode(mode)`.
- [ ] No new component file required — inline in `AccountsPage.tsx`.

**Dependencies:** Phase 2 complete.

**Rollback:** Revert `AccountsPage.tsx` header section.

---

### Phase 4: TopNav Environment Indicator

**Goal:** Replace the static `showMock` prop / mock indicator with a live read of global environment mode.

**Done criteria:** TopNav pill reads "Paper" (amber) or "Live" (green) based on store value. Switching the toggle on Accounts page updates TopNav in real time.

**Deliverables:**
- [ ] `src/components/TopNav.tsx:44-55` — Remove `showMock: boolean` from Props interface
- [ ] `src/components/TopNav.tsx:150-171` — Replace `showMock` conditional with `const environmentMode = useWorkspaceStore(s => s.environmentMode)`. Render amber pill labeled "Paper" or green pill labeled "Live" accordingly. Remove the static "Connected to live broker data feed" / "Mock data" text.
- [ ] `src/App.tsx` — Remove `showMock={showMock}` prop from `<TopNav>` call
- [ ] `src/lib/exva.ts:387` — Remove or leave `showMock = false` export (check if any other consumers remain; if none, delete)

**Dependencies:** Phase 2 complete.

**Rollback:** Revert `TopNav.tsx` and `App.tsx`; restore `showMock` prop.

---

### Phase 5: Broker List Filtering & Broker Creation

**Goal:** The Brokers page and Accounts page broker section show only accounts matching the global environment. New broker accounts are created with mode auto-set from global environment (mode selector removed).

**Done criteria:** In Paper mode, only paper brokers appear. Switching to Live, only live brokers appear. AddBrokerModal has no mode selector; broker is created with `mode = environmentMode`.

**Deliverables:**
- [ ] `src/pages/BrokersPage.tsx` — Filter broker list: `brokers.filter(b => b.mode === environmentMode)`. Import `useWorkspaceStore`.
- [ ] `src/pages/AccountsPage.tsx:707-836` — Same filter on broker accounts displayed in the right column.
- [ ] `src/components/accounts/AddBrokerModal.tsx:34` — Remove `const [mode, setMode] = useState<"paper" | "live">("paper")`. Add `const environmentMode = useWorkspaceStore(s => s.environmentMode)`.
- [ ] `src/components/accounts/AddBrokerModal.tsx:146,182-189` — Remove mode selector UI entirely. Replace all `mode` state references with `environmentMode` from store.
- [ ] `src/components/accounts/AddBrokerModal.tsx` — Update form submission to pass `mode: environmentMode` to the broker creation API.

**Dependencies:** Phase 2 complete.

**Rollback:** Revert `BrokersPage.tsx`, `AccountsPage.tsx` broker section, `AddBrokerModal.tsx`.

---

### Phase 6: Session List Filtering & Session Creation

**Goal:** Sessions page shows only sessions matching global environment. CreateEditSessionModal removes mode toggle; execution mode is auto-set from global environment. Broker picker in modal filters to environment-matching brokers only.

**Done criteria:** In Paper mode, only `paper_only` sessions visible. In Live mode, only `live_allowed` sessions visible. New session modal has no "Paper / Live" toggle section.

**Deliverables:**
- [ ] `src/pages/SessionsPage.tsx` — Filter sessions: `sessions.filter(s => s.executionMode === (environmentMode === "live" ? "live_allowed" : "paper_only"))`. Import `useWorkspaceStore`.
- [ ] `src/components/sessions/CreateEditSessionModal.tsx:572-610` — Remove the entire "Mode" field and its `<Field label="Mode">` block (the paper/live button pair). The `form.executionMode` value is now always derived from `environmentMode` at form init time.
- [ ] `src/components/sessions/CreateEditSessionModal.tsx` — On `useEffect` that initializes `form`, set `executionMode: environmentMode === "live" ? "live_allowed" : "paper_only"`. If editing an existing session, keep its existing `executionMode` but display it read-only.
- [ ] `src/components/sessions/CreateEditSessionModal.tsx:161-170` — Update broker mode filter: `const brokerMode = environmentMode` (replaces the `form.executionMode` derivation). This already existed as `const brokerMode = form.executionMode === "live_allowed" ? "live" : "paper"` — now just reads from store.
- [ ] `src/components/sessions/CreateEditSessionModal.tsx:661` — `{broker.mode}` badge in broker picker: consider hiding since all brokers shown already match mode. Leave as-is or remove.

**Dependencies:** Phase 2 complete.

**Note on edit flow:** When editing an existing session, its `executionMode` is already fixed in DB. Render a read-only mode badge ("This is a live session") rather than a toggle. Do not allow mode change on edit — that's a separate concern.

**Rollback:** Revert `SessionsPage.tsx` and `CreateEditSessionModal.tsx`.

---

### Phase 7: Trades Filtering

**Goal:** Trades page shows only trades from sessions matching global environment mode.

**Done criteria:** In Paper mode, only trades from `paper_only` sessions visible. In Live mode, only trades from `live_allowed` sessions visible.

**Deliverables:**
- [ ] `src/pages/TradesPage.tsx` — Check if trades already have `executionMode` on the row or join it from session. If present, filter: `trades.filter(t => t.executionMode === targetMode)`. If not, check what fields exist on the trade row.
- [ ] If trade rows lack `executionMode`: add it to the trade list response (backend `listActive` or `listAll` query can join `sessions.execution_mode`). This may require a backend change to `electron/main/services/` trade listing.
- [ ] `src/pages/TradesPage.tsx` — Import `useWorkspaceStore`, derive filter.

**Dependencies:** Phase 2 complete. Backend trade listing join may require investigation.

**Rollback:** Revert `TradesPage.tsx`; revert any backend query changes.

---

### Phase 8: Session Filter Schema (Backend — Optional Enhancement)

**Goal:** Pass `executionMode` filter to the backend session list query instead of filtering client-side. Reduces payload size in workspaces with many sessions.

**Done criteria:** `api.listSessions({ executionMode: "paper_only" })` returns only paper sessions from the DB.

**Deliverables:**
- [ ] `electron/shared/validation/schemas.ts:348-355` — Add `executionMode: executionModeSchema.optional()` to `sessionListFiltersSchema`
- [ ] `electron/main/services/session/session-listing-service.ts` — Apply `WHERE execution_mode = ?` when filter is set
- [ ] `src/pages/SessionsPage.tsx` — Pass `executionMode` filter to `api.listSessions()` call instead of client-side `.filter()`

**Dependencies:** Phase 6 complete.

**Note:** Phase 6 client-side filter is sufficient for correctness. Phase 8 is a clean-up to avoid over-fetching. Can be deferred.

**Rollback:** Revert schema and service changes; restore client-side filter from Phase 6.

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Existing live sessions disappear from view after switching to Paper mode while still running | Medium | Medium — user loses visibility into running session | Add warning on toggle: "You have active live sessions. Switching to Paper will hide them." |
| 2 | Drizzle migration fails on old DB file (existing users) | Low | High — app won't boot | Test migration on existing DB snapshot before shipping. Default "paper" is safe. |
| 3 | Broker created in Paper mode is assigned to a session after user switches to Live mode | Low (filter prevents it) | Medium | Filter in broker picker already keyed to `environmentMode` — only matching brokers shown |
| 4 | `WorkspacePreferences` type used in IPC `patchPreferences` endpoint expects exact shape; adding a field breaks `strict()` Zod parse | Low | Medium | `workspacePrefsPatchSchema` uses `.optional()` for all fields; adding the new field optional maintains backwards compat |
| 5 | TradesPage doesn't have `executionMode` on trade rows — Phase 7 requires backend query change | Medium | Low-Medium | Investigate in Phase 7 before committing to approach |

---

## 9. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
|------|--------|----------|--------|--------------|
| Hard environment separation | Mixed-mode session visibility possible | Yes (currently) | No | Manual test: Paper mode shows zero live sessions |
| Toggle persists | Mode survives app restart | N/A | Yes | Restart app, confirm mode unchanged |
| Session creation auto-mode | User can set wrong execution mode at create time | Yes | No | Create session modal — no mode selector visible |
| Broker list filtered | Broker page shows brokers of both modes | Yes | No | Paper mode shows only paper brokers |
| TopNav reflects mode | TopNav shows static "Connected" / "Mock" | Yes (hardcoded) | No | TopNav shows "Paper" or "Live" dynamically |

**Leading indicators:** Phase 1 migration completes without boot errors. Phase 2 store field accessible in DevPanel.

**Lagging indicator:** Zero reports of accidental live orders from paper-mode sessions.

---

## 10. Open Questions

| # | Question | Owner | Needed By | Status |
|---|----------|-------|-----------|--------|
| 1 | Should switching from Live → Paper while a live session is active show a warning modal? | Ken | Phase 3 start | Open |
| 2 | Do trade rows in `TradesPage` already carry `executionMode` from their parent session, or does the backend query need to join it? | Ken | Phase 7 start | Open — requires reading `TradesPage.tsx` data shape |
| 3 | Should the edit flow for existing sessions show the mode read-only, or allow changing it (with a re-validation of live readiness)? | Ken | Phase 6 start | Open |
| 4 | Is there a case where a user needs to compare paper vs live P&L in the same Dashboard view? If so, the global toggle approach hides one half. | Ken | Before Phase 1 | Open |

---

## 11. Alternatives Rejected

| Option | Why Rejected |
|--------|-------------|
| Client-side only toggle (no DB persistence) | Resets on restart; inconsistent with existing preference pattern (`globalIncludeArchived`) |
| Per-page mode filter (dropdown on each page) | Requires user to set mode on every page; fragmented; doesn't prevent creation of mismatched records |
| Separate "paper workspace" and "live workspace" at the window level | Overkill for current use case; requires multi-workspace architecture that doesn't exist |
| Adding `executionMode` filter to session list API only (no global toggle) | Solves display issue but not the creation-time problem; user still has to remember to pick mode on each session |
