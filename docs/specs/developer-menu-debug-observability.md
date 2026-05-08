# Developer Menu Debug Observability — Feature Specification

> **Date:** 2026-05-08
> **Status:** Draft
> **Feature area:** Developer menu, runtime observability, AI trace inspection
> **Depends on:** `src/pages/DevPanel.tsx`, session focus state, strategy context service, events IPC, agent trace persistence, API call log persistence

## 1. Summary

The current `Developer` page is a useful shell, but it is not trustworthy enough for real debugging. It hardcodes values that should be live, such as the top-level model and session ID, only shows per-agent model information after a trade-linked event is clicked, and does not explain the actual action sequence that the runtime is taking. This feature turns the developer menu into a first-class observability console for the focused session, with live runtime identity, per-role model/provider resolution, richer event/action detail, copyable traces, API/search call visibility, and explicit correlations between session, cycle, trade, event, run, and message records.

The goal is that when a trade cycle fails, stalls, or behaves unexpectedly, the user can answer four questions from one screen without opening SQLite manually: what session is running, what the runtime is doing now, which agent/model/provider combination was used, and what exact inputs/outputs/errors occurred at each step.

## 2. User Story

> **As a** user debugging Exva runtime behavior,
> **I want to** inspect live session diagnostics, action timelines, per-agent model/provider usage, and full trace payloads from the Developer menu,
> **So that** I can understand failures and unexpected behavior without guessing or reading raw database tables.

Secondary user stories:

> **As a** user,
> **I want to** see the exact model and provider assigned to each AI role for the focused session,
> **So that** I can verify the runtime is using the configuration I saved in Strategy.

> **As a** user,
> **I want to** copy structured trace data and event detail,
> **So that** I can paste reliable debugging evidence into issues, docs, or chat.

> **As a** user,
> **I want to** see cycle-level and trade-level action progress,
> **So that** I can distinguish normal waiting, in-flight work, and true failure states.

## 3. Scope

**In scope:**

- Replace hardcoded system diagnostics in `DevPanel` with live focused-session diagnostics.
- Show the focused session identity, status, uptime, execution mode, broker routing summary, and runtime health.
- Show the configured provider and model for every AI role in the focused session, including `instrument_selector`.
- Show the actual provider/model recorded on every agent run and message trace.
- Add an action-oriented event detail view that explains what the runtime was doing, not only the raw event message string.
- Add cycle correlation so events, agent runs, agent messages, selector output, and API/search calls can be grouped into one execution chain.
- Add copy actions for event detail, run summary, message trace JSON, tool calls JSON, output JSON, and API call rows.
- Add visibility into external call activity from `api_call_log`, including provider, endpoint, latency, cost, cache hit, and status.
- Add dedicated empty, loading, and error states for every developer panel subsection.
- Preserve local-only behavior; all observability data remains in SQLite/Electron.
- Support debugging both trade-linked runs and session-level runs that are not tied to a trade, especially `instrument_selector`.

**Out of scope:**

- Remote log shipping, cloud tracing, or multi-user debug sharing.
- Full-text search across historical log files outside SQLite-backed observability records.
- Editing session strategy or AI role configuration from the Developer page.
- Automatic bug diagnosis or AI-generated root-cause conclusions.
- Persistent saved debug views, bookmarks, or custom dashboards.

## 4. Screens & Layout

### 4.1 Developer Page

**Route / location:** Top navigation item `Developer`, rendered by `src/pages/DevPanel.tsx`.

**When it appears:** User clicks `Developer` in `TopNav`.

**Layout:**

