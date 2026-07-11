# Project Folder Structure

> **Purpose:** Annotated map of the current Exva codebase: what each folder owns, what should not live there, and where to start when changing a subsystem.
> **Last updated:** 2026-05-24

---

## Top Level

```
Exva/
├── electron/                 # Electron main/preload/shared code
├── src/                      # React renderer UI
├── docs/                     # Architecture docs, specs, plans, reviews, engineering guides
├── e2e/                      # Playwright smoke/end-to-end tests
├── scripts/                  # Local dev scripts such as DB reset
├── .github/workflows/        # CI workflow definitions
├── README.md                 # Project overview and dev setup
├── index.html                # Renderer HTML shell for Vite
├── drizzle.config.ts         # Drizzle migration config
├── forge.config.ts           # Electron Forge package/make config
├── vite.config.ts            # Base Vite config
├── vite.main.config.ts       # Vite config for main process
├── vite.preload.config.ts    # Vite config for preload script
├── vite.renderer.config.ts   # Vite config for renderer
├── vitest.config.ts          # Unit/integration test config
├── playwright.config.ts      # E2E test config
├── tsconfig.json             # Renderer/shared TypeScript config
├── tsconfig.node.json        # Node/main-process TypeScript config
├── eslint.config.js          # ESLint flat config
├── postcss.config.js         # PostCSS config for Tailwind
├── components.json           # shadcn/ui registry config
├── tailwind.config.js        # Tailwind renderer config
├── bunfig.toml               # Bun runtime config
├── bun.lock                  # Bun lockfile
├── package-lock.json         # Present in tree; package.json still declares Bun as package manager
└── package.json              # Scripts, dependencies, packageManager=bun@1.3.11
```

`package.json` declares Bun as the package manager and all documented commands should use `bun run ...`. If `package-lock.json` is removed later, update this map at the same time.

---

## `electron/` - Electron App Code

```
electron/
├── main/                     # Privileged Node/Electron process
├── preload/                  # Sandboxed bridge exposed to renderer as window.exva
├── shared/                   # Main/renderer shared types, constants, schemas, IPC names
├── types/                    # Ambient TypeScript declarations and global augmentations
└── prompts/                  # Empty legacy directory; worker prompt text lives in pipeline/worker-prompts.ts
```

Boundaries:

| Folder              | Owns                                                                                   | Must not own                                            |
| ------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `electron/main/`    | DB, repositories, services, IPC handlers, broker/search/AI adapters, runtime lifecycle | React components or direct renderer state               |
| `electron/preload/` | Typed `contextBridge` API and event subscription wrappers                              | Business logic, secrets, DB access                      |
| `electron/shared/`  | Cross-process contracts and pure shared constants/types                                | Main-process services, filesystem access, Electron APIs |
| `electron/types/`   | Global/window type shims and third-party module augmentations                          | Runtime logic or imports with side effects              |

---

## `electron/preload/` - Renderer Bridge

```
electron/preload/
├── exva-api.ts               # Typed contextBridge API surface exposed as window.exva
└── index.ts                  # Preload entry point
```

---

## `electron/types/` - Ambient Declarations

```
electron/types/
├── global.d.ts               # Window/global augmentations
└── ai-sdk-openai.d.ts        # AI SDK type shims
```

---

## `electron/shared/` - Shared Contracts

```
electron/shared/
├── ai/                       # AI phase config, phase enums, traces, trade signals, selector candidates
├── domain/                   # Session, trade, workspace, environment, mock scenario domain types
├── infra/                    # Shared error shapes and infra-level contracts
├── instruments/              # Search-provider ids and session instrument-class helpers
├── ipc/                      # IPC channel names, endpoint constants, DTOs
├── presets/                  # Built-in preset JSON and preset index exports
├── validation/               # Shared Zod schemas
├── __tests__/                # Shared contract tests
└── domain.ts                 # Domain barrel export
```

`shared/` is the contract layer. If both main and renderer need to agree on a shape, put the type or constant here. If the code performs IO, talks to Electron, reads the DB, or touches secrets, it does not belong here.

---

## `electron/main/` - Main Process

