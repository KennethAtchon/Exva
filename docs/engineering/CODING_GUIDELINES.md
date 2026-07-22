# Exva Implementation — Coding Guidelines

> **Status:** Authoritative for engineering rules. Phase-numbered worked examples
> are illustrative history, not a current repository map; verify paths against
> source before using them in a plan or investigation.
> **Reference rule:** Every phase document and every PR description must include the line
> `Implements: docs/engineering/CODING_GUIDELINES.md` and call out any deliberate deviation.
> If the rule conflicts with a phase doc, the rule wins; raise the conflict in `docs/reviews/`.

---

## 1. Architectural Layering

Strict layering. Imports flow downward only.

```
ipc/         (thin wire layer — validate input, call services, format errors)
  ↓
services/    (business logic — domain operations, orchestration)
  ↓
db/repositories/   (persistence — Drizzle queries, transactions, atomic ops)
  ↓
db/schema.ts + shared/domain.ts   (types, schema)
```

Rules:

- `ipc/` never imports another `ipc/` file. Cross-cutting concerns live in services.
- `services/` never imports `ipc/`. If a service needs to fire an event to the renderer, it goes through `EventBus`, not a direct IPC call.
- `db/repositories/` never imports `services/` or `ipc/`. Repos are pure persistence.
- Cross-process contracts live under `electron/shared/` and may be imported from
  renderer and main. Feature code must use an explicit shared domain/IPC/infra
  module rather than reaching across process folders.
- `src/` never imports from `electron/main/` directly. Renderer talks to main only through `electron/preload/exva-api.ts` typings.
- Renderer state stores (`src/store/*`) never call `fetch`. They go through `window.exva.*` (the preload bridge).

Domain subfolders inside `services/` follow the same rule: `llm/`, `pipeline/`,
`broker/`, `risk/`, `session/`, and `instrument/` may not import each other except
through explicit interfaces. Composition roots wire multiple domains together.

### 1.1 Service Folder Pattern (when a service is "big")

A service is "big" — and gets its own folder — when **any** of the following is true:

- It owns more than ~150 lines across implementation + helpers.
- It has a public interface plus one or more concrete implementations or adapters.
- It owns its own value-object types, error subtypes, schemas, or registries.
- It coordinates more than one collaborator (registry + cache + repo, etc.).

Otherwise, a service stays as a single file (`event-bus.ts`, `notification-service.ts`, `secrets-service.ts`).

**Required layout inside a service folder:**

```
<domain>/
├── index.ts                  re-export public surface only (the entry point)
├── <name>-service.ts         primary class with the business logic
├── <name>-types.ts           interfaces, value objects, discriminated unions
├── <name>-errors.ts          AppError factories specific to this domain (optional)
├── <name>-schemas.ts         Zod schemas for inputs/outputs (optional)
├── adapters/                 vendor implementations of an adapter interface
│   ├── <name>-adapter.ts     the interface itself
│   └── <vendor>-adapter.ts   one file per vendor
├── <helper>.ts               internal helpers — not re-exported via index.ts
└── __tests__/                co-located tests for this folder
    └── <name>-service.test.ts
```

**Rules:**

- `index.ts` is the only file external code imports from. Internal files import each other directly. This makes the public surface explicit and refactor-safe.
- `<name>-types.ts` holds types that are local to the domain. Cross-process types
  stay in the appropriate module under `electron/shared/`.
- The adapter interface (`<name>-adapter.ts`) lives next to the concrete adapters; both live under `adapters/` so the domain root stays readable.
- A registry that caches adapter instances (`<name>-registry.ts`) lives at the domain root, not under `adapters/`.
- Tests are co-located in `__tests__/`. Repo tests stay with repos; service tests stay with services.

### 1.2 Worked Examples

The phases in this plan produce three big services. Each follows the pattern.

#### Example A — `llm/` (historical shape; verify current files)

