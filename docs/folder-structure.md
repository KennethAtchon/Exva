# Project Folder Structure

> **Purpose:** Annotated map of the codebase. What each folder does and why it exists.
> Last updated: 2026-05-23

---

## Top-Level

```
Exva/
├── electron/        # All Electron application code (main + renderer + shared contracts)
├── src/             # React renderer (frontend UI)
├── docs/            # Documentation, plans, specs, architecture notes
├── e2e/             # End-to-end tests (Playwright/smoke)
├── scripts/         # Dev utility scripts (DB reset, etc.)
├── drizzle.config.ts
├── components.json  # shadcn/ui component registry
└── bunfig.toml      # Bun runtime config
```

---

## `electron/` — Application Code

Three sub-zones with strict boundaries:

| Zone | Boundary |
|------|----------|
| `electron/main/` | Node.js process — runs DB, services, IPC handlers |
| `electron/preload/` | Context-bridge script — exposes IPC API to renderer |
| `electron/shared/` | Types and contracts shared by both main AND renderer |

### `electron/shared/` — Shared Contracts

```
shared/
├── ai/              # Pipeline config types, phase enums, signal types (used by renderer for display)
├── catalog/         # Instrument-related shared types (not domain logic)
├── domain/          # Core domain types: Session, Trade, Workspace, EnvironmentMode, MockScenario
├── infra/           # Shared infrastructure types
├── ipc/             # IPC channel names, endpoint constants, DTO shapes
├── presets/         # Default preset JSON files (risk, timeframe, trade-rules, research-posture)
├── validation/      # Shared zod schemas or validators
└── domain.ts        # Re-export barrel for domain types
```

> **Why shared/:** The renderer needs to know the shape of a `Session` or `Trade` to display it.
> The main process owns the data. `shared/` is the contract between them — no logic, just types.

---

## `electron/main/` — Main Process

### `electron/main/db/` — Database Layer

```
db/
├── schema.ts             # Single Drizzle ORM schema definition for all tables
├── client.ts             # DB connection singleton
├── migrations.ts         # Migration runner
├── seed.ts               # Initial data seeding
├── drizzle/              # Generated SQL migration files
└── repositories/         # One repo per domain area — typed DB access
    ├── agents/           # agent_runs, agent_messages
    ├── brokers/          # broker_accounts, broker_routing
    ├── market/           # instrument_cache
    ├── presets/          # global, risk, timeframe, trade-rule, research-posture presets
    ├── sessions/         # session + all session-scoped config tables
    ├── system/           # api_call_log, events, stats
    ├── trades/           # trades, capital_reservations, trade_approvals, trade_autopsies
    └── workspace/        # provider_accounts, workspace_prefs
```

> **Why repositories/:** Each repo maps 1:1 to a DB domain. Services call repos, not raw SQL.

---

### `electron/main/ipc/` — IPC Handlers

```
ipc/
├── register.ts            # Registers all handlers at app start
├── handle.ts              # Typed ipcMain.handle wrapper
├── environment-guards.ts  # Guards that block handlers in wrong environment mode
├── accounts.ts            # Provider account management
├── approvals.ts           # Trade approval queue handlers
├── broker-accounts.ts     # Broker account CRUD
├── broker-account-helpers.ts
├── config.ts              # Workspace config handlers
├── dashboard.ts           # Dashboard stats/summary handlers
├── developer.ts           # Dev tools handlers (DB reset, log inspection)
├── events.ts              # Event stream handlers
├── replay.ts              # Session replay handlers
├── session.ts             # Session lifecycle handlers
├── strategy.ts            # Strategy config handlers
├── templates.ts           # Session template handlers
├── trades.ts              # Trade query handlers
└── workspace.ts           # Workspace preference handlers
```

> **Why flat ipc/:** All IPC handlers live here. Each file = one domain boundary.
> `register.ts` wires them all into `ipcMain` at startup.

---

### `electron/main/services/` — Business Logic

The real complexity. Broken into domain clusters:

---

#### `services/llm/` — AI / LLM Layer