```
electron/main/
├── config/                   # Main-process environment config
├── db/                       # SQLite/Drizzle schema, migrations, repos, seed/test helpers
├── ipc/                      # ipcMain handlers grouped by domain
├── services/                 # Business/runtime service layer
├── index.ts                  # Electron app startup
└── window.ts                 # BrowserWindow creation and security/navigation policy
```

The main process is the source of truth for privileged state and side effects. Renderer code should reach it only through preload/IPC.

---

## `electron/main/config/` - Environment Config

```
electron/main/config/
└── env.ts                    # Main-process environment variable loading and validation
```

---

## `electron/main/db/` - Database Layer

```
electron/main/db/
├── schema.ts                 # Drizzle table definitions for the local SQLite DB
├── client.ts                 # better-sqlite3 client creation, WAL, migrations
├── migrations.ts             # Migration runner / migration list
├── migrations-folder.ts      # Migration folder resolution
├── migrations.test.ts        # Migration runner tests
├── seed.ts                   # Seed data for new DBs
├── test-helpers.ts           # DB test helper utilities
├── drizzle/                  # Generated SQL migration files and metadata
└── repositories/
    ├── agents/               # agent_runs and agent_messages repos
    ├── brokers/              # broker accounts and routing repos
    ├── market/               # instrument selector/cache repos
    ├── presets/              # built-in/custom preset repos
    ├── sessions/             # sessions and all session-scoped config repos
    ├── system/               # events, stats, API-call logs, mappers
    ├── trades/               # trades, approvals, capital reservations, autopsies
    └── workspace/            # provider accounts and workspace preferences
```

Services call repositories instead of opening raw SQLite handles directly. New persistent state should usually be added as: shared type/schema if needed, Drizzle table, migration, repository method, service method, IPC method if renderer-facing.

---

## `electron/main/ipc/` - IPC Handlers

```
electron/main/ipc/
├── register.ts               # Registers every handler at app startup
├── handle.ts                 # Typed ipcMain.handle wrapper
├── environment-guards.ts     # Blocks handlers in incompatible environment modes
├── __tests__/                # IPC helper/handler tests
├── session/
│   ├── session.ts            # Session lifecycle, list/detail/progress controls
│   ├── templates.ts          # Session template APIs
│   └── replay.ts             # Cycle replay APIs
├── trading/
│   ├── trades.ts             # Trade list/detail/actions
│   ├── approvals.ts          # Approval queue resolve/recheck APIs
│   ├── broker-accounts.ts    # Broker account CRUD/connectivity
│   └── broker-account-helpers.ts
├── workspace/
│   ├── workspace.ts          # Workspace preferences/focus mode APIs
│   ├── config.ts             # Legacy/config workspace APIs still present
│   ├── strategy.ts           # Strategy/risk/timeframe/AI config APIs
│   └── accounts.ts           # Provider account APIs
└── system/
    ├── dashboard.ts          # Dashboard aggregates
    ├── events.ts             # Runtime event queries
    └── developer.ts          # Developer/debug data APIs
```

IPC files should be thin: validate/shape input, call services, return DTOs. They should not become business-logic owners.

---

## `electron/main/services/` - Service Layer

```
electron/main/services/
├── app-services.ts           # Composition root for repos, services, registries, runtimes
├── analytics/                # Post-trade autopsy and paper scorecard summaries
├── broker/                   # Broker facade, routing, capital, balances, adapters, mock broker data
├── infra/                    # Logging, log safety, event bus, notifications, Keychain secrets
├── instrument/               # Instrument metadata/cache service
├── llm/                      # LLM provider facade, provider registry, adapters, retry, trace, pricing
├── orchestration/            # Live trading loop, selector/trade cycles, lifecycle monitor, policy gates
├── pipeline/                 # AI phase/instrument-analysis runtime, prompts, tools, implementations
├── replay/                   # Offline cycle replay/debug reconstruction
├── risk/                     # Risk engine, allocation gate, capital reservations, live readiness, exit policy
├── search/                   # Search-provider registry and provider adapters
├── session/                  # Session lifecycle, runtime manager, templates, writes, preflight
├── signal/                   # Deterministic aggregation/scoring/execution-profile signal engines
└── tools/                    # LLM-callable tool implementations exposed to workers
```

