# Phase 5 — Signal Sources UI

> **Date:** 2026-05-28
> **Status:** In Progress
> **Spec sections:** §4.1–4.4 (Signal Sources page, SignalSourceCard, Add Source Modal, Configure Source Panel), §10 (copy)
> **Depends on:** Phase 2 (IPC channels must be wired; EventBus events forwarded)
> **Unlocks:** Phase 6 (Session UI can link to this page)

---

## 1. Problem Statement

There is no UI surface for managing signal sources. The operator cannot see what sources exist, their current status, or add/configure/remove them. This phase builds the Signal Sources top-level page, the source card list, and the add/configure modals.

---

## 2. Goals

| #   | Goal                                                                                   | Done When                                             |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | `"signals"` added to `PageKey` type                                                    | Type accepts the new key                              |
| 2   | "Signals" nav item added to `NAV_ITEMS` between "Strategy" and "API Usage"             | Nav renders it correctly                              |
| 3   | `SignalSourcesPage` renders (empty state, loading, error, populated)                   | All 4 states display correctly                        |
| 4   | `SignalSourceCard` renders all fields and all status badge variants                    | Confirmed visually                                    |
| 5   | Enable/disable toggle works (with impact confirmation when sessions attached)          | IPC call fires; card updates                          |
| 6   | "Test" button triggers one immediate poll, shows inline result                         | Only on EDGAR sources; disabled during in-flight      |
| 7   | "Configure" button opens `ConfigureSourcePanel` modal                                  | Saves metadata-only vs. runtime-affecting correctly   |
| 8   | "Remove" button opens correct confirmation dialog (with/without session subscriptions) | "Remove all subscriptions and delete" flow works      |
| 9   | "Add Source" button opens `AddSourceModal`                                             | EDGAR and Web Search types selectable; creates source |
| 10  | Cards auto-refresh on `signal_received` EventBus event                                 | Last signal text updates without reload               |

---

## 3. Nav Changes

File: wherever `PageKey` and `NAV_ITEMS` are defined (likely `src/components/layout/TopNav.tsx` or a nav constants file).

```typescript
// PageKey — add "signals"
export type PageKey = "sessions" | "strategy" | "signals" | "costs" | ...;

// NAV_ITEMS — insert between "strategy" and "costs"
{ key: "signals", label: "Signals" }
```

---

## 4. `SignalSourcesPage`

File: `src/components/signals/SignalSourcesPage.tsx` (new file — confirm directory conventions)

**States to implement:**

| State     | Condition                | Render                                                                                |
| --------- | ------------------------ | ------------------------------------------------------------------------------------- |
| Loading   | IPC call in-flight       | Three skeleton cards (same height, pulsing opacity)                                   |
| Error     | IPC call failed          | Error banner: "Failed to load signal sources. Try again." + "Retry" link              |
| Empty     | Sources array length = 0 | Dashed border rounded card: "No signal sources configured. Add one to get started."   |
| Populated | Sources array length > 0 | One `SignalSourceCard` per source, stacked vertically inside a `Card` with no padding |

**Layout:**

```
PageShell
├── Page header label (12px uppercase --text3): "SIGNAL SOURCES"
├── H1: "Signal Sources"
├── Subtext (--text3): "Connect real-time data feeds to drive the trading pipeline."
├── Action bar
│   └── "Add Source" button (primary accent, right-aligned)
├── Source list Card
│   └── [empty | loading | error | SignalSourceCard list]
└── AddSourceModal (portal, default closed)
```

**Data flow:**