```
electron/main/services/llm/
├── index.ts                          export { AiRuntime, ProviderRegistry, ... }
├── runtime.ts                        class LLMRuntime — pipeline-facing LLM entry point
├── ai-runtime-types.ts               GenerateTextOptions, GenerateResult, AgentResult<T>
├── ai-runtime-schemas.ts             tradeDecisionSchema, instrumentSelectionSchema (Zod)
├── ai-runtime-errors.ts              providerNotConfigured(), missingSecret(), searchProviderRequired()
├── provider-registry.ts              caches adapters by providerAccount.id
├── provider-model-catalog.ts         static model id list per provider type
├── prompt-asset-loader.ts            loads electron/prompts/<role>.md, strips version header
├── adapters/
│   ├── provider-adapter.ts           interface ProviderAdapter
│   ├── anthropic-adapter.ts          class AnthropicAdapter implements ProviderAdapter
│   ├── openai-adapter.ts
│   └── opencode-adapter.ts
├── search/                           sub-domain — search providers (Phase 7)
│   ├── index.ts
│   ├── search-registry.ts
│   ├── search-types.ts               interface SearchAdapter
│   └── adapters/
│       ├── brave-adapter.ts
│       └── tavily-adapter.ts
└── __tests__/
    ├── ai-runtime.test.ts
    ├── provider-registry.test.ts
    └── prompt-asset-loader.test.ts
```

External code only ever writes:

```typescript
import { LLMRuntime, ProviderRegistry } from "@main/services/llm";
```

#### Example B — `broker/` (Phase 8)

```
electron/main/services/broker/
├── index.ts                          export { BrokerRoutingService, BrokerRegistry, ... }
├── broker-routing-service.ts         resolveAdapter, preflightSession
├── broker-routing-types.ts           ResolvedRoute, RoutingDecision
├── broker-routing-errors.ts          noBroker(), routingAmbiguous(), brokerUnreachable()
├── broker-registry.ts                caches adapters by brokerAccount.id
├── instrument-normalizer.ts          canonical → wire-format symbol translation
├── adapters/
│   ├── broker-adapter.ts             interface BrokerAdapter
│   ├── alpaca-adapter.ts             stocks
│   ├── coinbase-advanced-trade-adapter.ts   crypto
│   ├── tradovate-adapter.ts          futures
│   └── mock-adapter.ts               local dev / tests
└── __tests__/
    ├── broker-routing-service.test.ts
    ├── broker-registry.test.ts
    └── instrument-normalizer.test.ts
```

Note: this **supersedes** the `electron/main/broker/` top-level folder shown in Phase 10. Adapters belong under their domain service, not at the top of `electron/main/`. Phase 10 should be amended to consolidate.

#### Example C — `session/` (Phase 0 + 1 + 4)

```
electron/main/services/session/
├── index.ts                          export { SessionService, SessionRuntimeManager, ... }
├── session-service.ts                lifecycle delegation, preflight pipeline
├── session-runtime-manager.ts        owns one SessionRuntime per active/paused session
├── session-runtime.ts                class SessionRuntime — pause/resume/stop, owns orchestrator + monitor
├── session-types.ts                  OrchestratorDeps, SessionRuntimeStatus, PreflightResult
├── session-errors.ts                 invalidTransition(), locked(), sessionNotActive()
├── preflight/
│   ├── index.ts                      runPreflight(session) — composes the 6 steps below
│   ├── task-boundary-check.ts
│   ├── provider-credentials-check.ts
│   ├── broker-reachability-check.ts
│   ├── search-provider-check.ts
│   ├── capital-pool-check.ts
│   └── selector-config-check.ts
└── __tests__/
    ├── session-service.test.ts
    ├── session-runtime-manager.test.ts
    └── preflight/
        ├── task-boundary-check.test.ts
        └── capital-pool-check.test.ts
```

The `preflight/` subfolder is itself a small domain. Each check is a pure function returning a `PreflightResult`; `runPreflight` composes them and short-circuits on first failure. This makes Phase 1.7 of the review ("Session-Start Preflight Pipeline") trivially testable.

