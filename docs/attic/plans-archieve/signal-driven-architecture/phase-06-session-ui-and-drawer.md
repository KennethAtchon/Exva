# Phase 6 — Session UI & Drawer

> **Date:** 2026-05-28
> **Status:** In Progress
> **Spec sections:** §4.5–4.8, §6.3.3–6.3.4, §10 (copy)
> **Depends on:** Phase 5 (Signal Sources page must exist for nav link), Phase 3 (delivery rows must exist for drawer)
> **Unlocks:** Nothing (terminal phase for UI work)

---

## 1. Problem Statement

The session creation modal, session drawer, session card, and Strategy Config page all need to be updated to reflect the signal-driven model. The "Signal Sources" tab is new in the session modal. The session drawer gains a "Signals" log tab. Session cards show a derived "Waiting" state. Strategy Config removes discovery-mode and TA-derived fields. None of these are backward-compatible with current UI structure.

---

## 2. Goals

| #   | Goal                                                            | Done When                                                                           |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | `CreateEditSessionModal` gains "Signal Sources" section         | Per-source subscribe toggles render; readiness summary updates live                 |
| 2   | Modal footer shows readiness banner                             | `armed`, `manual_only`, `waiting_for_source_enable`, `no_inputs` banners all render |
| 3   | "Selection mode" dropdown removed from modal                    | No trace of `manual_shortlist` / `ai_selected_universe` dropdown                    |
| 4   | "AI picker enabled" switch removed from modal                   | No trace                                                                            |
| 5   | "Instrument scope" relabeled → "Manual tickers"                 | Label updated everywhere                                                            |
| 6   | `SessionDetailDrawer` gains "Signals" tab                       | Signal event list renders with filter row                                           |
| 7   | Drawer signal log refreshes on EventBus events                  | `signal_received` + `signal_delivery_updated` trigger re-fetch                      |
| 8   | Session card shows signal activity row                          | Evaluating/queued/waiting states render                                             |
| 9   | Session card shows yellow "Waiting" badge when running-but-idle | Derived from subscriptions + source enabled-states                                  |
| 10  | Strategy Config "Style" tab updated                             | Discovery mode removed; evidence mode simplified to 3 options                       |
| 11  | Strategy Config "Rules" tab updated                             | Setup type and entry style show only new values                                     |
| 12  | Strategy Config "Timeframe" tab updated                         | Intraday removed; Catalyst added                                                    |

---

## 3. `CreateEditSessionModal` Changes

### 3.1 Remove fields

- **"Selection mode" dropdown** (`manual_shortlist` / `ai_selected_universe`): remove entirely.
- **"AI picker enabled" switch**: remove entirely.
- **"Instrument scope" label**: rename to **"Manual tickers"**. Field itself (`instrumentScope`) unchanged.

### 3.2 Add "Signal Sources" section

Insert as the fourth section, below "Execution Setup".

**Section header:** "Signal Sources" / "Choose which signal feeds drive this session."

**No sources configured globally:**

```
Info banner: "No automated signal sources configured yet. Manual tickers still work."
+ Button: "Open Signal Sources →" (navigates to /signals page)
```

**Sources list (one toggle row per global source):**

```
Row per source:
├── Switch (on = this session subscribes)
├── Source name (13px semibold)
├── Source type description (12px --text3)
└── Source status badge / helper text when source disabled globally:
    "Disabled globally — does not count as a live input"
```

**Session input summary card** (always visible, derived from form state):

| Readiness                   | Text                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `armed`                     | "Live inputs: {manualTickerCount} manual ticker(s), {enabledSubscribedSourceCount} enabled source(s)"                                               |
| `manual_only`               | "This session will run from manual tickers only."                                                                                                   |
| `waiting_for_source_enable` | "This session is subscribed to {disabledSubscribedSourceCount} source(s), but all are disabled. Starting now will put the session in waiting mode." |
| `no_inputs`                 | "This session has no live inputs yet. Add manual tickers or enable at least one subscribed source."                                                 |

