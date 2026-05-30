# Create Session — Signal-Based Scope & Usability Fixes — Feature Specification

> **Date:** 2026-05-29
> **Status:** Draft
> **Feature area:** Session creation (`CreateEditSessionModal`)
> **Depends on:** Signal-driven architecture (signal sources, `session_signal_sources` join, `subscribedSourceIds` on `SessionCreateInput`) — already shipped through Phase 6.

---

## 1. Summary

The Create/Edit Session modal currently treats instrument scope (instrument classes + manual tickers) and signal-source subscriptions as two unrelated sections. That is backwards: instrument scoping only makes sense for _search-style_ signals (Web Search), and is meaningless for _listener-style_ signals (EDGAR 8-K), which fire on their own. This spec restructures the modal so **the signal source is chosen first, and instrument filtering appears only when the chosen signal needs it.** It also fixes broker allocation defaulting to `$0` (auto-seed to ~20% of free capital) and a set of small usability defects in the same flow.

This is UI/UX restructuring of an existing modal plus one allocation-defaulting behavior change. No schema changes. No new IPC endpoints.

---

## 2. User Story

> **As an** operator creating a trading session,
> **I want to** pick the signal that drives the session first, then only fill in the filtering that signal actually needs,
> **So that** I'm not forced to pick instrument classes and tickers for a listener that ignores them, and I'm never confused about which inputs matter.

Secondary:

> **As an** operator assigning a broker to a session,
> **I want** the allocation to pre-fill to a sensible non-zero amount,
> **So that** I don't have to manually type a number every time and can't accidentally create a session with `$0` allocated.

---

## 3. Scope

**In scope:**

1. Reorder the modal so **Signal Sources** is selected before instrument scoping.
2. Make the **instrument filter** (instrument classes + manual tickers) a _conditional_ sub-block that renders **only when at least one search-style source (`web_search`) is subscribed**, or when the session is in manual-only mode (no sources). For listener-style sources (`edgar_8k`) only, the filter is hidden and replaced with an "automatic listener" explainer.
3. Keep the **Search provider override** control, but relocate it into the instrument-filter block (it only matters for search-style signals).
4. **Broker allocation default:** when a broker is checked, seed `allocatedUsd` to **20% of that broker's free capital**, clamped to not exceed remaining free capital; fall back sensibly when free capital is unknown.
5. Small usability fixes in the modal (enumerated in §5.4 / §9 / §10): broken placeholder, allocation onChange fallback, quick-fill allocation controls, clearer empty/readiness states.

**Out of scope:**

- Any change to signal-source _creation/config_ (the Signal Sources page, `AddSourceDialog`, `ConfigureSourceDialog`). Untouched.
- Changing how the runtime consumes `instrumentScope` / subscriptions. The data contract (`SessionCreateInput`) is unchanged.
- Per-source instrument scoping persisted on the source itself. Manual tickers remain a session-level field (`instrumentScope`).
- Strategy Config tabs, Session drawer, Session card. Untouched by this spec.
- Removing manual-only sessions. A session with zero sources + manual tickers still works (run-once evaluation), unchanged.
- Multi-currency allocation. Allocation stays USD as today.

---

## 4. Conceptual Model

**Paradigm:** an automatic signal should not depend on operator-supplied tickers — requiring the operator to pre-list symbols defeats the point of automation. Tickers are a **fallback that exists only when the signal method has no inherent edge of its own.** A web search has no edge: it needs the operator to say _what to look at_. EDGAR 8-K does have an edge — the filing itself carries the symbol and the catalyst — so it must never ask for a ticker. The UI formalizes that split:

| Source `type`       | Kind               | Carries its own subject?                        | Operator ticker input?                                 | UI behavior                                       |
| ------------------- | ------------------ | ----------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| `web_search`        | **Search-style**   | No — search must be aimed                       | **Yes** — operator scopes instrument classes + tickers | Subscribing reveals the instrument-filter block   |
| `edgar_8k`          | **Listener-style** | **Yes** — filing supplies symbol + catalyst     | **No** — never                                         | Subscribing reveals an "automatic, no setup" note |
| _(none subscribed)_ | **Manual-only**    | No source — tickers are the only run-once input | Yes — tickers are the input                            | Instrument-filter block shown (fallback path)     |

Rule for whether the **instrument-filter block** renders:

```
showInstrumentFilter =
  anySubscribedSourceIsSearchStyle   // ≥1 subscribed source with type "web_search"
  OR noSourcesSubscribedAtAll        // manual-only fallback session
```

