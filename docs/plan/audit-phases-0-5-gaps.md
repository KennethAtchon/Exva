# Audit: Plan Phases 0–5 vs Current Codebase

**Scope:** [`docs/plan`](.) phases **0–5** only (per [`index.md`](index.md)).  
**Method:** Cross-checked plan acceptance criteria, file lists, and behavioral specs against the repository state.  
**Note:** `npm test` / coverage was not successfully executed in this environment (`vitest` unavailable when `node_modules` is missing); coverage claims below are **plan requirements**, not verified pass/fail.

---

## Summary

Implementation covers the **spine** of multi-session runtimes, DB schema, sessions UI, workspace context, strategy AI configuration, and instrument rename. The largest gaps are **stub or simplified preflight checks** (Phase 0), a **slim `OrchestratorDeps`** vs the plan’s full dependency bundle, **Phase 4 dashboard/trades polish** (pending approvals panel, advanced trade filters, explicit global/session stats API), **events catalog wording coverage**, and **Phase 5 UI** items called out in the plan but not built as separate surfaces (Prompt Assets card, prompt versioning). Several items are **explicitly deferred** to Phases 6–8 in the master plan; those are listed separately so they are not mistaken for omissions.

---

## Phase 0 — Session Runtime Management

| Area | Plan expectation | Current state | Gap |
|------|------------------|---------------|-----|
| **`OrchestratorDeps`** | Full bundle: multiple repos (`strategyRepo`, `selectorSettingsRepo`, `aiRolesRepo`, `approvalsRepo`, `capitalReservationsRepo`, `instrumentCacheRepo`, `workspacePrefsRepo`, …), `BrokerRoutingService`, `CapitalReservationService`, `InstrumentNormalizer`, etc. | `electron/main/services/session/session-types.ts` defines a **reduced** `OrchestratorDeps` (session, trades, agent runs, events, stats, AI, broker, risk, bus, logger). | **Partial:** wiring for multi-provider, routing, reservations, and normalizer not present at orchestrator boundary as specified. |
| **Preflight — provider credentials** | Every AI role’s `providerKey` must resolve to a configured `provider_account` with `isConfigured = true`. | `provider-credentials-check.ts` only checks `deps.ai.hasProviderKey()` (global Anthropic-style key). | **Missing per-role validation** against `session_ai_roles` / provider accounts. |
| **Preflight — broker reachability** | `BrokerRoutingService.preflightSession` — resolve adapter **per instrument class** + `testConnection()` on each assigned broker. | Single `deps.broker.testConnection()` with no per-class routing. | **Simplified**; does not match routing model from plan. |
| **Preflight — search provider** | If any role has web search on, resolve `session.defaultSearchProviderId ?? workspace.defaultSearchProviderId` to a configured search provider. | `search-provider-check.ts` returns `{ ok: true }` unconditionally. | **Stub.** |
| **Preflight — capital pool** | When `shared_global_pool`, enforce sum of reserved + session limit vs `globalCapitalPoolUsd`. | `capital-pool-check.ts` returns `{ ok: true }` unconditionally. | **Stub.** |
| **Preflight — instrument conflict** | Parse shortlist; `tradesRepo.checkInstrumentConflict` per **resolved** `(broker, symbol)`. | Uses hardcoded `brokerAccountId = "default-broker"` and `TODO(phase-08)` for real routing; symbol split is **comma-only** (plan also allows newlines). | **Partial** until broker routing (Phase 8) + delimiter parity. |
| **Preflight failure events** | Message template: `Preflight {check} failed: {reason}`. | Session service emits `preflight.message` as stored in the check result (no structured `{check}` name). | **Minor** catalog / observability mismatch. |
| **Events catalog** | Rows for Session created, Session paused, Session resumed, Session stopped, Capital pool exceeded, Broker order placed/failed, Instrument conflict WARN, Selector run, etc. | Session lifecycle events exist for start/pause/resume/stop; **no** `Session created` event found in main code. | **Incomplete** vs [`phase-00-runtime-management.md`](phase-00-runtime-management.md) table. |
| **Shared global pool at runtime** | Startup + order flow consult reservation layer (details Phases 2 & 8). | Capital reservation **schema/repos may exist**, but preflight and runtime path are not enforcing as above. | **Behavioral gap** until capital checks + order-path wiring land. |
| **Test infra & coverage** | `vitest.config.ts`, in-memory DB helpers, `runtime-manager.test.ts`, **80%** thresholds on `services/` + `db/repositories/`. | Config and at least one test file exist; threshold enforcement **not verified** here. | **Verify locally** with `npm install && npm test -- --coverage`. |
| **Rehydration** | On launch, restore runtimes for `active` / `paused`. | `electron/main/index.ts` calls `rehydrateFromDb()`. | **Met.** |
| **Pause yield points** | Between orchestrator phases with INFO abort event. | Present in `agent-orchestrator.ts` with `runtimeStatus` checks and abort event. | **Met.** |