```text
Developer Page
├── Header
│   ├── Title: "Developer"
│   ├── Subtitle: "Focused session observability, traces, and diagnostics"
│   ├── Session chip: focused session name or "No session focused"
│   ├── Runtime status chip: idle | active | paused | stopping | error
│   └── Auto-refresh indicator / event stream health chip
├── Top Diagnostics Grid
│   ├── Runtime Identity Card
│   │   ├── Runtime: "Electron / TypeScript"
│   │   ├── Session ID
│   │   ├── Session name
│   │   ├── Session status
│   │   ├── Workspace mode
│   │   ├── Uptime
│   │   └── Current cycle state
│   ├── AI Role Matrix Card
│   │   ├── instrument_selector -> provider + model + prompt source
│   │   ├── analyst_technical -> provider + model + prompt source
│   │   ├── analyst_fundamental -> provider + model + prompt source
│   │   ├── reviewer -> provider + model + prompt source
│   │   └── decision_maker -> provider + model + prompt source
│   ├── Execution Card
│   │   ├── Execution mode
│   │   ├── Default broker routing
│   │   ├── Search provider
│   │   ├── Open trades
│   │   └── Daily AI/data spend
│   └── Logging & Stream Card
│       ├── Event subscription status
│       ├── Last event received at
│       ├── Event count shown / total fetched
│       ├── Log file path
│       └── Copy diagnostics snapshot button
├── Main Split View
│   ├── Left: Event Timeline Panel
│   │   ├── Search input
│   │   ├── Level filter
│   │   ├── Role filter
│   │   ├── Scope filter: All | Session | Cycle | Trade | Selector
│   │   ├── Correlation filter chips: sessionId / cycleId / tradeId
│   │   └── Event rows with richer columns
│   └── Right: Inspector Panel
│       ├── Event Detail tab
│       ├── Agent Runs tab
│       ├── Message Trace tab
│       ├── External Calls tab
│       └── Raw JSON tab
└── Footer Hint
    └── "Select an event, cycle, trade, or run to inspect full trace data"
```

Layout rules:

- Desktop: top diagnostics renders as a 2x2 card grid above a two-column split view. Timeline column takes 60% width; inspector takes 40% width.
- Tablet and below: diagnostics cards stack vertically; timeline remains above inspector; inspector tabs become full-width accordion sections.
- The page defaults to the focused session. If no session is focused, diagnostics cards render an empty-state explanation and event querying falls back to global workspace view.
- The page must never display hardcoded values for `Model`, `Session ID`, broker label, or runtime cycle state.
- Event rows must stay scroll-performant at 500 rows loaded and must not fetch all detail payloads until selected.
- When the selected event changes, inspector tabs refetch only the detail linked to that event's correlation keys.

**Element inventory:**

| Element | Type | Label / Content | State | Action on Interact |
|---------|------|-----------------|-------|-------------------|
| Search input | Text input | Placeholder: "Search events, errors, trade IDs, cycle IDs…" | Empty by default | Filters event timeline client-side after current dataset load |
| Level filter | Segmented control | `DEBUG`, `INFO`, `WARN`, `ERROR` | `DEBUG` default | Filters event timeline |
| Role filter | Chip group | `all`, `selector`, `an/technical`, `an/fundamental`, `reviewer`, `decision`, `system`, `orchestrator` | `all` default | Filters event timeline |
| Scope filter | Dropdown | `All activity`, `Focused session`, `Current cycle`, `Selected trade`, `Selector only` | `Focused session` default when a session is focused | Changes query scope |
| Event row | Selectable row | Time, level, role, action label, trade/cycle badges, message preview | Highlighted when selected | Opens inspector for that row |
| Copy snapshot | Button | "Copy diagnostics snapshot" | Enabled when diagnostics loaded | Copies top-card summary as JSON + readable text |
| Copy event | Button | "Copy event" | Enabled when an event is selected | Copies full event detail JSON |
| Copy run | Button | "Copy run" | Enabled when an agent run is selected | Copies selected run summary + raw payload |
| Copy trace | Button | "Copy trace" | Enabled when a message trace is selected | Copies full message/tool/output JSON |
| Copy external calls | Button | "Copy calls" | Enabled when external calls tab has rows | Copies current external call table as JSON |
| Open linked trade | Button | "Open trade" | Visible when selected detail has `tradeId` | Opens existing trade detail view |
| Retry detail load | Button | "Retry" | Visible on inspector load failure | Refetches selected subsection |

**States this screen can be in:**

| State | Condition | What the User Sees |
|-------|-----------|-------------------|
| Loading | Initial diagnostics and event query in progress | Skeleton cards, disabled filters, timeline skeleton rows |
| Default | Focused session exists and data loaded | Live diagnostics cards, timeline, inspector |
| No focused session | Workspace mode is global and no session is focused | Cards say "No session focused", timeline scope defaults to global events |
| Empty timeline | Query returns zero rows | Timeline empty state: "No developer events yet" |
| Filtered empty | Filters remove all rows | Timeline empty state: "No events match these filters" |
| Inspector idle | No event selected | Right panel shows overview cards and instruction text |
| Inspector loading | Event selected and detail fetch in progress | Tab skeletons/spinners |
| Error | Any section fetch fails | Inline error banner with failing section name and retry action |
| Stream degraded | Event subscription silent for more than 15 seconds while session is `active` | Stream chip turns amber and shows "Live stream delayed; polling fallback active" |