```
services/llm/
├── adapters/              # LLM provider adapters (normalize request/response)
│   ├── anthropic-adapter.ts
│   ├── openai-adapter.ts
│   └── openrouter-adapter.ts
│
├── ai-runtime/            # Raw LLM invocation engine
│   ├── runtime.ts         # Sends messages to model, handles streaming/retries
│   ├── runtime-trace.ts   # Traces each LLM call for observability
│   ├── runtime-retry.ts   # Retry logic for failed calls
│   ├── tool-loop-guard.ts # Prevents infinite tool-call loops
│   └── ai-runtime-types.ts
│
├── pipeline/      # Multi-phase AI analysis pipeline (the "brain")
│   ├── core/              # Pipeline entry point and shared types
│   ├── context/           # Builds session context injected into every prompt
│   ├── definitions/       # Pipeline phase definitions (what runs in what order)
│   ├── prompting/         # Prompt envelope builder, preset behavior guidance
│   ├── prompts/           # Worker prompt files grouped by pipeline phase
│   │   ├── selector-workers/    # Prompts for instrument selection phase
│   │   ├── technical-workers/   # Prompts for technical analysis phase
│   │   ├── fundamental-workers/ # Prompts for fundamental analysis phase
│   │   ├── review-workers/      # Prompts for review/synthesis phase
│   │   └── decision-workers/    # Prompts for trade decision phase
│   ├── plan/              # Plan-based execution of multi-step pipelines
│   │   ├── plans/         # Concrete plans: selector pipeline, trade pipeline
│   │   ├── engine/        # Plan executor (runs steps, manages state)
│   │   ├── phase/         # Phase coordinator
│   │   ├── cycle/         # Per-cycle plan state
│   │   ├── cache/         # Plan result caching
│   │   ├── registry/      # Plan type registry
│   │   ├── unified/       # Unified plan runner
│   │   └── input-builders/ # Builds per-step input from session state
│   └── execution/         # Executes a single pipeline worker call
│
├── engines/               # Signal processing and scoring (post-LLM logic)
│   ├── aggregators/       # Merges outputs across workers: technical, fundamental, review, trade signal
│   ├── selector/          # Scores and filters instrument candidates
│   └── execution/         # Execution profile and prediction market engines
│
├── search/                # Web search provider abstraction
│   ├── search-registry.ts
│   ├── search-types.ts
│   └── adapters/          # Brave, DuckDuckGo, Tavily, MCP adapters
│
└── tools/                 # LLM-callable tools (functions the AI can invoke)
    ├── fetch-url-tool.ts
    ├── market-tools.ts
    ├── search-tool.ts
    ├── search-reddit-tool.ts
    └── trending-symbols-tool.ts
```

> **`ai-runtime/`** = how we talk to LLMs (one call, streaming, retry).  
> **`pipeline/`** = what we say to them (multi-phase plan, prompt construction, phase sequencing).  
> **`engines/`** = what we do with what they say (aggregation, scoring, filtering).  
> These three concerns are distinct and should not blur.

---

#### `services/broker/` — Broker Integration

```
services/broker/
├── broker-service.ts          # Main broker facade
├── broker-registry.ts         # Maps session → broker adapter
├── broker-routing-service.ts  # Routes orders to correct broker
├── broker-capital-service.ts  # Capital balance queries
├── broker-balance-cache-service.ts
├── broker-balance-ticker.ts   # Live balance polling
├── instrument-normalizer.ts   # Normalizes instrument symbols across brokers
├── adapters/                  # One adapter per live broker
│   ├── broker-adapter.ts      # Base interface
│   ├── alpaca-adapter.ts
│   ├── coinbase-advanced-trade-adapter.ts
│   ├── tradovate-adapter.ts
│   └── polymarket-adapter.ts
└── mock/                      # Paper/mock broker for sandbox mode
    ├── mock-adapter.ts
    └── mock-scenario-fixtures.ts
```

---

#### `services/orchestration/` — Trading Cycle Loop

```
services/orchestration/
├── index.ts                  # Entry point — starts/stops the orchestration loop
├── cycle/                    # Per-cycle execution (runs on each tick)
│   ├── agent-orchestrator.ts # Drives one instrument through the full AI pipeline
│   ├── execution-step-runner.ts # Runs one step of the execution plan
│   ├── market-hours-service.ts  # Checks if markets are open
│   ├── orchestrator-context.ts  # Shared context passed through a cycle
│   ├── orchestrator-step.ts     # Step type definitions
│   ├── scheduling/           # Instrument queue and trade-closed event handling
│   └── selector/             # Runs the instrument selector pipeline for this cycle
│       └── run-selector.ts
├── lifecycle/                # Session start/stop lifecycle management
│   ├── position-manager-service.ts
│   └── trade-monitor.ts
├── policy/                   # Pre-trade policy gates
│   └── (capital limits, position limits, risk checks before order submission)
├── post-trade/               # Post-trade processing
│   └── trade-autopsy-service.ts  # Scores completed trades, writes scorecard
└── replay/                   # Replays a historical session cycle for review
```