`edgar_8k`-only subscriptions → block hidden, **and the session carries no tickers** (see §6.1: `instrumentScope` is cleared to empty on save for listener-only sessions). The ticker field is not a property of an EDGAR session — it is a property of search-style/manual scoping.

This is a pure render-time derivation from `subscribedSourceIds` + the loaded `signalSources` list. No new persisted state.

---

## 5. Screens & Layout

### 5.1 Modal — `CreateEditSessionModal`

**Route / location:** Modal overlay on `SessionsPage` (`src/components/sessions/CreateEditSessionModal.tsx`). Opened by "Create Session" / "Refine Session".

**When it appears:** User clicks Create Session, or Refine on an existing session, or instantiates a template.

**New section order (top to bottom):**

```
Create Session modal
├── Header: "Create Session" / "Refine Session"
│   └── Caption: "Identity, signal scope, and execution routing in one place."
├── [Banner area] template-warning / error banners (unchanged)
├── §A Identity (unchanged)
│   ├── Session name (input)
│   └── Objective (textarea)
├── §B Signal Sources              ← MOVED UP (was 4th, now 2nd)
│   ├── Caption: "Pick what drives this session. Choose a signal first."
│   ├── [empty] hint when no global sources exist (+ "Open Signal Sources →")
│   ├── Source toggle rows (one per non-manual global source)
│   │   ├── Switch (subscribe)
│   │   ├── Source name
│   │   ├── Kind chip: "Search" (web_search) | "Listener" (edgar_8k)
│   │   └── Helper: type description + "Disabled globally…" when source.enabled = false
│   └── Readiness summary card (derived, always visible)
├── §C Signal Scope  (CONDITIONAL — see render rule §4)
│   ├── When search-style/manual-only:
│   │   ├── Caption: "Tell the web search what to look at."
│   │   ├── Search provider override (select)   ← MOVED here from Task Boundary
│   │   ├── Instrument classes (chips)
│   │   ├── [conditional] Research focus (select) — search-everything mode only (unchanged logic)
│   │   └── Manual tickers (textarea)
│   └── When edgar-only:
│       └── Info note: "EDGAR 8-K is an automatic listener. No instruments to pick —
│            it responds to filings as they happen."
├── §D Execution Setup (broker accounts)
│   ├── Broker checkbox rows (unchanged)
│   ├── "Select all {mode} brokers" button (unchanged)
│   ├── Allocation rows per assigned broker
│   │   ├── Broker name + Balance / Free
│   │   ├── Allocation input (USD)   ← default seeding changed (§6.2)
│   │   └── Quick-fill chips: "20%" · "50%" · "Max"   ← NEW
│   └── Coverage line (good / uncovered classes) — unchanged
└── Footer
    ├── Readiness helper text (left)
    └── Cancel · Create/Save Session (right)
```

**Renamed:** The section formerly titled **"Task Boundary"** ("Scope and search-provider behavior") is dissolved. Its search-provider control and instrument inputs move into **§C Signal Scope**. The title "Task Boundary" is removed from the UI.

**Layout rules:**

- §C mounts/unmounts based on `showInstrumentFilter`. When it unmounts (e.g., operator unsubscribes the last web_search source leaving only EDGAR), the underlying `form.instrumentScope` / `form.instrumentClasses` values are retained in state, not cleared (Open Question 1).
- Quick-fill chips (§D) sit inline to the right of / below each allocation input, right-aligned within the allocation row.
- Existing responsive/scroll behavior of the modal is unchanged (`max-h-[92vh]` scroll container).

**Empty states:**

| Area              | Condition                          | What the user sees                                                                                                              |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| §B Signal Sources | No non-manual global sources exist | Hint: "No automated signal sources configured yet. You can still run from manual tickers below." + "Open Signal Sources →" link |
| §C Signal Scope   | edgar-only subscription            | Info note (see tree above); no inputs                                                                                           |
| §D Brokers        | No brokers in current mode         | Hint: "No {mode} broker accounts found. Add one in Accounts." (unchanged)                                                       |

**Loading states:** Sources / brokers / providers load via existing effects. Until `signalSources` resolves, §B shows its existing render (no skeleton today — not adding one; Open Question 3).

### 5.2 §B Signal Sources — element inventory