### 1.3 What stays at `services/` root

Only the composition root stays directly under `electron/main/services/`:

- `app-services.ts` — wires repositories, domain services, and IPC-facing singletons.

Everything else lives in a domain or support subfolder (e.g. `ai/`, `broker/`, `session/`, `risk/`, `instrument/`, `infra/` for cross-cutting platform helpers, `orchestration/` for `agent-orchestrator`, `trade-monitor`, and selector-definition hashing). If a single file grows past the "big service" thresholds in §1.1, promote it to a folder following the same pattern.

---

## 2. File and Naming Conventions

- File names: `kebab-case.ts`. Tests: `*.test.ts` next to the file under test.
- Class and interface names: `PascalCase`. Type aliases: `PascalCase`. Variables and functions: `camelCase`. Enum-like string unions are lowercase `snake_case` literals (e.g. `"shared_global_pool"`, `"manual_shortlist"`).
- DB column names: `snake_case`. Domain field names: `camelCase`. `mappers.ts` is the only place that bridges the two — never sprinkle conversions across services.
- Repo files end in `-repo.ts`. Service files end in `-service.ts` (or describe purpose like `agent-orchestrator.ts`). Adapter files end in `-adapter.ts`.
- One exported class per file unless the classes are tightly coupled (e.g. an interface and its default impl).
- Barrel files are allowed only at stable boundaries (`services/<domain>/index.ts`, `components/ui/index.ts`). Do not add barrels for internal folders where they hide ownership and create circular-import risk.
- New shared renderer utilities go in `src/lib/`; new shared main-process utilities go in `electron/main/<domain>/` or `electron/main/infra/` depending on who owns them. Do not create a generic `utils/` dump folder.
- Prefer colocating code with its owning feature. If a helper is used by exactly one page, modal, or service, keep it next to that feature instead of promoting it to a shared module.

---

## 2.1 Import Discipline

- Import order: external packages first, then aliased internal imports (`@/`, `@main/`, `@shared/`), then relative imports. Keep one blank line between groups.
- Prefer path aliases over deep relative paths. `../../../` is a smell outside of truly local sibling wiring.
- Import types with `import type` when the value is not used at runtime.
- Do not create circular dependencies to "save time." If two modules need each other, move the shared contract downward into a third module.
- Do not reach across feature boundaries for convenience. If `SessionsPage` needs shared behavior from Strategy code, extract a shared helper or move the logic into the store/service that owns it.

---

## 3. Type Discipline

- `strict: true` and `noUncheckedIndexedAccess: true` in `tsconfig.json` (add if missing).
- No `any`. No `as` casts except at validated boundaries (Zod parse, JSON.parse with schema, IPC ingress). Document each cast with a one-line `// reason: ...` comment.
- All IPC handler inputs go through a Zod schema before reaching a service. The schema lives next to the handler. Inputs are never typed as `unknown` and trusted.
- All cross-process payload shapes are declared as `interface` in `electron/shared/`. Renderer and main both import from there.
- Discriminated unions over flag fields. Status enums use string literal unions, never numeric enums.
- Domain functions like `canTransition()` and `isSessionEditable()` are pure and live in `electron/shared/domain.ts`. They are the single source of truth — never duplicate the logic inline.

---

## 4. Error Handling

Single error type: `AppError` defined in `electron/shared/infra/errors.ts`.

```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: AppErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export type AppErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_TRANSITION"
  | "LOCKED"
  | "NOT_FOUND"
  | "PROVIDER_NOT_CONFIGURED"
  | "MISSING_SECRET"
  | "BROKER_UNREACHABLE"
  | "ROUTING_AMBIGUOUS"
  | "NO_BROKER"
  | "UNSUPPORTED_INSTRUMENT"
  | "SESSION_NOT_ACTIVE"
  | "SELECTOR_NOT_CONFIGURED"
  | "SEARCH_PROVIDER_REQUIRED"
  | "INSTRUMENT_CONFLICT"
  | "CAPITAL_POOL_EXCEEDED"
  | "UNKNOWN";
```