This is the busiest part of the codebase. Folder boundaries matter because the app has many concepts named similarly. In current naming: `llm/` talks to model providers, `pipeline/` decides what AI work runs, `signal/` processes outputs deterministically, and `orchestration/` decides when live trading work happens.

Subsections below use the shorthand `services/...`; the full path is always `electron/main/services/...`.

---

## `services/llm/` - LLM Boundary

```
services/llm/
├── README.md
├── runtime.ts                # LLMRuntime facade over PipelineRuntime
├── provider-registry.ts      # provider_accounts + Keychain -> concrete ProviderAdapter
├── runtime-retry.ts          # Provider retry/timeout/error wrapping
├── tool-loop-guard.ts        # Detects repeated tool-call loops
├── llm-types.ts              # Normalized message/trace/run result types
├── model-pricing.ts          # Fallback token pricing
├── resolve-run-cost.ts       # Provider-reported vs estimated cost resolution
├── index.ts
├── __tests__/
└── adapters/
    ├── README.md
    ├── provider-adapter.ts   # Normalized ProviderAdapter interface
    ├── run-agent-execute.ts  # Shared AI SDK agent execution helper
    ├── reasoning-options.ts  # Reasoning option mapping/tests
    ├── anthropic-adapter.ts
    ├── openai-adapter.ts
    └── openrouter-adapter.ts
```

`LLMRuntime` is the runtime facade used by the rest of main. Provider-specific HTTP/SDK differences stop at the adapter boundary; pipeline code receives normalized `LLMCallTrace` and `LLMRunResult` shapes.

---

## `services/pipeline/` - AI Analysis Runtime

```
services/pipeline/
├── README.md
├── worker-prompts.ts                 # Compiled prompt constants used by worker definitions
├── ai-phase-config-resolver.ts       # Session/phase/worker config resolver
├── effective-ai-phase-config.ts      # Effective pipeline config validation/resolution
├── core/
│   ├── README.md
│   ├── pipeline-runtime.ts           # PipelineRuntime entry point
│   ├── pipeline-registry.ts          # Static definition catalog validation
│   ├── concurrent-group-runner.ts    # Concurrency-limited worker groups
│   ├── worker-graph-scheduler.ts     # Dependency graph batching helper
│   ├── worker-graph-scheduler.test.ts
│   └── types.ts
├── definitions/
│   ├── README.md
│   ├── index.ts                      # Boot: registerAllPhases
│   ├── phase-catalog.ts              # Phase catalog metadata
│   ├── all-phases.ts
│   ├── aggregator.types.ts
│   ├── selector.phase.ts             # Selector AIPhase definition, helpers, schemas
│   ├── selector.helpers.ts
│   ├── selector.schemas.ts
│   ├── technical.phase.ts
│   ├── fundamental.phase.ts
│   ├── review.phase.ts
│   └── decision.phase.ts
├── engines/
│   ├── README.md
│   ├── index.ts                      # Side-effect registration of shared selector engines
│   ├── registry.ts                   # registerEngine/resolveEngine/clearEngineRegistry
│   ├── worker-output.ts              # Worker output contracts for engine finalizers
│   ├── input/                        # Selector input engines (scope, broker coverage, PM candidates)
│   ├── entry-mode/                   # Entry-mode short-circuits (manual shortlist)
│   ├── cache/                        # Selector instrument cache policy
│   └── finalizer/                    # Phase finalizers delegating to signal/ aggregators/scoring
├── phases/
│   ├── README.md
│   ├── types.ts                      # AIPhase contracts
│   ├── interpreter.ts                # AIPhaseRunner
│   ├── registry.ts                   # register/require AI phases
│   └── services.ts                   # Service deps available to phase implementations
├── analysis/
│   ├── README.md
│   ├── types.ts                      # InstrumentAnalysis contracts
│   ├── interpreter.ts                # InstrumentAnalysisRunner
│   ├── stage-runner.ts               # Declarative analysis-step execution adapter
│   ├── registry.ts                   # register/require instrument analyses
│   └── services.ts                   # Service deps available to analysis implementations
├── execution/
│   ├── README.md
│   ├── worker-executor.ts            # runAIWorker leaf execution
│   ├── ai-spend-tracker.ts           # Phase/pipeline/session spend caps
│   ├── trace-assembler.ts            # Worker/aggregate trace assembly
│   ├── engine-prompt-injector.ts     # Read-mode engine result injection
│   ├── input-builder-registry.ts     # Deterministic engine input builders
│   ├── stage-dispatch.ts             # Analysis-step dispatch adapter
│   ├── worker-structured-output.ts   # Terminal tool output parsing/validation
│   ├── worker-tool-requirements.ts   # Required tool-use policy helpers
│   └── __tests__/
├── prompting/
│   ├── README.md
│   ├── worker-prompt-builder.ts      # System/user LLM message assembly
│   ├── strategy-guidance.ts
│   └── strategy-prompt-context.ts
├── worker-tools/
│   ├── README.md
│   ├── worker-tool-factory.ts        # Runtime tool-set construction
│   ├── worker-tool-resolver.ts       # WorkerToolContext resolution
│   ├── resolve-mock-tool-context.ts
│   └── resolve-search-provider.ts
└── implementations/
    ├── README.md
    ├── trade/                        # Default trade InstrumentAnalysis and analysis steps
    ├── inputs/                       # Trade signal-engine input builders
    ├── registry/                     # Instrument analysis registration and resolver wiring
    └── __tests__/
```