| Element                 | Type        | Label / Content         | State                        | Action on Interact                                      |
| ----------------------- | ----------- | ----------------------- | ---------------------------- | ------------------------------------------------------- |
| Source subscribe switch | Switch      | —                       | On = subscribed              | Adds/removes `source.id` in local `subscribedSourceIds` |
| Kind chip               | Badge       | "Search" or "Listener"  | Static per source type       | none                                                    |
| "Open Signal Sources →" | Button/link | "Open Signal Sources →" | Shown only when zero sources | Navigates to `/signals`                                 |
| Readiness card          | Static text | derived (see §5.5)      | always                       | none                                                    |

### 5.3 §C Signal Scope — element inventory

| Element                  | Type          | Label / Content                                | State                                                          | Action on Interact                                               |
| ------------------------ | ------------- | ---------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Search provider override | Select        | "Search provider override"                     | Default = "Workspace default (…)"                              | Sets `form.defaultSearchProviderId` (null for workspace default) |
| Instrument class chip    | Checkbox chip | Stocks / Crypto / Futures / Prediction Markets | Disabled in search-everything mode (unchanged)                 | Toggles `form.instrumentClasses`                                 |
| Research focus           | Select        | "Research focus"                               | Visible only in search-everything mode w/ >1 class (unchanged) | Rewrites `instrumentScope` focus token (unchanged)               |
| Manual tickers           | Textarea      | "Manual tickers"                               | —                                                              | Sets `form.instrumentScope`                                      |

### 5.4 §D Execution Setup — element inventory (changes only)

| Element          | Type         | Label / Content | State                             | Action on Interact                                                                      |
| ---------------- | ------------ | --------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| Allocation input | Number input | per broker      | min 0; pre-seeded on check (§6.2) | Sets `allocatedUsd`; empty string treated as 0, **not** as 10%-of-balance (bug fix §10) |
| "20%" chip       | Button       | "20%"           | Shown per allocation row          | Sets `allocatedUsd = round(0.20 × freeCapitalUsd)`                                      |
| "50%" chip       | Button       | "50%"           | Shown per allocation row          | Sets `allocatedUsd = round(0.50 × freeCapitalUsd)`                                      |
| "Max" chip       | Button       | "Max"           | Shown per allocation row          | Sets `allocatedUsd = freeCapitalUsd`                                                    |

Quick-fill chips are disabled (or hidden) when `freeCapitalUsd == null`.

### 5.5 States this modal can be in

| State                 | Condition                                         | What the user sees                                                          |
| --------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| Loading seed          | Editing existing session, payload fetch in flight | Existing behavior (no spinner today); inputs populate when resolved         |
| Default (manual-only) | No sources subscribed                             | §C visible, tickers are the input, readiness = `manual_only` or `no_inputs` |
| Search-armed          | ≥1 enabled `web_search` subscribed                | §C visible, readiness `armed`/`manual_only`                                 |
| Listener-only         | only `edgar_8k` subscribed, ≥1 enabled            | §C shows automatic-listener note, readiness `armed`                         |
| Waiting               | subscribed sources all globally disabled          | readiness `waiting_for_source_enable`, yellow footer warning                |
| No inputs             | no sources + no tickers                           | readiness `no_inputs`, yellow footer warning, Create disabled by `isValid`  |
| Saving                | Save in flight                                    | Button "Saving…", disabled                                                  |
| Error                 | Save threw                                        | Red error banner with message (unchanged)                                   |

---

## 6. Data & Field Mapping

No schema changes. No DTO changes. All fields already exist on `SessionCreateInput` (`electron/shared/ipc/dto.ts:49`).

### 6.1 Fields touched

| UI Label / Element       | Field on `SessionCreateInput`      | Type                | Required           | Validation                               | Notes                                                                                             |
| ------------------------ | ---------------------------------- | ------------------- | ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Manual tickers           | `instrumentScope`                  | `string`            | Yes when §C shown  | non-empty when block visible (`isValid`) | **Cleared to `""` on save when §C is hidden (listener-only).** Tickers are not an EDGAR property. |
| Instrument classes       | `instrumentClasses`                | `InstrumentClass[]` | ≥1 effective class | `effectiveInstrumentClasses.length > 0`  | Derived w/ broker classes as today                                                                |
| Search provider override | `defaultSearchProviderId`          | `string \| null`    | No                 | —                                        | `null` = workspace default                                                                        |
| Subscribe toggles        | `subscribedSourceIds`              | `string[]`          | No                 | —                                        | Drives §C visibility                                                                              |
| Broker allocation        | `brokerAssignments[].allocatedUsd` | `number`            | ≥0                 | `Math.max(0, …)`                         | **Default seeding changed — §6.2**                                                                |

`selectionMode` stays hard-coded `"manual_shortlist"` and `selectorSettings.aiPickerEnabled` stays `true` on submit (unchanged — these are legacy fields the runtime still expects; not surfaced in UI).