> **`cycle/`** = what happens every tick.  
> **`lifecycle/`** = what happens when a session starts or stops.  
> **`policy/`** = guards that block a trade before it fires.  
> **`post-trade/`** = what happens after a trade closes.

---

#### `services/session/` — Session Management

```
services/session/
├── session-service.ts              # Session CRUD and query
├── session-runtime-manager.ts      # Manages live session runtime state (running/stopped)
├── session-runtime.ts              # Runtime object for a single active session
├── session-strategy-context-service.ts  # Resolves effective strategy config for a session
├── session-types.ts                # Internal session type definitions
├── template-service.ts             # Session templates CRUD
├── listing-service.ts              # Lists sessions with filters
├── write-service.ts                # Session write operations
├── effective-instrument-classes.ts # Resolves which instrument classes apply to a session
└── preflight/                      # Pre-launch checks before a session can start
```

---

#### `services/risk/` — Risk Management

```
services/risk/
├── risk-engine.ts                 # Core risk checks (position size, exposure limits)
├── capital-reservation-service.ts # Reserves capital before order placement
├── exit-policy-evaluator.ts       # Evaluates exit conditions for open positions
├── broker-allocation-gate.ts      # Validates broker has allocation capacity
├── live-readiness-service.ts      # Checks if system is ready for live trading
└── session-instrument-classes.ts  # Maps instrument classes for risk purposes
```

---

#### `services/instrument/` — Instrument Cache

```
services/instrument/
├── instrument-cache-service.ts    # Fetches and caches instrument metadata
└── index.ts
```

---

#### `services/analytics/` — Performance Analytics

```
services/analytics/
└── paper-scorecard-service.ts     # Computes paper trading scorecards from trade history
```

---

#### `services/infra/` — Infrastructure Primitives

```
services/infra/
├── log.ts                  # Structured logger
├── log-safety.ts           # Sanitizes sensitive values from logs
├── event-bus.ts            # In-process event pub/sub
├── notification-service.ts # Desktop notification delivery
└── secrets-service.ts      # Reads secrets from OS keychain / env
```

---

#### `services/workspace/` — Workspace Preferences

```
services/workspace/
└── environment-scope.ts    # Resolves active environment mode (live/paper/mock)
```

---

## `src/` — Renderer (React UI)

```
src/
├── pages/              # Top-level page components (one per route)
│   ├── Dashboard.tsx
│   ├── SessionsPage.tsx
│   ├── TradesPage.tsx
│   ├── TradeDetail.tsx
│   ├── AccountsPage.tsx
│   ├── BrokersPage.tsx
│   ├── StrategyConfig.tsx
│   ├── CostBreakdown.tsx
│   └── DevPanel.tsx
├── components/         # Reusable UI components
│   ├── sessions/       # Session list, detail, controls
│   ├── approvals/      # Trade approval queue UI
│   ├── accounts/       # Account management UI
│   ├── strategy/       # Strategy configuration UI
│   ├── custom-ui/      # App-specific non-generic components
│   └── ui/             # shadcn/ui primitives (Button, Card, etc.)
├── store/              # Zustand stores (client-side state)
│   ├── sessionStore.ts
│   ├── tradeStore.ts
│   ├── strategyStore.ts
│   ├── configStore.ts
│   └── workspaceStore.ts
├── hooks/              # Custom React hooks
└── lib/                # Frontend utilities
```

---

## `docs/` — Documentation

```
docs/
├── architecture/       # How subsystems work (ai-runtime, pipeline-runtime, electron)
├── design/             # Product and design specs
├── engineering/        # Coding guidelines, debugging guide, logging guide
├── plans/              # Active implementation plans
│   └── archieve/       # Completed/obsolete plans
├── reviews/            # Code review artifacts
└── specs/              # Feature specs
```

---

## `e2e/` — End-to-End Tests

```
e2e/
└── launch-smoke.spec.ts   # Smoke test: app launches without crash
```

---

## Key Separations of Concern

| Concern | Where it lives |
|---------|---------------|
| Talking to LLMs | `services/llm/` |
| Building prompts & running multi-phase analysis | `services/llm/pipeline/` |
| Scoring/aggregating LLM outputs | `services/signal/` |
| Talking to brokers | `services/broker/` |
| Trading cycle loop | `services/orchestration/cycle/` |
| Pre-trade risk gates | `services/orchestration/policy/` + `services/risk/` |
| Session state & lifecycle | `services/session/` |
| DB access | `db/repositories/` |
| IPC surface | `ipc/` |
| Shared types (main ↔ renderer) | `electron/shared/` |
| UI | `src/` |