Worker prompt text is compiled into TypeScript through `worker-prompts.ts` and assigned directly to `WorkerDefinition.prompt`. Phase definitions live in `definitions/`; phase-level engines (input, entry-mode, cache, finalizer) live in `engines/` and delegate deterministic finalizer work to `services/signals/`.

---

## `services/signals/` - Signal Transport + Deterministic Compute

```
services/signals/
├── aggregators/          # technical/fundamental/review/trade aggregators
├── scoring/              # selector scoring, candidates, risk filter
├── strategy/             # mean-reversion, trend, breakout, options-flow
├── sources/ / repos/ / … # bus, deliveries, dead letters (transport)
```

Worker-level signal engines (ENGINE_BINDINGS) register via `pipeline/engines/signal-registry/`. Execution profiles live in `services/orchestration/trade-execution-profile.ts`.

---

## `services/search/` - Search Providers

```
services/search/
├── README.md
├── index.ts
├── search-registry.ts        # provider_accounts + Keychain -> SearchAdapter
├── search-types.ts
├── sanitize-search-query.ts
├── search-registry.test.ts
├── sanitize-search-query.test.ts
└── adapters/
    ├── README.md
    ├── brave-adapter.ts
    ├── duckduckgo-adapter.ts
    ├── mcp-adapter.ts
    └── tavily-adapter.ts
```

Search providers are infrastructure. The model-facing `search_web` tool lives in `services/tools/search-tool.ts` and is assembled into worker tool sets by `pipeline/worker-tools`.

---

## `services/tools/` - LLM-Callable Tools

```
services/tools/
├── README.md
├── fetch-url-tool.ts         # Fetch/extract URL content for model tool calls
├── market-tools.ts           # get_quote, get_ohlcv, get_news
├── search-tool.ts            # search_web
├── search-reddit-tool.ts     # search_reddit
├── trending-symbols-tool.ts  # get_trending_symbols
├── data-spend-guard.ts       # Tool-call spend guardrails for data-fetching tools
└── __tests__/
```

These are the callable tool implementations. They should stay provider/broker-aware but not decide which worker gets which tool; that belongs to `pipeline/worker-tools` and worker definitions.

---

## `services/broker/` - Broker Integration

