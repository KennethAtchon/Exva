# Phase 2 — Singleton → Session-Scoped Persistence

> Replace the two singleton tables (`session_config`, `session_state`) with the full session-family schema.
> Wipe existing local DB — no migration compatibility required.

## Goal

All session, strategy, AI role, provider, broker, routing, preferences, template, and approval data lives in typed Drizzle schema tables with enforced foreign keys and correct indexes.

## Hard Problems

1. **Focused-session atomicity** — `setFocus(sessionId)` must clear all other `is_focused` flags and set the new one in a single transaction. SQLite serializes writes so `db.transaction()` is sufficient.
2. **Singleton `workspace_preferences`** — must always have exactly one row. Use `INSERT OR IGNORE (id=1)` in the migration seed.
3. **Instrument collision check** — must be a single SQL query joining `trades`, `sessions`, and `broker_accounts` — not a JS loop — to avoid TOCTOU races.

## Schema — Drizzle Definition

File: `electron/main/db/schema.ts` (full replacement)

```typescript
import {
  integer, real, sqliteTable, text, primaryKey
} from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id:                text("id").primaryKey(),
  name:              text("name").notNull(),
  objective:         text("objective").notNull(),
  status:            text("status").notNull().default("draft"),
  isFocused:         integer("is_focused", { mode: "boolean" }).notNull().default(false),
  selectionMode:     text("selection_mode").notNull().default("manual_shortlist"),
  instrumentClasses: text("instrument_classes").notNull(),  // JSON array
  instrumentScope:   text("instrument_scope").notNull(),
  capitalLimitUsd:   real("capital_limit_usd").notNull(),
  executionMode:     text("execution_mode").notNull().default("paper_only"),
  createdAt:         text("created_at").notNull(),
  updatedAt:         text("updated_at").notNull(),
});

export const sessionStrategies = sqliteTable("session_strategies", {
  sessionId:            text("session_id").primaryKey()
                          .references(() => sessions.id, { onDelete: "cascade" }),
  strategyProfile:      text("strategy_profile").notNull().default("passive_income"),
  maxPositionUsd:       real("max_position_usd").notNull().default(500),
  stopLossPct:          real("stop_loss_pct").notNull().default(2),
  takeProfitPct:        real("take_profit_pct").notNull().default(4),
  maxConcurrentTrades:  integer("max_concurrent_trades").notNull().default(3),
  researchDepth:        text("research_depth").notNull().default("balanced"),
  dailyLossLimitUsd:    real("daily_loss_limit_usd").notNull().default(200),
  profitTargetUsd:      real("profit_target_usd").notNull().default(1000),
  maxAiSpendUsd:        real("max_ai_spend_usd").notNull().default(5),
  humanApprovalRequired: integer("human_approval_required", { mode: "boolean" })
                           .notNull().default(false),
});

export const sessionAiRoles = sqliteTable("session_ai_roles", {
  id:               text("id").primaryKey(),
  sessionId:        text("session_id").notNull()
                      .references(() => sessions.id, { onDelete: "cascade" }),
  role:             text("role").notNull(),
  providerKey:      text("provider_key").notNull(),
  modelId:          text("model_id").notNull(),
  temperature:      real("temperature").notNull().default(0.7),
  maxTokens:        integer("max_tokens").notNull().default(4096),
  webSearchEnabled: integer("web_search_enabled", { mode: "boolean" }).notNull().default(false),
  promptSource:     text("prompt_source").notNull().default("default"),
  promptMarkdown:   text("prompt_markdown").notNull().default(""),
  promptAssetPath:  text("prompt_asset_path"),
});

export const providerAccounts = sqliteTable("provider_accounts", {
  id:             text("id").primaryKey(),
  name:           text("name").notNull(),
  category:       text("category").notNull(),   // 'ai' | 'search'
  providerType:   text("provider_type").notNull(),
  secretRef:      text("secret_ref").notNull(),
  isConfigured:   integer("is_configured", { mode: "boolean" }).notNull().default(false),
  lastTestStatus: text("last_test_status").notNull().default("unknown"),
  updatedAt:      text("updated_at").notNull(),
});

export const brokerAccounts = sqliteTable("broker_accounts", {
  id:                         text("id").primaryKey(),
  name:                       text("name").notNull(),
  brokerType:                 text("broker_type").notNull(),
  supportedInstrumentClasses: text("supported_instrument_classes").notNull(), // JSON
  mode:                       text("mode").notNull().default("paper"),
  secretRef:                  text("secret_ref").notNull(),
  updatedAt:                  text("updated_at").notNull(),
});

export const brokerRouting = sqliteTable("broker_routing", {
  instrumentClass:        text("instrument_class").primaryKey(),
  defaultBrokerAccountId: text("default_broker_account_id").notNull()
                            .references(() => brokerAccounts.id, { onDelete: "cascade" }),
});

export const sessionBrokerAssignments = sqliteTable("session_broker_assignments", {
  sessionId:       text("session_id").notNull()
                     .references(() => sessions.id, { onDelete: "cascade" }),
  brokerAccountId: text("broker_account_id").notNull()
                     .references(() => brokerAccounts.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.sessionId, t.brokerAccountId] }),
}));

export const workspacePreferences = sqliteTable("workspace_preferences", {
  id:                    integer("id").primaryKey().default(1),
  globalIncludeArchived: integer("global_include_archived", { mode: "boolean" })
                           .notNull().default(false),
  capitalAllocationMode: text("capital_allocation_mode").notNull().default("per_session_only"),
  globalCapitalPoolUsd:  real("global_capital_pool_usd"),
  updatedAt:             text("updated_at").notNull(),
});

export const sessionTemplates = sqliteTable("session_templates", {
  id:                  text("id").primaryKey(),
  name:                text("name").notNull().unique(),
  description:         text("description"),
  sourceSessionId:     text("source_session_id"),
  templatePayloadJson: text("template_payload_json").notNull(),
  instrumentClasses:   text("instrument_classes").notNull(), // JSON
  updatedAt:           text("updated_at").notNull(),
});

export const trades = sqliteTable("trades", {
  id:               text("id").primaryKey(),
  sessionId:        text("session_id").notNull()
                      .references(() => sessions.id, { onDelete: "cascade" }),
  brokerAccountId:  text("broker_account_id")
                      .references(() => brokerAccounts.id, { onDelete: "set null" }),
  instrumentSymbol: text("instrument_symbol").notNull(),   // replaces: asset
  instrumentType:   text("instrument_type").notNull().default("stock"),
  side:             text("side").notNull(),
  entryPrice:       real("entry_price"),
  positionSizeUsd:  real("position_size_usd").notNull(),
  stopLossPrice:    real("stop_loss_price"),
  takeProfitPrice:  real("take_profit_price"),
  strategy:         text("strategy").notNull(),
  status:           text("status").notNull(),
  openedAt:         text("opened_at"),
  closedAt:         text("closed_at"),
  finalPnlUsd:      real("final_pnl_usd"),
  aiCostUsd:        real("ai_cost_usd").notNull().default(0),
  confidenceScore:  real("confidence_score"),
  brokerOrderId:    text("broker_order_id"),
  createdAt:        text("created_at").notNull(),
});

export const agentRuns = sqliteTable("agent_runs", {
  id:           text("id").primaryKey(),
  sessionId:    text("session_id").notNull()
                  .references(() => sessions.id, { onDelete: "cascade" }),
  tradeId:      text("trade_id")
                  .references(() => trades.id, { onDelete: "cascade" }),
  agentType:    text("agent_type").notNull(),
  model:        text("model").notNull(),
  inputTokens:  integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costUsd:      real("cost_usd").notNull(),
  outputText:   text("output_text").notNull(),
  durationMs:   integer("duration_ms").notNull(),
  createdAt:    text("created_at").notNull(),
});

export const events = sqliteTable("events", {
  id:        text("id").primaryKey(),
  sessionId: text("session_id")
               .references(() => sessions.id, { onDelete: "set null" }),
  tradeId:   text("trade_id").references(() => trades.id, { onDelete: "set null" }),
  level:     text("level").notNull(),
  agentType: text("agent_type"),
  message:   text("message").notNull(),
  createdAt: text("created_at").notNull(),
});

export const tradeApprovals = sqliteTable("trade_approvals", {
  id:               text("id").primaryKey(),
  sessionId:        text("session_id").notNull()
                      .references(() => sessions.id, { onDelete: "cascade" }),
  tradeId:          text("trade_id").notNull()
                      .references(() => trades.id, { onDelete: "cascade" }),
  brokerAccountId:  text("broker_account_id").notNull(),
  instrumentSymbol: text("instrument_symbol").notNull(),
  status:           text("status").notNull().default("pending"),
  requestedAt:      text("requested_at").notNull(),
  resolvedAt:       text("resolved_at"),
  decisionNote:     text("decision_note"),
});
```