- On mount: call `signals:sources:list` IPC
- On `signal_received` or `signal_delivery_updated` EventBus event: refresh last-signal fields only (don't re-fetch the full list — update in-place via state)
- On source enable/disable/delete: re-fetch full list

---

## 5. `SignalSourceCard`

File: `src/components/signals/SignalSourceCard.tsx`

**Layout:**

```
Row (flex, items-start, gap-4, p-4 border-b last:border-0)
├── Left section (flex-1)
│   ├── Row: source name (13px semibold --text1) + StatusBadge
│   ├── [If status === "error"] Error text (12px error color): "Error: {lastError}"
│   ├── Description (12px --text3)
│   ├── Last signal text (12px --text3): "Last signal: {TICKER}, {N} ago" | "No signals yet"
│   ├── Poll stats text (12px --text3): "Last poll: {n} detected, {n} passed to sessions, {n} dropped" | "No polls yet"
│   └── Usage text (12px --text3): "Used by {N} sessions" | "Not attached to any sessions"
└── Right section (flex-shrink-0, flex gap-2, items-center)
    ├── Switch (enable/disable toggle)
    ├── "Test" button (outline, sm) — EDGAR sources only
    ├── "Configure" button (outline, sm)
    └── Remove button (icon-only X, danger color on hover)
```

**Status badge variants:**

| status       | label        | color         |
| ------------ | ------------ | ------------- |
| `running`    | "Running"    | success green |
| `idle`       | "Idle"       | gray          |
| `paused`     | "Paused"     | yellow        |
| `restarting` | "Restarting" | blue accent   |
| `error`      | "Error"      | red           |

**Toggle behavior:**

- Enabling: call `signals:sources:enable` immediately.
- Disabling with `attachedSessionCount > 0`: show impact confirmation dialog first. Dialog copy: "Disable this source for {N} subscribed sessions? Sessions will stay subscribed but move to waiting state until the source is enabled again."
- Switch disabled while call in-flight.
- On error: revert switch + toast "Failed to update source."

**Test button behavior:**

- Only rendered for `type === "edgar_8k"`.
- Fires one immediate poll via `signals:sources:enable` with a `test: true` flag (or a separate channel — confirm IPC design).
- Shows "Testing…" while in-flight.
- On completion: inline update of poll stats row to "Test poll: {n} detected, {n} passed, {n} dropped."
- If HTTP error: inline error below poll stats row.
- Disabled while a test or scheduled poll is in-flight.

**Remove button behavior:**

- `attachedSessionCount === 0`: simple confirmation "Delete this source? This cannot be undone." → `signals:sources:delete`.
- `attachedSessionCount > 0`: "This source is subscribed by {N} sessions: {name1}, {name2}. Removing it will unsubscribe all of them." Two actions: "Remove all subscriptions and delete" / "Cancel". On confirm: orchestrator bulk-unsubscribes all sessions, then deletes. `signal_events` + `session_signal_deliveries` rows are kept as historical records.

---

## 6. `AddSourceModal`

File: `src/components/signals/AddSourceModal.tsx`

**Layout:**

```
Dialog (max-w-[520px])
├── Header: "Add Signal Source"
├── Type picker (required)
│   └── Radio group vertical:
│       ├── "EDGAR 8-K" — "Polls SEC EDGAR for 8-K filings in real time. Free, no API key."
│       └── "Web Search" — "Legacy: uses web search and trending symbols to find candidates. Lower edge."
├── [EDGAR fields — shown when EDGAR selected]
│   ├── "Name" text input (default "EDGAR 8-K")
│   ├── "Poll interval (market hours)" number input (default 3, min 1, max 60)
│   └── "Poll interval (off-hours)" number input (default 15, min 5, max 1440)
├── [Web Search fields — shown when Web Search selected]
│   └── "Name" text input (default "Web Search")
├── Divider
└── Footer
    ├── "Cancel" (outline)
    └── "Add Source" (primary, disabled until type selected)
```

**States:**

| State         | Trigger              | Display                                                    |
| ------------- | -------------------- | ---------------------------------------------------------- |
| Default       | Modal opens          | Type picker, no selection, "Add Source" disabled           |
| Type selected | User picks type      | Type-specific fields appear                                |
| Saving        | "Add Source" clicked | Button → "Adding…", inputs disabled                        |
| Error         | IPC fails            | Error text below footer: "Failed to add source: {message}" |

On success: modal closes; source list re-fetches; new card appears.

---

## 7. `ConfigureSourcePanel`

File: `src/components/signals/ConfigureSourcePanel.tsx`

**Layout:** `Dialog` (max-w-[560px]), title "Configure — {source name}".

**EDGAR config fields:**

| Field                 | Type     | Label                                    | Default     | Validation              |
| --------------------- | -------- | ---------------------------------------- | ----------- | ----------------------- |
| Name                  | Text     | "Name"                                   | source.name | Non-empty, max 80 chars |
| Market-hours interval | Number   | "Poll interval — market hours (min)"     | 3           | Integer 1–60            |
| Off-hours interval    | Number   | "Poll interval — off-hours (min)"        | 15          | Integer 5–1440          |
| CIK whitelist         | Textarea | "CIK whitelist (optional, one per line)" | ""          | Digits only per line    |
| Min filing age        | Number   | "Min signal age before emitting (min)"   | 0           | Integer 0–60            |

**Web Search config fields:** Name only.

**Recent activity log (EDGAR only):**

- Scrollable, last 20 poll results (in-memory only, not persisted)
- Each row: timestamp (relative "4m ago") + result summary: `OK — {n} detected, {n} passed, {n} dropped` or `Error: {status}`
- Per-dropped entry reason: `CIK no ticker: {cik}`, `Duplicate accession`, `Whitelist filtered`

**Runtime-affecting fields:** Poll interval, CIK whitelist, min filing age.

- When any runtime-affecting field is changed: helper text above footer: "Saving will briefly reconnect this source."
- On save: source enters `restarting` state, then `running`.

**Metadata-only fields:** Name.

- Save does not restart the source.

**Footer:** "Cancel" + "Save Changes". "Save Changes" disabled when no changes made.

---

## 8. Copy Reference

All user-visible strings are in spec §10. Key ones:

| Element               | Copy                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Page h1               | "Signal Sources"                                                                                                                              |
| Page subtext          | "Connect real-time data feeds to drive the trading pipeline."                                                                                 |
| Add source button     | "Add Source" / "Adding..."                                                                                                                    |
| Modal title           | "Add Signal Source"                                                                                                                           |
| Configure panel title | "Configure — {name}"                                                                                                                          |
| Configure save helper | "Saving will briefly reconnect this source."                                                                                                  |
| Disable impact dialog | "Disable this source for {N} subscribed sessions? Sessions will stay subscribed but move to waiting state until the source is enabled again." |
| Remove (subscribed)   | "This source is subscribed by {N} sessions: {name1}, {name2}. Removing it will unsubscribe all of them."                                      |
| Remove (unsubscribed) | "Delete this source? This cannot be undone."                                                                                                  |
| Load error            | "Failed to load signal sources. Try again."                                                                                                   |
| Toast error           | "Failed to update source."                                                                                                                    |

---

## 9. Checklist

- [ ] `PageKey` includes `"signals"`
- [ ] "Signals" nav item between Strategy and API Usage
- [ ] `SignalSourcesPage` renders all 4 states (loading, error, empty, populated)
- [ ] `SignalSourceCard` renders all fields, all 5 status badge variants
- [ ] Enable/disable toggle with impact confirmation dialog
- [ ] Test button works (EDGAR only), shows inline result
- [ ] Configure panel opens, saves metadata-only without restart, runtime fields trigger restart
- [ ] Recent activity log appears in Configure panel (in-memory)
- [ ] Remove dialog (subscribed vs. unsubscribed) — both flows work
- [ ] Add Source modal: both type selections, type-specific fields, create flow
- [ ] Cards update on `signal_received` EventBus event
- [ ] All copy matches spec §10 exactly