---

## Phase 1 — Session Ownership Model

| Area | Plan expectation | Current state | Gap |
|------|------------------|---------------|-----|
| **`electron/shared/domain.ts`** | Canonical types including full trade/capital/approval shapes, `TradeStatus` aligned with DB. | Types exist; `TradeStatus` in domain is **narrower** than migration CHECK (e.g. DB allows `cancelled`, `failed`; domain type may omit some). | **Align** renderer/domain unions with `phase-02` DDL to avoid drift. |
| **`AppError` / IPC serialization** | Standard error path. | `electron/shared/errors.ts` present. | **Assumed met** (not exhaustively audited). |
| **Edit-lock matrix** | Table includes future channels (`accounts:routing`, broker remove, provider save, etc.). | Session/strategy locks implemented where IPC exists; **accounts** rows depend on Phase 8 behaviors. | **Future phases** — document as pending, not a Phase 0–5 bug. |
| **Unit tests for `canTransition` / `isSessionEditable`** | Required. | `electron/shared/__tests__/domain.test.ts` exists. | **Met.** |
| **“No runtime behavior”** | Phase 1 pure types. | Codebase has evolved past that; acceptable if later phases own the behavior. | **N/A** historically. |

---

## Phase 2 — Singleton → Session-Scoped Persistence

| Area | Plan expectation | Current state | Gap |
|------|------------------|---------------|-----|
| **Schema & migrations** | Drizzle + raw DDL: focus triggers, CHECKs, indexes. | Triggers and multiple CHECKs present in `migrations.ts` (sampled: focus singleton, trade status). | **Largely met** — spot-check only. |
| **`TradesRepo.checkInstrumentConflict`** | Single SQL join query. | Implemented as specified in `trades-repo.ts`. | **Met.** |
| **Repository set** | Full list in plan (session, workspace prefs, selector, strategies, AI roles, providers, brokers, routing, capital, approvals, templates, broker assignments, …). | Repositories exist per git history / wiring (verify in `db/client.ts` if adding features). | **Assumed met** for phases 0–5 scope. |
| **`SessionRepo` behaviors** | `setFocus` atomic, `setStatus` with `canTransition`, create transaction with defaults. | Implemented in services layer; **not re-audited line-by-line** in this pass. | **Risk:** focus/status edge cases deserve targeted tests. |

---

## Phase 3 — Asset → Instrument Rename

| Area | Plan expectation | Current state | Gap |
|------|------------------|---------------|-----|
| **Grep checklist** | Zero `.asset`, `"asset"`, `AgentType`, hardcoded SPY/QQQ, etc. | Spot checks: no `.asset` / `"asset"` / `AgentType` / SPY|QQQ in `src/` + `electron/` TypeScript. | **Appears met** — rerun full checklist before release. |
| **`getInstruments` / scope parsing** | Parse `instrumentScope` with newline and comma separators. | Orchestrator / conflict code paths may use **comma-only** splits in places. | **Minor:** align all parsers to `/[\n,]+/` as in plan. |

---

## Phase 4 — Sessions Page + Workspace Context

| Area | Plan expectation | Current state | Gap |
|------|------------------|---------------|-----|
| **Dashboard stats IPC** | Session vs global modes with explicit request shapes. | `electron/main/ipc/dashboard.ts` has **TODO(phase-04)** and derives `sessionId` only from focused session; global mode aggregates trades without session id in `stats-repo` but portfolio/uptime semantics may still be **session-centric**. | **Partial:** comment acknowledges incomplete global/session aggregate design. |
| **Pending approvals panel** | Dashboard: `approval:list` with `pending`, new section at bottom. | No `approval:list` IPC; Dashboard has **no** approvals section. | **Missing** — belongs with Phase 6 persistence, but Phase 4 doc lists it as acceptance criteria. |
| **`registerApprovalHandlers`** | Plan shows registration in `register.ts`. | No approval IPC registration (Phase 6). | **Deferred** to Phase 6. |
| **Trades page filters** | `sessionId`, `brokerAccountId`, `instrumentClass`, `executionMode`, `symbolSearch`. | `TradesPage.tsx` has open/all/closed + global Session column; **no** advanced filter row. | **Missing** filters. |
| **Trades list data** | Mode-aware queries. | `trades:list-active` uses focused session id or all trades when unfocused (`ipc/trades.ts`). | **Mostly met** for open list; closed/history behavior not deeply audited. |
| **Global mode Session column** | Show session for each trade. | Shows `sessionId` **raw id**, not session name. | **UX gap** vs readable “Session” column. |
| **Session detail drawer** | Includes **Activity Timeline (recent events)**. | `SessionDetailDrawer.tsx` focuses on template payload / metrics; **no** events timeline section. | **Missing** subsection. |
| **Preload events API** | Documented `EventChannel` set and `subscribe` returning unsubscribe. | `events.subscribe` on named events in `exva-api.ts` / preload. | **Met** in spirit; channel names differ from the literal list in the plan doc (evolved catalog). |
| **Zustand: events in stores** | Subscriptions in stores, not components. | Pattern varies (`useExvaEvent` in `App.tsx` / `Dashboard`); **not** strictly store-only. | **Soft gap** vs guideline in plan. |
| **Workspace / session / template IPC** | As specified. | Handlers exist (`session.ts`, `workspace.ts`, `templates.ts`). | **Met** for core flows. |
| **`template:use` + `clearedFields`** | Post-process stale provider/broker refs. | `SessionTemplateService.apply` returns `clearedFields`. | **Met.** |