### 4.2 Event Detail Tab

**Route / location:** Inspector tab inside `Developer`.

**When it appears:** An event row is selected; `Event Detail` is the default tab.

**Layout:**

```text
Event Detail
├── Header
│   ├── Event level badge
│   ├── Source badge
│   ├── Action badge
│   ├── Copy event button
│   └── Timestamp
├── Identity block
│   ├── Session ID / name
│   ├── Trade ID
│   ├── Cycle ID
│   ├── Related run ID
│   └── Instrument symbol / class
├── Human-readable summary
│   ├── Primary message
│   └── "What happened" explanation
├── Action detail block
│   ├── Current step
│   ├── Previous step
│   ├── Next expected step
│   ├── Outcome
│   └── Error cause / validation summary if present
└── Linked records
    ├── Agent runs count
    ├── Message traces count
    ├── External calls count
    └── Open linked records buttons
```

Layout rules:

- If the event includes structured detail JSON, render formatted key/value rows before raw JSON.
- If the event has no structured detail payload, the `What happened` text is derived from known `action_type` semantics.
- Error events always surface the error category, failing role or component, and fallback/retry outcome if known.

### 4.3 Agent Runs Tab

**When it appears:** A selected event has linked run data, or the selection is tied to a `tradeId`, `cycleId`, or selector run.

**Layout:**

```text
Agent Runs
├── Summary bar
│   ├── Total runs
│   ├── Total tokens
│   ├── Total cost
│   └── Total duration
└── Run cards
    ├── Role
    ├── Provider key
    ├── Model
    ├── Finish reason
    ├── Input / output tokens
    ├── Cost / duration
    ├── Parse fallback badge if applicable
    ├── Copy run button
    └── Expand for output text + linked message trace
```

Layout rules:

- Runs are ordered by `created_at` ascending.
- Session-level selector runs with `trade_id = null` must still appear when correlated by `cycle_id` or `selectorAgentRunId`.
- The model shown on each card comes from `agent_runs.model`; it must not be inferred from top-card role config.

### 4.4 Message Trace Tab

**When it appears:** A selected event or run has linked `agent_messages` rows.

**Layout:**

```text
Message Trace
├── Trace cards per message
│   ├── Role / provider / model / cycle
│   ├── Output schema name
│   ├── Parse fallback badge
│   ├── Copy trace button
│   ├── Prompt messages JSON
│   ├── Tool calls JSON
│   ├── Output JSON
│   ├── Thinking JSON (if present)
│   └── Market / strategy snapshot blocks
```

Layout rules:

- All JSON blocks are collapsible and syntax formatted.
- Long payloads show first 2,000 visible characters with an explicit `Show full payload` expansion.
- `Copy trace` copies the full untruncated payload, not the visible preview.

### 4.5 External Calls Tab

**When it appears:** A selected event, trade, run, or cycle has linked `api_call_log` rows.

**Layout:**

```text
External Calls
├── Summary bar
│   ├── Total calls
│   ├── Total cost
│   ├── Avg latency
│   └── Cache-hit count
└── Call rows
    ├── Time
    ├── Provider
    ├── Endpoint
    ├── Call type
    ├── Status
    ├── Latency
    ├── Cost
    ├── Cache badge
    └── Copy row button
```

Layout rules:

- Rows are ordered by `created_at` ascending.
- The tab must include search-provider calls as well as AI-provider calls where available.
- If no rows exist, show `No external calls recorded for this selection.` rather than hiding the tab.

## 5. User Flows

### 5.1 Verify Runtime Configuration

**Entry point:** User opens `Developer` while a session is focused.

**Exit point:** User confirms the session, providers, and models match Strategy config.

```mermaid
flowchart TD
    A[Open Developer] --> B[Load focused session diagnostics]
    B --> C[Load AI role matrix]
    C --> D{Values loaded?}
    D -- Yes --> E[User compares role provider/model values]
    D -- No --> F[Show diagnostics error state]
    E --> G[User copies diagnostics snapshot or continues debugging]
```