## Migration SQL (raw DDL)

File: `electron/main/db/migrations.ts`

The migration file uses `sqlite.prepare(...).run()` calls for each table. Key points:
- Drop `session_config` and `session_state` tables if they exist (no compat needed).
- Use `CREATE TABLE IF NOT EXISTS` for all new tables.
- Seed `workspace_preferences` with id=1 via `INSERT OR IGNORE`.
- Enable `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL`.

```
Indexes to create:
  idx_sessions_status       ON sessions(status)
  idx_sessions_is_focused   ON sessions(is_focused)
  idx_trades_session_id     ON trades(session_id)
  idx_trades_status         ON trades(status)
  idx_trades_instrument     ON trades(instrument_symbol, broker_account_id, status)
  idx_agent_runs_session    ON agent_runs(session_id)
  idx_events_session_id     ON events(session_id)
  idx_approvals_session     ON trade_approvals(session_id, status)
```

## Repository Layer

### `SessionRepo` — `electron/main/db/repositories/session-repo.ts`

Key methods:

```typescript
class SessionRepo {
  // Creates session + strategy defaults + 4 AI role defaults in one transaction
  create(input: CreateSessionInput): WorkspaceSession

  list(filters?: SessionFilters): WorkspaceSession[]
  get(id: string): WorkspaceSession | null

  // Atomic: clears all is_focused flags, sets the target row
  setFocus(sessionId: string): void

  // Clears all is_focused flags → global mode
  clearFocus(): void

  getFocused(): WorkspaceSession | null

  // Validates canTransition() before writing; throws INVALID_TRANSITION if illegal
  setStatus(id: string, to: SessionStatus): void

  // Throws LOCKED if session is active or paused
  updateTaskBoundary(id: string, input: TaskBoundaryInput): void

  duplicate(sourceId: string, overrides: { name: string }): WorkspaceSession
}
```