**Listener-only save rule:** on submit, if `showInstrumentFilter === false` (i.e. ≥1 source subscribed and none are search-style), send `instrumentScope: ""`. The operator never sees tickers for EDGAR, and the session is not stamped with phantom symbols. `instrumentClasses` is still sent (broker-derived; used for coverage).

### 6.2 Broker allocation default — behavior change

**Today:** checking a broker pushes `{ brokerAccountId, allocatedUsd: 0 }` (`toggleBrokerAssignment`, line ~951; `mergeUniqueBrokerAssignments`, line ~976). Operator must hand-type every allocation; forgetting yields a `$0` session.

**New default seed,** applied when a broker is newly added (via checkbox or "Select all"):

```
function defaultAllocationUsd(broker): number {
  const free = broker.freeCapitalUsd;
  if (free != null && free > 0) {
    return Math.round(free * 0.20);   // 20% of free capital
  }
  const balance = broker.balanceCacheUsd;
  if (balance != null && balance > 0) {
    return Math.round(balance * 0.20); // fall back to 20% of balance
  }
  return 0;                            // unknown → 0, operator fills in
}
```

- "20% of the free, if not the remaining of the free" → seed 20% of free capital; since this is the _initial_ assignment, 20% is always ≤ free, so no clamp needed on first add. The clamp matters only for the "Max"/manual paths (do not seed above `freeCapitalUsd`).
- Rounded to whole USD (`Math.round`) to avoid noisy decimals.
- Operator can edit afterward, but **over-allocation is hard-blocked:** when any assigned broker has `allocatedUsd > freeCapitalUsd` (free known), the Create/Save button is disabled and an inline error shows on the offending row. See §9.

### 6.3 Schema changes required

**None.**

---

## 7. API Contract

No new or modified endpoints. The flow continues to use existing IPC:

- `api.listSignalSources()` — load global sources (filter out `type === "manual"`), already called.
- `api.getSessionSignalSubscriptions(sessionId)` — load existing subscriptions when editing, already called.
- `api.listBrokerAccountState()` — broker accounts incl. `freeCapitalUsd` / `balanceCacheUsd`, already called.
- `api.listProviders()` + `api.getWorkspaceView()` — search providers + workspace default, already called.
- `onSubmit(input, sessionId?)` — persists `SessionCreateInput` incl. `subscribedSourceIds`, already wired (`session.create` / `session.update`). Subscriptions persisted via existing write path.

**Side effects:** unchanged from today.

---

## 8. Permissions & Access Control

Single-operator desktop app; no role system. The modal is available to the local operator. No permission gating added or changed.

---

## 9. Error States & Edge Cases

| Scenario                                          | Trigger                               | What the user sees                                                                 | What the system does                                                            |
| ------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Unsubscribe last web_search, leaving EDGAR only   | Toggle off                            | §C unmounts, replaced by automatic-listener note                                   | On save `instrumentScope` sent as `""`; EDGAR session carries no tickers (§6.1) |
| Re-subscribe a web_search source                  | Toggle on                             | §C remounts; ticker/class values retained in form state reappear                   | none (clearing only happens at save-time for listener-only)                     |
| EDGAR-only session save                           | Save                                  | Allowed if broker coverage OK; tickers not required                                | `instrumentScope` sent empty; `isValid` does not require tickers in this mode   |
| Broker free capital unknown (`null`)              | Check broker                          | Allocation seeds to 0; quick-fill chips disabled                                   | operator types amount manually                                                  |
| Allocation field cleared                          | User deletes number                   | Field shows empty, treated as `0`                                                  | **No longer** jumps to 10%-of-balance (bug fix)                                 |
| Over-allocation (`allocatedUsd > freeCapitalUsd`) | Manual type / "Max" then balance drop | Inline error on the row: "Exceeds free capital (${free})."; Create/Save disabled   | **Hard-blocked** — save cannot proceed until allocation ≤ free                  |
| No live inputs                                    | No sources + no tickers               | Yellow footer "No live inputs — session will wait idle on start."; Create disabled | `isValid` false                                                                 |
| Sources fail to load                              | IPC throws                            | §B shows the no-sources empty hint (existing catch sets `signalSources: []`)       | Manual-only path still usable                                                   |

**`isValid` change:** today `isValid` requires `instrumentScope.trim().length > 0`. In listener-only mode there are no tickers and §C is hidden, so that requirement is gated on `showInstrumentFilter`, and over-allocation now blocks save:

```
const requiresInstrumentScope = showInstrumentFilter; // false in edgar-only mode
const overAllocated = assignedActiveModeBrokers.some((b) => {
  const a = form.brokerAssignments.find((x) => x.brokerAccountId === b.id);
  return a != null && b.freeCapitalUsd != null && a.allocatedUsd > b.freeCapitalUsd;
});
const isValid =
  form.name.trim().length > 0 &&
  form.objective.trim().length > 0 &&
  (!requiresInstrumentScope || form.instrumentScope.trim().length > 0) &&
  effectiveInstrumentClasses.length > 0 &&
  !overAllocated &&
  readiness !== "no_inputs";   // reuse existing readiness as the single live-input source of truth
```

`effectiveInstrumentClasses` is broker-derived even when §C is hidden, so the `> 0` check still holds for EDGAR-only sessions via assigned brokers. The "has a live input" gate reuses the existing `readiness` derivation rather than a parallel flag.

---

## 10. Copy & Labels

| Location                   | String                                                                                                | Notes                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Modal caption              | "Identity, signal scope, and execution routing in one place."                                         | Replaces "Identity, task boundary, and execution routing in one place."                                                   |
| §B header                  | "Signal Sources"                                                                                      | unchanged                                                                                                                 |
| §B caption                 | "Pick what drives this session. Choose a signal first."                                               | Replaces "Choose which signal feeds drive this session."                                                                  |
| §B kind chip               | "Search" / "Listener"                                                                                 | New chips on source rows                                                                                                  |
| §B empty hint              | "No automated signal sources configured yet. You can still run from manual tickers below."            | Tweak of existing                                                                                                         |
| §C header                  | "Signal Scope"                                                                                        | New section title (replaces "Task Boundary")                                                                              |
| §C caption                 | "Tell the web search what to look at."                                                                | Shown in search/manual mode                                                                                               |
| §C provider label          | "Search provider override"                                                                            | unchanged label, relocated                                                                                                |
| §C edgar note              | "EDGAR 8-K is an automatic listener. No instruments to pick — it responds to filings as they happen." | New                                                                                                                       |
| Instrument classes label   | "Instrument classes"                                                                                  | unchanged                                                                                                                 |
| Manual tickers label       | "Manual tickers"                                                                                      | unchanged                                                                                                                 |
| Manual tickers placeholder | "SPY, QQQ, NVDA"                                                                                      | **Fix:** current `"SPY\nQQQ\nNVDA"` renders literal backslash-n; use comma example (or a real multiline template literal) |
| Allocation quick-fill      | "20%" · "50%" · "Max"                                                                                 | New chips                                                                                                                 |
| Over-allocation error      | "Exceeds free capital (${free})."                                                                     | Inline row error; blocks save (hard-block) when `allocatedUsd > freeCapitalUsd`                                           |
| Footer — manual only       | "This session runs from manual tickers only."                                                         | unchanged                                                                                                                 |
| Footer — waiting           | "All subscribed sources are disabled — session will wait idle on start."                              | unchanged                                                                                                                 |
| Footer — no inputs         | "No live inputs — session will wait idle on start."                                                   | unchanged                                                                                                                 |
| Create button              | "Create Session" / "Save Session" / "Saving…"                                                         | unchanged                                                                                                                 |

---

## 11. Resolved Decisions

| #   | Question                                          | Decision                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Listener-only (`edgar_8k`) sessions and tickers   | **Resolved.** Tickers are a property of search-style/manual scoping, never of a listener. EDGAR carries its own edge (the filing). Listener-only saves send `instrumentScope: ""`. The paradigm: automatic signals must not depend on operator-supplied symbols. |
| 2   | Over-allocation (`allocatedUsd > freeCapitalUsd`) | **Resolved — hard-block.** Create/Save disabled with inline row error until allocation ≤ free capital.                                                                                                                                                           |
| 3   | Loading skeleton for §B while sources load        | **Resolved — add it** (best for system). §B shows 2–3 pulse rows until `signalSources` resolves, matching the skeleton pattern already used on `SignalSourcesPage`.                                                                                              |
| 4   | Single source of truth for "has a live input"     | **Resolved — reuse `readiness`.** `isValid` gates on `readiness !== "no_inputs"`; no parallel flag.                                                                                                                                                              |

### Remaining (non-blocking)

| #   | Question                                                                                                                   | Impact                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 5   | Should the 20% default become an operator-configurable workspace preference later? Spec assumes a constant `0.20` for now. | Future config surface only; no blocker to this work. |