Happy path:

1. User opens `Developer`.
2. The page resolves the focused session and loads live diagnostics.
3. The AI Role Matrix lists each role with provider, model, and prompt source.
4. The user verifies the runtime configuration before inspecting a failure.

If no focused session: show `No session focused. Developer view is showing global activity only.`

### 5.2 Investigate Failed Trade Cycle

**Entry point:** User sees an `ERROR` row in the event timeline.

**Exit point:** User identifies the failing step and copies evidence.

```mermaid
flowchart TD
    A[User selects ERROR event] --> B[Load event detail]
    B --> C[Load linked runs, messages, and external calls]
    C --> D[User inspects failing role or component]
    D --> E[User expands trace JSON]
    E --> F[User copies event/run/trace details]
```

Happy path:

1. User filters to `ERROR`.
2. User selects an error row such as `Trade cycle failed`.
3. Inspector shows the failing action, session, cycle, trade, and related runs.
4. User opens the relevant agent run and message trace.
5. User copies the trace payload and external call rows for reporting.

If the event has no linked run: inspector says `No agent run was recorded for this failure. This error occurred before AI execution.`

### 5.3 Inspect Selector Activity

**Entry point:** User wants to debug `instrument_selector` behavior.

**Exit point:** User sees selector inputs, selected instruments, and any failure reason.

```mermaid
flowchart TD
    A[User chooses Selector scope] --> B[Timeline filters to selector-related events]
    B --> C[User selects selector event]
    C --> D[Inspector loads selector run by cycle or selectorAgentRunId]
    D --> E[User reviews model, output JSON, and selected instruments]
```

## 6. Data & Field Mapping

### 6.1 Top Diagnostics Card Mapping

| UI Label / Element | Field Name in DB/API | Type | Required | Validation Rules | Notes |
|-------------------|---------------------|------|----------|-----------------|-------|
| Session ID | `sessions.id` | `string` | Yes when focused session exists | Non-empty | Replaces current hardcoded value |
| Session name | `sessions.name` | `string` | Yes when focused session exists | Non-empty | New on Developer page |
| Session status | `dashboardStats.session_status` or `sessions.status` | `enum` | Yes | Must match runtime state | Live value only |
| Workspace mode | `workspaceViewMode` | `enum: session|global` | Yes | Must be valid enum | New on Developer page |
| Uptime | `dashboardStats.session_uptime_min` | `number` | Yes when stats loaded | `>= 0` | Existing source |
| Open trades | `dashboardStats.open_trades` | `number` | Yes | `>= 0` | Existing source |
| Daily AI/data spend | `dashboardStats.daily_api_spend` | `number` | Yes | `>= 0` | Existing source |
| Search provider | `strategy.defaultSearchProviderId` or workspace default | `string | null` | No | — | Show `Workspace default` when inherited |
| Role provider | `session_ai_roles.providerKey` | `string` | Yes per role | Non-empty | Existing Strategy source |
| Role model | `session_ai_roles.modelId` | `string` | Yes per role | Non-empty when role configured | Replaces current hardcoded top-level model |
| Prompt source | `session_ai_roles.promptSource` | `enum` | Yes per role | `default|override` | Existing Strategy source |

### 6.2 Event Timeline Row Mapping

| UI Label / Element | Field Name in DB/API | Type | Required | Validation Rules | Notes |
|-------------------|---------------------|------|----------|-----------------|-------|
| Time | `events.created_at` | `timestamp` | Yes | ISO timestamp | Existing |
| Level | `events.level` | `enum` | Yes | `DEBUG|INFO|WARN|ERROR` | Existing |
| Source | `events.agent_type` or `events.source_component` | `string` | No | — | `source_component` is new |
| Action | `events.action_type` | `string` | Yes | Non-empty | New normalized event category |
| Session badge | `events.session_id` | `string | null` | No | — | Existing |
| Trade badge | `events.trade_id` | `string | null` | No | — | Existing |
| Cycle badge | `events.cycle_id` | `string | null` | No | — | New |
| Instrument badge | `events.instrument_symbol` | `string | null` | No | — | New |
| Message preview | `events.message` | `string` | Yes | Non-empty | Existing |