```
services/broker/
├── README.md
├── index.ts
├── broker-service.ts
├── broker-registry.ts
├── broker-routing-service.ts
├── broker-capital-service.ts
├── broker-balance-cache-service.ts
├── broker-balance-ticker.ts
├── instrument-normalizer.ts
├── __tests__/
├── adapters/
│   ├── README.md
│   ├── broker-adapter.ts
│   ├── alpaca-adapter.ts
│   ├── coinbase-advanced-trade-adapter.ts
│   ├── tradovate-adapter.ts
│   ├── polymarket-adapter.ts
│   ├── mock-adapter.ts
│   └── mock-adapter.test.ts
└── mock/
    ├── README.md
    ├── mock-market-simulator.ts
    ├── mock-discovery-fixtures.ts
    ├── mock-discovery-fixtures.test.ts
    └── mock-scenario-fixtures.ts
```

`adapters/` contains the normalized broker adapter implementations, including the mock adapter. `mock/` contains fixture/simulation data used by mock sessions and selector discovery.

---

## `services/orchestration/` - Trading Loop

```
services/orchestration/
├── README.md
├── __tests__/                # Cross-cycle integration tests (e.g. mock trade rehearsal)
├── cycle/
│   ├── README.md
│   ├── agent-orchestrator.ts
│   ├── market-hours-service.ts
│   ├── orchestrator-step.ts
│   ├── trading-cycle-context.ts
│   ├── trading-step-runner.ts
│   ├── types.ts
│   ├── utils.ts
│   ├── __tests__/
│   ├── scheduling/
│   │   ├── README.md
│   │   ├── instrument-queue.ts
│   │   └── trade-closed-handler.ts
│   ├── selector/
│   │   ├── README.md
│   │   └── run-selector.ts
│   └── trade/
│       ├── README.md
│       ├── approval-flow.ts
│       ├── approval-recheck.ts
│       ├── effect-runner.ts
│       ├── order-placer.ts
│       ├── order-policy-task.ts
│       ├── post-decision-gates.ts
│       ├── run-trade-pipeline.ts
│       ├── trade-cycle.ts
│       └── trade-record-builder.ts
├── lifecycle/
│   ├── README.md
│   └── trade-monitor.ts
└── policy/
    ├── README.md
    ├── candidate-validation-service.ts
    ├── order-policy-gate.ts
    ├── outcome-classifier.ts     # Classifies policy/order outcomes for downstream handling
    └── __tests__/
```

Use this split when navigating runtime bugs: `cycle/` is live intake per selector/trade cycle, `lifecycle/` is session/open-position lifecycle, and `policy/` is deterministic pre-order gating.

---

## Other Service Domains

### `services/session/`

```
services/session/
├── README.md
├── index.ts
├── session-service.ts
├── session-runtime-manager.ts
├── session-runtime.ts
├── session-strategy-context-service.ts
├── session-types.ts
├── template-service.ts
├── listing-service.ts
├── write-service.ts
├── effective-instrument-classes.ts
├── environment-scope.ts
├── __tests__/
└── preflight/
    ├── README.md
    ├── index.ts
    ├── task-boundary-check.ts
    ├── selector-config-check.ts
    ├── provider-credentials-check.ts
    ├── instrument-conflict-check.ts
    ├── broker-reachability-check.ts
    └── broker-allocation-check.ts
```

Owns session CRUD/lifecycle, runtime manager wiring, templates, strategy context loading, preflight checks, and effective instrument classes.

### `services/risk/`

```
services/risk/
├── README.md
├── index.ts
├── risk-engine.ts
├── broker-allocation-gate.ts
├── capital-reservation-service.ts
├── exit-policy-evaluator.ts
├── live-readiness-service.ts
└── __tests__/
```

Owns deterministic risk, allocation, reservation, live-readiness, and exit-policy logic.

### `services/infra/`

```
services/infra/
├── README.md
├── event-bus.ts
├── log.ts
├── log-safety.ts
├── notification-service.ts
└── secrets-service.ts
```

Owns cross-cutting local infrastructure primitives. Business services depend on these; these should not depend on business services.

### `services/analytics/`

```
services/analytics/
├── README.md
├── trade-autopsy-service.ts
├── paper-scorecard-service.ts
└── __tests__/
```

Owns post-trade analysis and paper-scorecard summaries, not live order placement.

### `services/replay/`