---

## Phase 5 — Strategy Page: Per-Role AI Configuration

| Area | Plan expectation | Current state | Gap |
|------|------------------|---------------|-----|
| **IPC** | `strategy:get`, `strategy:save`, `strategy:getProviderModels`, `strategy:resetPrompt`. | Present in `channels` + preload API. | **Met.** |
| **`PromptAssetLoader`** | Dev vs packaged path resolution + `forge` `extraResource`. | Implemented; `forge.config.ts` includes `electron/prompts`. | **Met.** |
| **`provider-model-catalog.ts`** | Static maps; OpenCode empty until Phase 7. | OpenCode `[]` as specified. | **Met.** |
| **UI: AI Role Configuration + Cost summary** | Tabs, forms, Cost/Latency card. | `AiRoleConfigCard`, `CostSummaryCard`, `PromptEditor` exist. | **Met.** |
| **UI: Prompt Assets Card** | Separate card: path, version from file header, reset action. | Not a dedicated card; path/version not surfaced as specified. | **Missing** (partially covered inside role editor / reset flows). |
| **Version label** | “Read from file header or Phase 7 versioning”. | No version UI. | **Deferred** / **missing** until Phase 7. |
| **Instrument Selector tab** | Disabled when `manual_shortlist` + tooltip. | Implemented in `AiRoleConfigCard`. | **Met.** |
| **Three visible states (P2.12)** | `no_session` / `editable` / `locked` derived; single layout selection. | `strategyStore` exposes `pageState`; global vs locked handled. | **Largely met.** |
| **Per-tab dirty + merge on save** | `dirtyRoles: Set<AgentRole>`. | Store uses **field-level** `dirtyFields` + `saveAll`; not identical to plan’s `Set<AgentRole>` but satisfies intent. | **Minor** divergence. |
| **Bundled prompts** | Five Markdown files under `electron/prompts/`. | Files exist. | **Met.** |

---

## Intentionally Out of Scope for Phases 0–5 (Master Plan)

These are **scheduled later** in [`index.md`](index.md); do not treat as bugs unless you intended to front-load them:

- **Phase 6:** Persisted approval queue, `approval:*` IPC, orchestrator wiring, restart-safe approval path.
- **Phase 7:** Multi-provider AI abstraction, dynamic OpenCode models, rich prompt assets and versioning.
- **Phase 8:** Broker routing service, `BrokerRoutingService.preflightSession`, real broker account IDs in instrument conflict and preflight, capital reservation on orders, shared pool enforcement end-to-end.
- **Phase 9+:** Instrument selector role in execution, `instrument_cache` FKs, etc.
- **Phase 10:** Services folder refactor.

---

## Recommended Next Actions (Priority)

1. **Implement real `capital-pool-check` and `search-provider-check`** (and tighten **provider-credentials-check**) once `OrchestratorDeps` includes workspace prefs, provider accounts, session AI roles, and capital reservation repo — or extend deps minimally to read those tables in preflight.
2. **Resolve `instrument-conflict-check` placeholder broker** when broker assignments + routing (Phase 8) are available; align shortlist parsing with newline/comma.
3. **Dashboard:** Replace `TODO(phase-04)` with explicit global vs session stats contract; add **pending approvals** UI when Phase 6 lands (or stub read-only if DB already has rows).
4. **Session detail drawer:** Add **recent events** timeline (reuse `events:list` with `sessionId` filter).
5. **Strategy page:** Add **Prompt Assets** summary card (path + optional version) if product wants parity with the plan before Phase 7.
6. **Run tests with coverage** after `npm install` and fix any **sub-80%** gaps or adjust thresholds if the team agrees.
7. **Align `TradeStatus` (and related unions)** in `electron/shared/domain.ts` / `src/lib/types.ts` with SQLite CHECK constraints.

---

*Generated as a gap analysis against the phase documents in this directory; it does not replace code review or QA.*