**Info text below section:** "Manual tickers are evaluated once at session start, not continuously. Only subscribed + enabled sources provide ongoing automated inputs."

### 3.3 Modal footer readiness banner

Banner appears immediately above the action buttons — not just inside the section.

| Readiness                   | Banner                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `armed`                     | None                                                                                         |
| `manual_only`               | Info (blue): "This session runs from manual tickers only."                                   |
| `waiting_for_source_enable` | Warning (yellow): "⚠ All subscribed sources are disabled — session will wait idle on start." |
| `no_inputs`                 | Warning (yellow): "⚠ No live inputs — session will wait idle on start."                      |

### 3.4 Persistence

The modal stores a list of subscribed source IDs locally until "Save" / "Create". On save, writes to `session_signal_sources` join table via IPC. Toggle changes are not persisted until the user saves.

---

## 4. `SessionDetailDrawer` — Signals Tab

### 4.1 New tab

Add "Signals" tab alongside existing tabs in `SessionDetailDrawer` (`src/components/sessions/SessionDetailDrawer.tsx`).

### 4.2 Tab layout

```
Signals tab
├── Filter row
│   └── Toggle: "All" | "Pending" | "Completed" | "Dropped"
├── Signal event list (scrollable, newest first by enqueued_at)
│   └── Per row:
│       ├── Source badge (e.g., "EDGAR 8-K")
│       ├── Ticker (14px bold)
│       ├── Company name (12px --text3)
│       ├── Timestamp (12px --text3, relative)
│       ├── Queue position chip — "#{N} in queue" — only when status = `queued`
│       ├── Delivery status chip (see chip map below)
│       └── [optional] Document URL link icon (opens in system browser)
└── Empty state: "No signals received yet for this session."
```

### 4.3 Delivery chip map

| Status               | Chip text                | Chip style     |
| -------------------- | ------------------------ | -------------- |
| `queued`             | "Queued"                 | pending gray   |
| `waiting_for_resume` | "Waiting for resume"     | pending yellow |
| `processing`         | "Evaluating"             | pending blue   |
| `triggered`          | "Triggered cycle"        | success green  |
| `traded`             | "Trade opened"           | success green  |
| `rejected`           | "Rejected in review"     | neutral gray   |
| `dropped`            | "Dropped ({dropReason})" | muted gray     |
| `expired`            | "Expired while paused"   | muted gray     |

### 4.4 Filter bucket mapping

| Filter      | Statuses shown                               |
| ----------- | -------------------------------------------- |
| "All"       | all                                          |
| "Pending"   | `queued`, `waiting_for_resume`, `processing` |
| "Completed" | `triggered`, `traded`, `rejected`            |
| "Dropped"   | `dropped`, `expired`                         |

### 4.5 Data source

IPC call: `signals:events:list` with `{ sessionId, statusBucket?, limit: 50 }`.

**Refresh triggers:**

- On tab open: initial fetch
- On `signal_received` EventBus event: re-fetch
- On `signal_delivery_updated` EventBus event: re-fetch (or update the specific row in-place if simpler)

### 4.6 Display order note

List renders newest-first by `enqueued_at`. The queue processes oldest-first (FIFO), so the top row is the last to be processed. Queue position chip on `queued` rows makes this explicit.

---

## 5. Session Card Changes

### 5.1 Signal activity row

Add signal activity row below existing status/progress info. Shown only when session has at least one source subscription or manual tickers.

```
Row:
├── Small signal icon (--text3)
└── Activity text (12px --text3):
    | Condition | Text |
    |-----------|------|
    | cycle active for a signal | "Evaluating signal: {TICKER}" |
    | deliveries in queue | "{N} signal(s) queued" |
    | running but source disabled | "Waiting — subscribed source(s) disabled" |
    | running but no inputs | "Waiting — no live inputs" |
    | idle | "No signals pending" |
```

Hidden entirely for sessions with no source subscriptions and no manual tickers.