### 6.3 Agent Run Card Mapping

| UI Label / Element | Field Name in DB/API | Type | Required | Validation Rules | Notes |
|-------------------|---------------------|------|----------|-----------------|-------|
| Role | `agent_runs.agent_type` | `enum` | Yes | Valid role | Existing |
| Provider | `agent_runs.provider_key` | `string` | Yes | Non-empty | Existing |
| Model | `agent_runs.model` | `string` | Yes | Non-empty | Existing |
| Finish reason | `agent_runs.finish_reason` | `enum` | Yes | Valid finish reason | Existing |
| Input tokens | `agent_runs.input_tokens` | `number` | Yes | `>= 0` | Existing |
| Output tokens | `agent_runs.output_tokens` | `number` | Yes | `>= 0` | Existing |
| Cost | `agent_runs.cost_usd` | `number` | Yes | `>= 0` | Existing |
| Duration | `agent_runs.duration_ms` | `number` | Yes | `>= 0` | Existing |
| Cycle ID | `agent_runs.cycle_id` | `string | null` | No | — | New |
| Parse fallback | derived from linked `agent_messages.parse_fallback` | `boolean` | No | — | Display-level derived field |

**Schema changes required:**

| Table | Change | Column Name | Type | Default | Nullable |
|-------|--------|------------|------|---------|----------|
| `events` | Add column | `cycle_id` | `text` | `null` | Yes |
| `events` | Add column | `action_type` | `text` | `''` during backfill, non-empty for new writes | No after migration |
| `events` | Add column | `source_component` | `text` | `null` | Yes |
| `events` | Add column | `details_json` | `text` | `null` | Yes |
| `events` | Add column | `related_run_id` | `text` | `null` | Yes |
| `events` | Add column | `instrument_symbol` | `text` | `null` | Yes |
| `events` | Add column | `instrument_class` | `text` | `null` | Yes |
| `agent_runs` | Add column | `cycle_id` | `text` | `null` | Yes |

## 7. API Contract

### GET `developer:get-overview`

**Purpose:** Load live diagnostics for the current Developer page header and cards.

**When called:** On initial `Developer` page load, on focused session change, and when user clicks retry.

**Request:**

```typescript
{
  sessionId?: string;
}
```

**Response:**

```typescript
{
  workspaceViewMode: "session" | "global";
  focusedSession: {
    id: string;
    name: string;
    status: string;
    executionMode: "paper_only" | "live_allowed";
    searchProviderId: string | null;
  } | null;
  stats: {
    session_status: string;
    open_trades: number;
    daily_api_spend: number;
    session_uptime_min: number;
  } | null;
  aiRoles: Array<{
    role: string;
    providerKey: string;
    modelId: string;
    promptSource: "default" | "override";
  }>;
  brokerRouting: Array<{
    instrumentClass: string;
    brokerAccountId: string;
  }>;
  streamHealth: {
    subscribed: boolean;
    lastEventAt: string | null;
    fallbackPollingActive: boolean;
  };
  logging: {
    logFilePath: string | null;
  };
}
```

### GET `developer:list-events`

**Purpose:** Return timeline events with developer-specific filtering and correlation fields.

**When called:** Initial timeline load, filter changes, focused session change.

**Request:**

```typescript
{
  sessionId?: string;
  minLevel?: "DEBUG" | "INFO" | "WARN" | "ERROR";
  agentType?: string;
  actionType?: string;
  cycleId?: string;
  tradeId?: string;
  search?: string;
  limit?: number;
}
```

### GET `developer:get-event-detail`

**Purpose:** Fetch inspector data for one selected event.

**When called:** User selects an event row.

**Response:**

```typescript
{
  event: {
    id: string;
    sessionId: string | null;
    tradeId: string | null;
    cycleId: string | null;
    level: string;
    sourceComponent: string | null;
    agentType: string | null;
    actionType: string;
    instrumentSymbol: string | null;
    instrumentClass: string | null;
    relatedRunId: string | null;
    message: string;
    detailsJson: string | null;
    createdAt: string;
  };
  linkedCounts: {
    runs: number;
    messages: number;
    externalCalls: number;
  };
}
```

### GET `developer:list-runs`

**Purpose:** Fetch agent runs correlated by event, session, trade, or cycle.

**When called:** Inspector `Agent Runs` tab opens.