Rules:

- Services throw `AppError` only. Repo-level SQLite errors get wrapped at the service boundary.
- IPC handlers catch `AppError` and serialize to `{ error: { message, code, details } }`. Any non-`AppError` becomes `{ error: { message: "Internal error", code: "UNKNOWN" } }` with the original logged at `error` level.
- Renderer code distinguishes by `code`, never by string-matching messages.
- No silent catches. Every `try/catch` either rethrows, returns a typed result, or logs and converts to an `AppError`. A bare `catch { /* ignore */ }` is forbidden.
- No fallback values that mask failures. If a session has no broker, throw `NO_BROKER`; do not fall back to a default broker.

---

## 5. Persistence Rules

- All multi-row writes that must be consistent run inside `db.transaction(...)`. Examples that **must** be transactional:
  - `SessionRepo.create()` (session + selector_settings + strategy + 5 ai_roles + assignments)
  - `SessionRepo.setFocus()` (clear all + set one)
  - `SessionRepo.duplicate()` (full copy across tables)
  - `CapitalReservationsRepo.convertApprovalToOpenOrder()` (release + reserve)
- Foreign keys are enforced. `PRAGMA foreign_keys = ON` runs on every connection open.
- WAL mode is enabled (`PRAGMA journal_mode = WAL`).
- Indexes are declared in `migrations.ts`, not via Drizzle helpers (Drizzle's index API is unreliable for SQLite). Each phase that adds a query path also adds the index that supports it.
- Singleton tables (e.g. `workspace_preferences`) seed via `INSERT OR IGNORE` and have a CHECK constraint pinning `id = 1`.
- Repos return domain objects, not row shapes. The mapping happens in `mappers.ts`. Services never see `snake_case` keys.

---

## 6. Concurrency

- The main process is single-threaded but I/O is async. Treat every `await` as a yield point — state may have changed.
- Lifecycle operations on a `SessionRuntime` (`start`, `pause`, `resume`, `stop`) are serialized per session via an internal mutex/queue. Two concurrent `pause()` calls on the same session must not race.
- IPC handlers that mutate session-locked state must re-read the session row inside the transaction and re-check `isSessionEditable(status)` — UI-side checks are not enough.
- The `SessionRuntimeManager.runtimes` map is only mutated inside lifecycle methods. Read access is fine; write access requires going through `startSession/stopSession`.
- `checkInstrumentConflict()` is the source of truth for cross-session collisions. Every code path that places an order calls it inside the same transaction that records the trade as `pending`.
- Long-running cycles (research, decision, broker calls) check `runtime.status` between phases and abort cleanly if status is no longer `active`.

---

## 7. AI and Broker Adapter Rules

- Adapters never read `process.env`. Secrets enter the adapter constructor only.
- AI provider adapters use dynamic `import()` for their SDK. Loading an adapter for a provider type that the user has not configured must not load that SDK package.
- Each adapter exposes `testConnection()` and that method must make the smallest possible round-trip (no order placement, no expensive AI generation).
- Adapter results are normalized to the shared `GenerateResult` / `BrokerOrderResult` shape before leaving the adapter. The caller never sees vendor-specific objects.
- The registry caches one adapter per account id. Mutations to the underlying account row call `registry.invalidate(accountId)` — same transaction, before commit.
- Symbol normalization is the broker layer's job. Orchestrator passes canonical symbols (`AAPL`, `BTC-USD`, `MESM6`); adapter translates to wire format.

---

## 8. Prompt and Asset Rules

- Bundled worker prompts currently live in
  `electron/main/services/pipeline/worker-prompts.ts`; assembly lives in
  `pipeline/prompting/worker-prompt-builder.ts`. Do not add a second prompt source
  without one runtime resolver and explicit provenance.
- **Required:** every effective prompt has a version and content hash persisted
  with the run. Prompt provenance shown in diagnostics must come from the same
  resolver used for execution. The current schema does not yet persist both.
- A session override (`promptSource = "session_override"`) is a full snapshot. It
  does not auto-merge upstream changes from the bundled prompt.
- Prompt/message content follows the persistence and redaction rules in
  `docs/engineering/observability-guide.md` and must never be written to ordinary
  logs. `run-agent-execute.ts` is the reference pattern: ordinary logs retain
  metadata and sizes while governed audit content remains in its dedicated store.

---

## 9. IPC Contract Rules

- Every channel is registered as a constant in
  `electron/shared/ipc/channels.ts` and exposed via `electron/preload/exva-api.ts`.
- The preload file exports a typed `ExvaAPI` object. Renderer code uses `window.exva.`\* — never `ipcRenderer` directly.
- Every IPC handler:
  1. Validates input via Zod.
  2. Looks up the session/resource if the operation is scoped.
  3. Re-checks edit-lock when applicable (defense in depth).
  4. Calls a service.
  5. Catches `AppError` and returns `{ error: ... }`.
- One-way push events (`approval_resolved`, `session_status_changed`) flow through `EventBus → mainWindow.webContents.send()`. The renderer subscribes via `window.exva.events.subscribe(channel, handler)`.
- IPC handlers never embed business logic — they orchestrate calls. Logic lives in services.

---

## 10. Renderer State Rules

- One Zustand store per concern (`workspaceStore`, `sessionsStore`, `strategyStore`, `approvalsStore`). No nested stores; cross-store reads use selectors.
- Stores expose actions that wrap IPC calls and update local state on success. Components call actions, not IPC directly.
- Loading and error state lives in the store, not the component.
- Server state that changes via push events (`approval_resolved`, etc.) is invalidated and refetched in the store's event handler — components do not subscribe to events directly.
- Pages are thin: layout + selectors + action calls. Components do not own data fetching outside of mount-time `useEffect(() => store.load(), [])`.
- Stores are the source of truth for async workflows. Components may keep local UI state (`open`, `tab`, `draftText`) but not duplicated server-derived objects that can drift from the store.
- Avoid mirrored state. If a value can be derived from store state or props during render, derive it instead of copying it into `useState`.
- Store actions must either succeed and commit one coherent state update, or fail and surface a typed error/loading state. Do not partially mutate store state across multi-step async flows without a clear recovery path.
- Expensive store bootstrapping (for example fetching provider-model catalogs for every provider) belongs in store actions, not scattered across pages.

### 10.1 React Component Rules

- Prefer function components with hooks. No class components.
- A component should do one job: present UI, orchestrate a small interaction, or compose a page section. If a component is simultaneously fetching, validating, formatting, and rendering a large tree, split it.
- Keep pages route-focused and feature components reusable within that route. If a block exceeds roughly 200-250 lines because it owns multiple distinct panels or flows, split it by UI responsibility.
- Components receive the smallest prop surface that keeps ownership clear. Prefer explicit props over passing a large bag object when only 2-3 fields are used.
- Derived render values belong in render. Use `useMemo` only for measurable recalculation savings, referential stability required by a child API, or expensive derived collections. Do not wrap every array/map/filter by default.
- Use `useCallback` only when a stable function identity is required by a memoized child or subscription API. Do not add it pre-emptively.
- Effects synchronize with external systems (IPC calls, timers, subscriptions, DOM APIs). If an effect only derives state from props/store, it probably should not exist.
- Every effect must have a cleanup when it registers a timer, listener, subscription, or inflight async process that can outlive the component.
- Async event handlers and effects must handle the unhappy path. At minimum: clear loading state, surface the failure, and avoid setting state after unmount or after a newer request superseded the old one.
- Do not hide important business rules in JSX conditionals. If a conditional encodes domain meaning, compute a named boolean or view-model value above the return.

### 10.2 Forms and User Interactions

- Use controlled inputs for forms that persist session, strategy, account, or workspace state. The saved payload must be explicit in React state.
- Keep raw form state close to the form. Validation, normalization, and payload-shaping helpers can be extracted, but the reader should still be able to trace what is submitted.
- Disable destructive or duplicate-submit actions while a request is in flight.
- Validation messaging should be specific and field-local when possible. "Invalid input" is too vague when the real issue is "broker selection must cover every selected instrument class."
- Preserve drafts while a modal is open; reset form state intentionally on close/open boundaries, not opportunistically inside unrelated effects.
- When toggles change the meaning of other fields, either clear the now-invalid fields immediately or visibly disable them. Hidden stale state is forbidden.

### 10.3 Styling and UI System Rules

- The renderer is moving toward shadcn primitives plus Tailwind utility classes. New UI work should start from `src/components/ui/*` and compose upward rather than introducing new bespoke base controls.
- Prefer `className` with tokens/utilities over large inline `style={{ ... }}` objects. Inline style is allowed only for truly dynamic values that cannot be expressed cleanly with existing classes or CSS variables.
- Reuse existing semantic tokens (`--surface*`, `--text*`, `--accent`, etc.). Do not hardcode one-off colors when a token already communicates the intent.
- Keep visual variants inside the owning primitive (`Button`, `Badge`, `Tabs`, etc.) when the pattern is broadly reusable. Do not duplicate the same visual recipe across pages.
- Dialogs, menus, tooltips, tabs, and form controls should use the existing Radix/shadcn accessibility primitives unless there is a documented reason not to.
- Do not introduce a second styling system. No CSS-in-JS, no ad hoc component library, no parallel token vocabulary.
- During migration, touching a legacy inline-styled surface does not require a full rewrite, but new code in that file should move toward the shared primitive + token pattern rather than extending the old bespoke pattern.

### 10.4 React Performance and Data Flow

- Optimize only after identifying the hot path. Default to clear code first.
- Memoize filtered/sorted lists when the calculation is non-trivial or the list is large enough to matter; otherwise prefer direct derivation in render.
- Keep render trees honest: if a child needs only `session.id` and `session.name`, pass those instead of the whole session object.
- Do not fire parallel duplicate loads from sibling components for the same resource. The owning store/page loads once and shares the result.
- Debounce only user-driven noisy actions (search boxes, autosave). Do not debounce normal button-click mutations.
- Any polling, interval, or streaming UI must document its stop condition and cleanup path in code.

---

## 11. Logging and Observability

- `docs/engineering/observability-guide.md` is authoritative for the telemetry
  envelope, trace topology, correlation, metrics, evidence bundle, and failure
  matrix. `docs/engineering/logging-guide.md` is authoritative for log safety.
- `pino` is the only application logger. Construct via `createLogger(scope)`;
  do not create direct Pino instances in feature code.
- Logs, user-visible domain events, traces, and metrics have different purposes.
  Do not duplicate raw AI/provider content into logs because it exists in an audit
  table, and do not use `events` as an unbounded operational trace store.
- Every async/external operation has a stable machine event name, causal/domain
  IDs, start and terminal outcome, duration, deadline, retry attempt, and safe
  error classification as required by the observability contract.
- Never log raw prompts/messages, reasoning, tool arguments/results, provider
  bodies, headers, environment values, credentials, or PII. Metadata, allowlisted
  codes, sizes, versions, and content hashes are allowed.
- A new process, queue, scheduler, provider, broker, cache, or background loop is
  incomplete without liveness/freshness evidence and a failure-injection test.
- Every session lifecycle transition writes both a structured operational record
  and a user-visible `events` row. These records share correlation IDs but may
  have different retention and content.
- No `console.log` in committed application code. Pre-logger fatal fallback may
  use stderr if the structured sink cannot initialize.

---

## 12. Validation and Edge Cases

- Validation runs at three layers: form (renderer), Zod (IPC ingress), and DB (constraints). Each layer catches what the others cannot.
- Form validation is for UX; never trust it on the main side.
- Edit-lock and instrument-conflict checks live in the service layer with a final DB-level guarantee — this is non-negotiable.
- Singleton invariants (`workspace_preferences.id = 1`, at most one focused session) are CHECK constraints in raw SQL when Drizzle cannot express them.

---

## 13. Testing

Per phase:

- Each repo has a unit test for happy path + at least one transactional invariant (e.g. `setFocus` atomicity).
- Each service has a unit test for the primary state transition and the rejection path.
- Each IPC handler has an integration test that asserts validation rejection + service call + error serialization.
- The orchestrator has an end-to-end test that runs a full cycle against the `MockBrokerAdapter` with a stub AI runtime.
- Test framework: `vitest`. Configure once in Phase 0; later phases only add `*.test.ts` files.
- Tests use a real in-memory SQLite (`better-sqlite3` with `:memory:`), not mocks. Same migrations run on test DB.
- Coverage gate: every PR must keep `services/` and `db/repositories/` coverage above 80%. Renderer coverage is not gated.

---

## 14. Refactor and Code-Smell Rules

- A function longer than ~60 lines or with more than 3 levels of nesting is split.
- A switch statement on a status enum that lives in two files is wrong — the logic belongs on the type.
- Comments answer "why," not "what." Self-documenting code is preferred. No multi-paragraph docstrings.
- Dead code is deleted, not commented out. Git history is the archive.
- No "temporary" exceptions. If a phase needs to skip a rule, it adds a deviation note to the phase doc and a follow-up task.
- Boolean flags whose meaning is unclear (`isReady`, `data`, `item`, `temp`) should be renamed until the branch condition reads like English. Naming is part of correctness.
- Prefer guard clauses over deep nesting. Early returns beat pyramid-shaped control flow.
- Parse once at the boundary, then pass typed values inward. Repeated `typeof`, `?.`, and fallback chains throughout the call stack usually mean ownership is wrong.
- Helpers must earn their existence. Do not extract a 4-line function used once unless it clarifies a domain concept or removes repeated logic.
- If a file cannot be understood top-to-bottom without jumping constantly between unrelated concerns, the file is doing too much even if its line count seems acceptable.

---

## 15. Build and Tooling

- Bun is the only supported package manager and script runner for this repo. Use `bun install`, `bun run <script>`, and `bun x <bin>` exclusively. Do not commit `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.
- TypeScript strict mode. `tsc --noEmit` runs on every commit (pre-push hook or CI).
- ESLint with `@typescript-eslint/strict` ruleset. No warnings allowed in CI.
- Path aliases (`@main/*`, `@shared/*`, `@/*`) configured once in Phase 10. Use them; do not write `../../../` chains.
- `package.json` scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `test:watch`. Each phase verifies all five pass before merge.

---

## 16. Configuration & Environment

A single typed config module is the only place that reads `process.env`. Everything else imports the typed config object. This rule is enforced by ESLint.

### 16.1 The config module

File: `electron/main/config/env.ts` (main process). Mirror at `src/config/env.ts` for renderer-build-time vars only.

```typescript
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  EXVA_LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  EXVA_DB_PATH: z.string().optional(),
  EXVA_DEV_BYPASS_KEYCHAIN: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  EXVA_PROMPTS_DIR_OVERRIDE: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = Object.freeze({
  isDev: parsed.data.NODE_ENV === "development",
  isTest: parsed.data.NODE_ENV === "test",
  isProd: parsed.data.NODE_ENV === "production",
  logLevel: parsed.data.EXVA_LOG_LEVEL,
  dbPath: parsed.data.EXVA_DB_PATH,
  devBypassKeychain: parsed.data.EXVA_DEV_BYPASS_KEYCHAIN ?? false,
  promptsDirOverride: parsed.data.EXVA_PROMPTS_DIR_OVERRIDE,
});

export type Env = typeof env;
```

### 16.2 Rules

- **One read site.** `process.env` appears in `env.ts` only. Every other file imports `env`. Lint rule:
  ```json
  "no-restricted-syntax": ["error", {
    "selector": "MemberExpression[object.object.name='process'][object.property.name='env']",
    "message": "Read env via electron/main/config/env.ts, not process.env directly."
  }]
  ```
  The rule is disabled inside `env.ts` only.
- **Fail-fast at boot.** Missing or malformed env values crash the main process at startup with a structured Zod error. Never silently fall back.
- **Frozen object.** `env` is `Object.freeze`'d. No runtime mutation. Tests override by re-importing with a different `process.env`, not by mutating.
- **Naming.** All app-specific vars are prefixed `EXVA_`. Standard names (`NODE_ENV`) keep their canonical form.
- **No secrets in env.** Provider API keys, broker credentials, and any user secret live in the OS keychain. The env file holds only configuration: paths, log levels, dev toggles, feature flags. If you are tempted to add `EXVA_ANTHROPIC_API_KEY`, stop — it goes in the keychain via `SecretsService`.
- **Renderer split.** Renderer never imports the main `env`. If the renderer needs a build-time constant, it goes through Vite's `import.meta.env.VITE_`\* and is re-exported from `src/config/env.ts` with the same Zod-validated pattern.
- **Test env.** `NODE_ENV=test` is set by `vitest`. Tests using a non-default value set `process.env.X` before importing `env.ts`, or call a `loadEnv()` factory that the module exposes for testability.

### 16.3 What the config module replaces

| Before (forbidden)                                     | After                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| `process.env.ANTHROPIC_API_KEY` (anywhere)             | adapter receives secret via constructor; secret loaded from keychain |
| `process.env.NODE_ENV === "development"`               | `env.isDev`                                                          |
| `process.env.LOG_LEVEL ?? "info"`                      | `env.logLevel`                                                       |
| `process.env.DB_PATH ?? defaultDbPath()`               | `env.dbPath ?? defaultDbPath()` (read once in client setup)          |
| Conditional `if (process.env.DEBUG_X)` flags scattered | a typed `env.devToggles.`\* field                                    |

### 16.4 Phase ownership

Add `electron/main/config/env.ts` to **Phase 0 "Files Created"**. Every later phase that introduces a new env var adds a field to the schema in the same PR — no out-of-band env vars allowed.

---

## 17. Security

- Secrets stay in the OS keychain. Never logged, never written to SQLite, never returned over IPC except as a `secret_ref` (the keychain key, not the value).
- The renderer has no path to read a secret. There is no `secrets:get` IPC channel — adapters resolve their own secrets in the main process.
- All JSON payloads from external services (AI responses, broker responses) pass through Zod validation before further processing. Untrusted text never becomes a system prompt or a SQL parameter.
- No `eval`, no `Function()` constructor, no dynamic `require()` of user-provided strings.

---

## 18. Phase-by-Phase Discipline

Each phase document must contain:

1. **Goal** — one paragraph.
2. **Hard Problems** — atomicity, races, lifecycle pitfalls. Empty list is allowed but must be explicit.
3. **Files Created / Modified** — exact paths.
4. **IPC Contracts** — full request/response shapes for new channels.
5. **Sequence Diagrams** — for any flow that crosses two or more layers.
6. **Acceptance Criteria** — concrete, testable, no hand-waving.
7. **Implements: docs/engineering/CODING_GUIDELINES.md** — explicit reference line near the top.

If a phase deviates from this guideline, the deviation is documented inline with reason + scope + rollback plan.

---

## 19. PR Discipline

- One phase per branch. Sub-PRs allowed within a phase but never spanning phases.
- PR description includes: phase number, acceptance-criteria checklist (copied from phase doc), and the `Implements: docs/engineering/CODING_GUIDELINES.md` line.
- Merge gate: typecheck pass + lint pass + tests pass + acceptance criteria checked + at least one self-review pass against this guideline.