### 5.2 "Waiting" badge

When `session.status = "running"` but the session is in waiting state (all subscribed sources disabled + no signals queued, or no inputs at all), the session card badge shows yellow "Waiting" instead of green "Running".

This is a computed display property derived at render time:

```typescript
const displayBadge = isRunningButWaiting(session, globalSourceStates)
  ? "waiting" // yellow
  : session.status; // use DB status
```

**`isRunningButWaiting` logic:**

- `session.status !== "running"` → false
- Count queued + processing deliveries for this session
- If count > 0 → false (actively working)
- Get enabled state of each subscribed source
- If all subscribed sources disabled → true
- If no subscribed sources and no manual tickers → true
- Otherwise → false

---

## 6. Strategy Config UI Changes

### 6.1 "Style" tab

**Remove:**

- "Discovery mode" dropdown (superseded by signal source subscriptions)

**Replace:**

- "Evidence mode" dropdown: simplified to 3 options only
  - "Document First" (`document_first`)
  - "Balanced" (`balanced`)
  - "Probability Edge" (`probability_edge`)

**Posture preset dropdown:** Updated to new preset IDs (`edgar_catalyst`, `earnings_event`, `prediction_event_edge`, `manual_watchlist`, `custom`).

**Keep unchanged:**

- "Catalyst mode" (required / preferred / not required)
- "Fundamental strictness"
- "AI Instructions" free text
- "Posture notes" free text

### 6.2 "Rules" tab

**Update dropdowns to new values only:**

- "Setup type": Catalyst Entry / Event Entry / Probability Edge / Custom
- "Entry style": Catalyst / Event / Probability Edge
- "Rules preset": updated preset list (`catalyst_entry`, `event_entry`, `probability_edge`, `custom`)

**Keep unchanged:**

- Side bias, exit style, scaling mode, rule notes

### 6.3 "Timeframe" tab

**Remove:**

- "Intraday" preset option
- `1m`, `5m`, `15m` bar sizes from primary timeframe dropdown
- `intraday_flat` from holding style dropdown

**Add:**

- "Catalyst" preset to timeframe preset dropdown

**Keep unchanged:** All remaining presets and fields.

### 6.4 "Risk" tab — no changes.

### 6.5 "AI Phases" tab — no changes.

---

## 7. Session Modal "Task Boundary" Section

**Remove:**

- "Selection mode" dropdown
- "AI picker enabled" switch

**Keep:**

- "Manual tickers" textarea (formerly "Instrument scope") — label updated
- Instrument classes checkboxes
- "Search provider override" dropdown

---

## 8. Checklist

- [ ] "Signal Sources" section added to `CreateEditSessionModal`
- [ ] Per-source subscribe toggle rows render with correct source status badges
- [ ] Session input summary card derives readiness from form state live
- [ ] Modal footer readiness banner renders for all 4 readiness states
- [ ] "Selection mode" dropdown removed from modal
- [ ] "AI picker enabled" switch removed from modal
- [ ] "Instrument scope" relabeled to "Manual tickers" in all visible labels
- [ ] "Open Signal Sources →" navigation link works
- [ ] `session_signal_sources` rows saved on modal save/create
- [ ] "Signals" tab added to `SessionDetailDrawer`
- [ ] Signal event list renders all statuses with correct chips
- [ ] Filter row works for all 4 buckets (All, Pending, Completed, Dropped)
- [ ] Queue position chip appears only on `queued` rows
- [ ] Drawer refreshes on `signal_received` + `signal_delivery_updated` events
- [ ] Session card signal activity row renders for sessions with sources/tickers
- [ ] Yellow "Waiting" badge appears when running-but-idle
- [ ] Strategy Config "Style" tab: discovery mode removed, evidence mode simplified
- [ ] Strategy Config "Rules" tab: removed values gone from dropdowns
- [ ] Strategy Config "Timeframe" tab: intraday removed, catalyst added
- [ ] All copy matches spec §10 exactly