### GET `developer:list-messages`

**Purpose:** Fetch `agent_messages` correlated by event, run, trade, or cycle.

**When called:** Inspector `Message Trace` tab opens.

### GET `developer:list-external-calls`

**Purpose:** Fetch `api_call_log` rows correlated by event, trade, or cycle.

**When called:** Inspector `External Calls` tab opens.

**Side effects:** None. All developer endpoints are read-only.

## 8. Permissions & Access Control

| User Type / Role | Can View | Can Create | Can Edit | Can Delete | Notes |
|-----------------|----------|-----------|---------|-----------|-------|
| Local desktop user | Yes | No | No | No | Current Exva permission model is single local user |

If a linked record no longer exists, show the data section with an inline message: `Record not found. It may have been deleted or filtered out.`

## 9. Error States & Edge Cases

| Scenario | Trigger | What the User Sees | What the System Does |
|----------|---------|-------------------|---------------------|
| Hardcoded model mismatch eliminated | Developer page opens | Top cards show live role matrix, not a single hardcoded model string | Fetches strategy context instead of static strings |
| Selected event has no trade | `trade_id = null` | Inspector still shows session/cycle detail | Uses `cycle_id` and `related_run_id` correlation paths |
| Selector run exists with no trade | `instrument_selector` run saved with `trade_id = null` | Selector runs appear in `Agent Runs` tab | Queries by `cycle_id` or `selectorAgentRunId` |
| Event detail fetch fails | IPC error | Error banner: `Failed to load event detail.` | Keeps selected row and offers retry |
| Stream subscription stalls | No event seen for 15s while active session is running | Amber stream chip and note about polling fallback | Keeps polling-based data refresh active |
| External call rows missing | No `api_call_log` rows for selection | `No external calls recorded for this selection.` | No error state |
| Old rows missing new columns | Pre-migration records | Missing badges render as `—` and structured detail blocks are hidden | Backfill optional; UI must be null-safe |
| Trace payload is very large | JSON field > 2,000 visible chars | Preview with `Show full payload` control | Copy action still uses full raw payload |
| Focused session changes while Developer page open | User focuses another session elsewhere | Cards and timeline refresh and selection clears | Prevents stale cross-session inspector data |

## 10. Copy & Labels

| Location | String | Notes |
|----------|--------|-------|
| Page subtitle | "Focused session observability, traces, and diagnostics" | Replaces current generic subtitle |
| Search placeholder | "Search events, errors, trade IDs, cycle IDs…" | Final copy |
| Empty timeline | "No developer events yet" | When unfiltered query is empty |
| Filtered empty | "No events match these filters" | Existing concept, final string |
| No focused session headline | "No session focused" | Shown in diagnostics cards |
| No focused session body | "Developer view is showing global activity only. Focus a session to inspect live runtime configuration." | Final copy |
| Stream degraded chip | "Live stream delayed" | Amber state |
| Stream degraded hint | "Live stream delayed; polling fallback active" | Final copy |
| Copy diagnostics button | "Copy diagnostics snapshot" | Final copy |
| Copy event button | "Copy event" | Final copy |
| Copy run button | "Copy run" | Final copy |
| Copy trace button | "Copy trace" | Final copy |
| Copy calls button | "Copy calls" | Final copy |
| External calls empty | "No external calls recorded for this selection." | Final copy |
| Missing linked run | "No agent run was recorded for this failure. This error occurred before AI execution." | Final copy |

## 11. Open Questions

| # | Question | Impact if Unresolved | Owner |
|---|----------|---------------------|-------|
| 1 | Should `details_json` be authored for every new event write, or only for high-value action categories first? | Affects migration scope and event-writing effort across orchestrator/runtime services | Ken |
| 2 | Should external call visibility include only `api_call_log`, or should we also surface local log-file excerpts for the same correlation keys? | Changes data model and UI complexity for the `External Calls` tab | Ken |
| 3 | Do we want a dedicated `developer:*` IPC surface, or should the page compose existing `events`, `strategy`, `session`, and `trades` endpoints plus a small number of new observability endpoints? | Affects implementation shape and how much aggregation happens in main vs renderer | Ken |
| 4 | Should copy actions place human-readable text, raw JSON, or both on the clipboard by default? | Affects UX and issue-reporting workflow | Ken |