### `WorkspacePreferencesRepo` — always returns the singleton row

```typescript
class WorkspacePreferencesRepo {
  get(): WorkspacePreferences
  update(patch: Partial<Omit<WorkspacePreferences, "id">>): WorkspacePreferences
}
```

### `TradesRepo` — instrument collision check

```typescript
// Returns true if another active/paused session already has this
// (broker_account_id, instrument_symbol) pair open or pending
checkInstrumentConflict(
  brokerAccountId: string,
  instrumentSymbol: string,
  excludeSessionId: string
): boolean
```

Implementation: single SQL query joining `trades` to `sessions` on `sessionId`,
filtering `trades.status IN ('open','pending')` and `sessions.status IN ('active','paused')`
and `sessions.id != excludeSessionId`. Returns count > 0.

## Sequence — Session Create

```mermaid
sequenceDiagram
    actor User
    participant IPC as ipc/session.ts
    participant Svc as SessionService
    participant Repo as SessionRepo
    participant DB as SQLite

    User->>IPC: createSession(input)
    IPC->>Svc: create(input)
    Svc->>Svc: validateTaskBoundary(input)
    Svc->>Svc: validateBrokerCompatibility(input)
    Svc->>Repo: create(input)
    Repo->>DB: BEGIN TRANSACTION
    Repo->>DB: INSERT sessions
    Repo->>DB: INSERT session_strategies (defaults)
    Repo->>DB: INSERT session_ai_roles x4 (defaults)
    Repo->>DB: INSERT session_broker_assignments
    Repo->>DB: COMMIT
    DB-->>Repo: ok
    Repo-->>Svc: WorkspaceSession
    Svc->>Repo: setFocus(newId)
    Repo->>DB: BEGIN TRANSACTION
    Repo->>DB: UPDATE sessions SET is_focused=0 WHERE is_focused=1
    Repo->>DB: UPDATE sessions SET is_focused=1 WHERE id=newId
    Repo->>DB: COMMIT
    Svc-->>IPC: { id, status: "draft" }
    IPC-->>User: 201 Created
```

## Sequence — Set Focus (cross-page context switch)

```mermaid
sequenceDiagram
    actor User
    participant IPC
    participant Repo as SessionRepo
    participant DB as SQLite

    User->>IPC: focusSession(sessionId)
    IPC->>Repo: setFocus(sessionId)
    Repo->>DB: BEGIN TRANSACTION
    Repo->>DB: UPDATE sessions SET is_focused=0 (all rows)
    Repo->>DB: UPDATE sessions SET is_focused=1 WHERE id=sessionId
    Repo->>DB: COMMIT
    Repo-->>IPC: void
    IPC-->>User: { workspaceViewMode: "session", focusedSessionId }
```

## Files Created / Modified

| Action | File |
|--------|------|
| Replace | `electron/main/db/schema.ts` |
| Replace | `electron/main/db/migrations.ts` |
| Replace | `electron/main/db/repositories/session-repo.ts` |
| Create | `electron/main/db/repositories/workspace-prefs-repo.ts` |
| Create | `electron/main/db/repositories/session-strategies-repo.ts` |
| Create | `electron/main/db/repositories/session-ai-roles-repo.ts` |
| Create | `electron/main/db/repositories/provider-accounts-repo.ts` |
| Create | `electron/main/db/repositories/broker-accounts-repo.ts` |
| Create | `electron/main/db/repositories/trade-approvals-repo.ts` |
| Create | `electron/main/db/repositories/session-templates-repo.ts` |
| Modify | `electron/main/db/repositories/trades-repo.ts` |
| Modify | `electron/main/db/repositories/agent-runs-repo.ts` |
| Modify | `electron/main/db/repositories/events-repo.ts` |
| Modify | `electron/main/db/client.ts` — wire all new repos |

## Acceptance Criteria

- `runMigrations()` runs on empty DB without errors.
- `SessionRepo.setFocus()` is atomic; no two rows can have `is_focused=true` simultaneously.
- `TradesRepo.checkInstrumentConflict()` returns `true` for active-session conflicts.
- `WorkspacePreferencesRepo.get()` always returns a row.
- `SessionRepo.setStatus()` throws on illegal transitions (e.g. archived → active).
- TypeScript compiles; existing `AppServices` wiring compiles with stub implementations.