```
services/replay/
├── README.md
├── cycle-replay-service.ts
├── __fixtures__/             # Saved cycle replay JSON fixtures
└── __tests__/
```

Owns offline cycle reconstruction for debugging/review. It should not mutate live runtime state.

### `services/instrument/`

```
services/instrument/
├── README.md
├── index.ts
└── instrument-cache-service.ts
```

Owns instrument metadata/cache lookup. Selector result caching lives separately in `services/pipeline/engines/cache/` and the market repository.

---

## `src/` - Renderer

```
src/
├── App.tsx                   # Root React component and route shell
├── main.tsx                  # Renderer entry point
├── pages/                    # Route-level pages: Dashboard, Sessions, Trades, Strategy, DevPanel, etc.
├── components/
│   ├── accounts/             # Provider account UI
│   ├── approvals/            # Approval queue UI
│   ├── custom-ui/            # App-specific reusable UI
│   ├── sessions/             # Session list/detail/create/edit/runtime controls
│   ├── strategy/             # Strategy/risk/timeframe/AI config UI
│   └── ui/                   # shadcn/ui primitives
├── hooks/                    # Renderer hooks
├── lib/                      # Renderer API wrappers, helpers, schemas/types used by UI
├── store/                    # Zustand stores
└── styles.css                # Renderer global styles/theme tokens
```

Renderer code should call `window.exva` wrappers and stores. It should not import main-process code or touch filesystem/DB APIs.

---

## `docs/` - Documentation

```
docs/
├── folder-structure.md       # This map
├── TODO.md                   # Engineering todo scratchpad
├── USAGE.md                  # Documentation usage guide
├── architecture/             # Architecture docs and architecture template
├── design/                   # Product/design specs and templates
├── engineering/              # Coding, debugging, and logging guides
├── plans/                    # Implementation plans
│   ├── index.md              # Plans index
│   └── archieve/             # Historical plans kept for reference (name is currently spelled this way)
│       └── phase-specs/      # Detailed phase/spec implementation notes
├── reviews/                  # Review artifacts and audits
└── specs/                    # Feature specs
```

Architecture docs should reflect current code. Plans can describe intended future work, but should clearly mark status and verification limits.

---

## `e2e/` - End-to-End Tests

```
e2e/
└── launch-smoke.spec.ts      # Launch smoke test
```

---

## Key Separations Of Concern

| Concern                                                | Where it lives                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Electron startup/window security                       | `electron/main/index.ts`, `electron/main/window.ts`                            |
| IPC surface                                            | `electron/main/ipc/`, `electron/shared/ipc/`, `electron/preload/`              |
| Ambient/global TypeScript declarations                 | `electron/types/`                                                              |
| DB schema and repositories                             | `electron/main/db/`                                                            |
| App composition root                                   | `electron/main/services/app-services.ts`                                       |
| Session lifecycle and runtime ownership                | `electron/main/services/session/`                                              |
| Live trading loop                                      | `electron/main/services/orchestration/cycle/`                                  |
| Trade monitoring                                       | `electron/main/services/orchestration/lifecycle/`                              |
| Pre-order policy gates                                 | `electron/main/services/orchestration/policy/`, `electron/main/services/risk/` |
| AI provider calls and normalized traces                | `electron/main/services/llm/`                                                  |
| AI analysis sequencing, prompts, workers, tools        | `electron/main/services/pipeline/`                                             |
| Phase-level engine registry (input, cache, finalizers) | `electron/main/services/pipeline/engines/`                                     |
| Deterministic output processing                        | `electron/main/services/signals/`                                              |
| LLM-callable tool implementations                      | `electron/main/services/tools/`                                                |
| Search provider adapters                               | `electron/main/services/search/`                                               |
| Broker adapters/routing/capital/balances               | `electron/main/services/broker/`                                               |
| Replay/debug reconstruction                            | `electron/main/services/replay/`                                               |
| Post-trade analytics                                   | `electron/main/services/analytics/`                                            |
| Shared main/renderer contracts                         | `electron/shared/`                                                             |
| Renderer UI                                            | `src/`                                                                         |
