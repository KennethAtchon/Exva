# Project-Wide Simplification Opportunities

> **Date:** 2026-05-20  
> **Status:** Slice 1 implemented  
> **Related:** [Pipeline Simplification & Phase Onboarding](./pipeline-simplification-plan-2026-05-19.md), [Unified Pipeline Flexibility Plan](./unified-pipeline-plan-flexibility.md)

---

## 1. Purpose

The pipeline simplification plan correctly targets the most obvious orchestration extension tax. This audit expands the same question to the rest of Exva: where is the code doing complex, multi-file, manually synchronized work that can be replaced by a smaller declarative table, registry, shared contract, or generated boundary?

This is not a code-quality nit list. It focuses on high-leverage simplifications where future feature work currently pays an avoidable tax.

---

## 2. Current Pipeline Simplification Status

The current worktree is already ahead of the written checklist in `pipeline-simplification-plan-2026-05-19.md`.

| Plan Item                               | Current Code State                                                                                                 | Remaining Work                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Remove engine output switch             | `applyEngineOutput` is gone; `runEngineStage()` calls `builder.applyOutput?.()` in `plan/engine/stage-dispatch.ts` | Add regression tests for missing/incorrect handlers if not already covered |
| Add engine-chain `skipIf`               | `DeclarativeCycleStageConfig` has `skipIf`; `risk_gate` uses `state.decision?.output.action === "skip"`            | None beyond tests                                                          |
| Generic AI cost accumulation            | `sumAiCost()` walks `Object.values(state)` in `plan/cycle/interpreter.ts`                                          | Move to a shared helper only if reused elsewhere                           |
| Deduplicate approval recheck gates      | `approval-recheck.ts` calls `runPostDecisionGates()`                                                               | Order-policy recheck remains duplicated in shape; see O2 below             |
| Remove `getPipelineDefinition()` leaks  | `analysis-plans.ts` reads `REVIEW_PHASE.workers` / `DECISION_PHASE.workers` directly                               | None observed                                                              |
| Remove dead `runPhase` bridge           | `CyclePlanRunContext` exposes only `runPhasePlan`                                                                  | None observed                                                              |
| Fix unified effective config hardcoding | `resolveEffectivePlanStages()` derives cycle stages from `plan.plan.inspect`                                       | Add non-default cycle-plan fixture test                                    |

Two pipeline simplification items still remain valuable:

| ID  | Opportunity                                                                                                                                                               | Why It Still Matters                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| P-1 | Replace `tradePipelineSeedFromContext()` and `applyTradePipelineToContext()` field mirrors in `orchestration/cycle/trade/run-trade-pipeline.ts` with stage/state metadata | New optional AI phases still need explicit context propagation if replay/retry context must carry them                   |
| P-2 | Factor the recheck order-policy task builder in `approval-recheck.ts` into the same policy-input builder used by broker placement                                         | The risk/allocation duplication is gone, but order-policy task construction is still manually shaped in the recheck path |

---

## 3. Highest-Impact Opportunities

| Rank | Area                              | Big Win                                                                      | Current Cost                                                                                                       | Simpler Shape                                                                                            |
| ---- | --------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1    | IPC/API boundary                  | Replace 4 manually synchronized API surfaces with one endpoint registry      | Every endpoint is repeated in `channels.ts`, preload implementation, preload interface, and renderer wrapper       | One typed endpoint catalog drives channel names, preload invoke wrappers, and renderer API               |
| 2    | Renderer DevPanel                 | Split the 1,940-line DevPanel into data hooks + tab components               | Any observability change edits one giant file with local helper/style coupling                                     | Feature folders under `components/devpanel/*` and `hooks/useDeveloper*`                                  |
| 3    | App service composition           | Break `createAppServices()` into repo/service factory groups                 | Adding one repo/service requires edits to imports, interfaces, construction, dependency bags, and return object    | `createRepositories()`, `createRegistries()`, `createSessionServices()`, `createOrchestrationServices()` |
| 4    | Provider/search/broker registries | Replace switch-based adapter construction with adapter definition registries | New provider/broker types require switch edits plus UI labels and credential schema edits                          | Catalog objects own label, credential parser, adapter factory, supported classes, and default metadata   |
| 5    | Strategy persistence              | Save strategy sections through one typed batch endpoint                      | Store issues 4 base saves plus per-phase saves, duplicating dirty tracking and partial failure behavior            | `strategy.saveContext({ sections, aiPhases })` validates and commits as one service operation            |
| 6    | Session create/edit form          | Move form normalization and derived state into shared hook/schema            | UI and backend both derive effective instrument classes, broker coverage, search-everything state, and assignments | `useSessionDraft()` + shared `normalizeSessionDraft()` used by UI and `SessionWriteService`              |
| 7    | Developer IPC                     | Move debug settings/export/query logic out of one IPC registration file      | `ipc/developer.ts` mixes DB queries, path policy, redaction, bundle writing, and handler wiring                    | `DeveloperService` with small IPC adapter                                                                |
| 8    | Replay service                    | Split fixture build/load/replay/validation into focused modules              | `CycleReplayService` owns unrelated parsing, extraction, replay, and scorecard logic                               | `fixture-builder`, `fixture-loader`, `fixture-replayer`, `fixture-validator`                             |
| 9    | Domain DTO duplication            | Collapse duplicate API/domain interfaces across preload and renderer         | `SessionSummary`, `StrategyGetResponse`, event maps, etc. are copied in multiple files                             | Shared DTO module imported by preload and renderer                                                       |
| 10   | Inline style dictionaries         | Move repeated renderer style atoms to reusable components/tokens             | Large pages carry dozens of local style constants and near-duplicate controls                                      | Small design-system components using existing `src/components/ui` + custom tokens                        |

---

## 4. Detailed Opportunities

### O1. Typed IPC Endpoint Registry

**Files observed:**

| File                              | Current Role                                       |
| --------------------------------- | -------------------------------------------------- |
| `electron/shared/ipc/channels.ts` | Channel name catalog                               |
| `electron/preload/exva-api.ts`    | `ExvaApi` TypeScript interface and DTO copies      |
| `electron/preload/index.ts`       | Manual `ipcRenderer.invoke()` wrapper per endpoint |
| `src/lib/exva.ts`                 | Second renderer wrapper with more DTO copies       |
| `electron/main/ipc/*.ts`          | Handler registration per endpoint                  |

**Problem:** Adding or changing one IPC endpoint crosses at least four places before main-handler logic is considered. The safety boundary is good, but the implementation is manually synchronized. The evidence is visible in the duplicated `SessionSummary`, `StrategyGetResponse`, `SessionExecutionProgressResponse`, and `ExvaEventMap` declarations in `electron/preload/exva-api.ts` and `src/lib/exva.ts`.

**Simpler implementation:** Define a shared endpoint catalog:

```ts
export const endpoints = {
  "session:start": endpoint({ input: z.void(), output: sessionStatusSchema }),
  "session:get-execution-progress": endpoint({
    input: sessionIdSchema,
    output: sessionProgressSchema,
  }),
};
```

Then generate or derive:

| Derived Piece     | How                                                                   |
| ----------------- | --------------------------------------------------------------------- |
| Channel strings   | Object keys                                                           |
| Preload wrappers  | Generic `invokeEndpoint(key, payload)` bound through a grouped facade |
| Renderer client   | Re-export preload facade or thin names over endpoint keys             |
| Main registration | `registerEndpoint(key, handler)` validates input/output consistently  |

**Expected payoff:** New endpoint becomes one catalog entry plus one handler, not channel + interface + preload + renderer wrapper + handler.

**Caution:** Keep Electron's explicit allowlist. Do not expose arbitrary channel strings to the renderer.

---

### O2. Shared Order-Policy Input Builder

**Files observed:**

| File                                                                | Current Role                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `orchestration/cycle/trade/approval-recheck.ts`                     | Builds order-policy task manually after recheck |
| `orchestration/cycle/trade/order-placer.ts`                         | Places routed broker order                      |
| `orchestration/policy/order-policy-gate.ts`                         | Policy evaluator                                |
| `ai/pipeline/implementations/inputs/trade-engine-input-builders.ts` | Engine input builders for plan stages           |

**Problem:** The existing pipeline simplification removed duplicated risk/allocation gates from approval recheck, but `approval-recheck.ts` still manually constructs the order-policy task with `existingOrderCheck`, `sessionIsPaused`, `decisionRiskInput`, exit policy, side bias, and broker support. This is a smaller but still meaningful fork from normal order placement.

**Simpler implementation:** Extract `buildOrderPolicyTask(ctx, input)` and use it anywhere `order-policy` is invoked. Inputs should be only the variable parts: `cycleId`, `tradeId`, `brokerAccountId`, `riskOrder`, `decision`, `side`, and `holdingStyle`.

**Expected payoff:** Policy changes become one edit. Recheck keeps its unique capital-reservation behavior without hand-assembling policy internals.

---

### O3. Composition Root Factories

**File observed:** `electron/main/services/app-services.ts`

**Problem:** `createAppServices()` is the application composition root, but it has grown into a 414-line constructor graph. It defines the `AppServices` interface, repository construction, registry construction, AI/runtime dependency bags, session services, analytics services, and return object in one place. Adding one service often means touching imports, `AppServices`, `repos`, dependency bags, and the final return block.

**Simpler implementation:** Keep one composition root, but split construction into stable groups:

```ts
const repos = createRepositories(db);
const infra = createInfraServices(repos);
const broker = createBrokerServices(repos, infra);
const ai = createAiServices(repos, infra, broker);
const session = createSessionServices(repos, infra, broker, ai);
const orchestration = createOrchestrationServices(
  repos,
  infra,
  broker,
  ai,
  session,
);
```

`createAppServices()` still returns the same `AppServices` shape, but each group owns its local wiring.

**Expected payoff:** Feature additions stop creating wide merge conflicts in one file. Dependency shape becomes easier to review because each group has a smaller boundary.

**Caution:** Do not introduce a DI container. Plain factory functions are enough.

---

### O4. Adapter Definition Registries

**Files observed:**

| File                            | Current Pattern                  |
| ------------------------------- | -------------------------------- |
| `ai/provider-registry.ts`       | Switch on `account.providerType` |
| `ai/search/search-registry.ts`  | Switch on `account.providerType` |
| `broker/broker-registry.ts`     | Switch on `account.brokerType`   |
| `src/pages/AccountsPage.tsx`    | Separate provider label switch   |
| `ipc/broker-account-helpers.ts` | Separate broker helper switches  |

**Problem:** Provider/broker types are extensibility seams, but each new type crosses service construction, labels, credentials, supported classes, metadata rules, and tests. The switch statements are small today, but the workflow is the same structural smell the pipeline plan already identified.

**Simpler implementation:** Define typed catalogs:

```ts
export const AI_PROVIDER_DEFS = {
  anthropic: {
    label: "Anthropic",
    build: (secret) => new AnthropicAdapter(secret),
  },
  openrouter: {
    label: "OpenRouter",
    parseMetadata,
    build: (secret, meta) => new OpenRouterAdapter(secret, meta.baseUrl),
  },
};
```

Broker definitions should own `supportedInstrumentClasses`, credential validation, live/paper capability, label, and adapter factory. Search definitions should own whether a secret is required.

**Expected payoff:** Adding a provider/broker becomes one definition object plus adapter implementation, not scattered switches.

---

### O5. Strategy Save Batch Endpoint

**Files observed:**

| File                                                   | Current Role                                     |
| ------------------------------------------------------ | ------------------------------------------------ |
| `src/store/strategyStore.ts`                           | Tracks dirty fields and calls separate save APIs |
| `electron/main/ipc/strategy.ts`                        | Handler set for each strategy subsection         |
| `services/session/session-strategy-context-service.ts` | Reads and validates strategy context             |

**Problem:** `saveAll()` in `strategyStore.ts` separately calls `saveStrategyResearchPosture`, `saveTradeRules`, `saveStrategyRiskConfig`, `saveStrategyTimeframeConfig`, then loops over dirty AI phases. A partial failure can leave persisted strategy sections from different UI states unless every backend operation is independently safe. The renderer also owns more persistence sequencing than it should.

**Simpler implementation:** Add one main-process command:

```ts
strategy.saveContext({
  sessionId,
  researchPosture,
  rules,
  riskConfig,
  timeframe,
  aiPhases,
});
```

The backend validates the full `SessionStrategyContext`, writes related tables inside one transaction where practical, and returns the fresh canonical context.

**Expected payoff:** Renderer store becomes mostly form state. Backend owns consistency. Autosave has one failure mode and one retry target.

---

### O6. Session Draft Normalizer

**Files observed:**

| File                                                        | Current Role                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/components/sessions/CreateEditSessionModal.tsx`        | UI draft state, broker filtering, search-everything behavior, coverage warnings |
| `services/session/write-service.ts`                         | Backend validation and normalization                                            |
| `electron/shared/instruments/session-instrument-classes.ts` | Shared class derivation helpers                                                 |

**Problem:** The session modal and backend already share `resolveEffectiveInstrumentClasses()`, but the broader draft lifecycle is still duplicated: broker mode pruning, selected broker ID normalization, search-everything state, effective classes, coverage warnings, required search provider checks, and override filtering.

**Simpler implementation:** Create `normalizeSessionDraft(input, context)` in shared code and a renderer hook `useSessionDraft()` around it. `SessionWriteService.validate()` should call the same normalizer and only add database-specific checks such as name uniqueness and broker existence.

**Expected payoff:** Search-everything and broker coverage changes stop requiring careful parallel edits in UI and backend validation.

---

### O7. DevPanel Module Split

**File observed:** `src/pages/DevPanel.tsx`

**Problem:** `DevPanel.tsx` is 1,940 lines and contains data fetching, local state, scope navigation, event timeline rendering, inspector tabs, debug capture modal, export drawer, JSON/text viewers, style atoms, and page composition. The file has at least 40 local component/helper definitions. This is a maintainability bottleneck because observability features are likely to keep growing.

**Simpler implementation:** Split by feature boundary, not arbitrary line count:

| New Module                               | Contents                                                     |
| ---------------------------------------- | ------------------------------------------------------------ |
| `hooks/useDeveloperSettings.ts`          | settings, overrides, debug capture mutations                 |
| `hooks/useDeveloperScope.ts`             | active scope, diagnostics, events, agent runs/messages/calls |
| `components/devpanel/ScopeRail.tsx`      | scope selector                                               |
| `components/devpanel/EventTimeline.tsx`  | timeline and filtering UI                                    |
| `components/devpanel/InspectorPanel.tsx` | tab shell                                                    |
| `components/devpanel/tabs/*`             | overview, execution, config, trace, graph, calls, raw        |
| `components/devpanel/primitives.tsx`     | `JsonBlock`, `CopyBtn`, `CollapsibleText`, `StatusChip`      |

**Expected payoff:** New observability work becomes localized. Tests can cover data hooks separately from rendering.

**Caution:** Avoid a visual redesign in the first pass. This is a mechanical split.

---

### O8. Developer Service Extraction

**File observed:** `electron/main/ipc/developer.ts`

**Problem:** Developer IPC currently mixes handler registration with settings persistence, log-level override lifetime, diagnostics queries, debug-bundle assembly, redaction, filesystem writing, path allowlisting, and event pagination. That is too much policy inside the IPC adapter.

**Simpler implementation:** Create `DeveloperService`:

```ts
class DeveloperService {
  getSettings();
  updateSettings(patch);
  setLogLevel(input);
  stopLogOverride(id);
  getScopeDiagnostics(scope);
  exportDebugBundle(input);
  listEvents(input);
}
```

The IPC file becomes a set of `handle(ipcMain, channel, service.method)` calls.

**Expected payoff:** Debug bundle redaction/path policy can be tested without Electron IPC. Future developer tools do not grow a monolithic handler file.

---

### O9. Cycle Replay Service Split

**File observed:** `electron/main/services/replay/cycle-replay-service.ts`

**Problem:** `CycleReplayService` is 668 lines and owns at least four responsibilities: building fixtures from stored messages, loading/saving fixture files, replaying policy/exit/scorecard logic, and validating fixture shape. The existing pipeline plan also called out a latent fixture-loader field mismatch around `phaseOutputs` vs `phases`, which is exactly the kind of bug a split validator would make harder to hide.

**Simpler implementation:** Keep the public `CycleReplayService` facade but delegate:

| Module                      | Responsibility                                           |
| --------------------------- | -------------------------------------------------------- |
| `cycle-fixture-builder.ts`  | DB/message/tool-call extraction                          |
| `cycle-fixture-loader.ts`   | file IO + schema validation                              |
| `cycle-fixture-replayer.ts` | deterministic replay of validation/policy/exit/scorecard |
| `cycle-fixture-schema.ts`   | Zod or explicit schema for fixture version 1             |

**Expected payoff:** Replay fixture format becomes explicit. Parser bugs become schema test failures instead of runtime surprises.

---

### O10. Shared DTO Module for Preload and Renderer

**Files observed:** `electron/preload/exva-api.ts`, `src/lib/exva.ts`, `src/lib/types.ts`, `electron/shared/domain/*`

**Problem:** The preload API and renderer API both declare many of the same DTOs. Type drift is easy because both files are TypeScript-valid even when shapes diverge.

**Simpler implementation:** Move UI-facing IPC DTOs into `electron/shared/ipc/dto.ts` or `electron/shared/api/types.ts`, then import from both preload and renderer. Keep runtime validation in `src/lib/schemas.ts` or move it next to the DTOs if both sides need it.

**Expected payoff:** One type edit updates both API sides. This also makes O1 easier.

---

### O11. Account Page Section Components

**File observed:** `src/pages/AccountsPage.tsx`

**Problem:** `AccountsPage.tsx` is 970 lines and mixes provider CRUD, default model selection, broker routing, connection testing, table/card rendering, and local edit forms. The page already has separate modals for add flows, but the list/edit/default-model/routing sections remain in one component.

**Simpler implementation:** Split into section components with narrow props:

| Component                      | Owns                                  |
| ------------------------------ | ------------------------------------- |
| `AiProvidersSection`           | AI provider list/edit/delete/test     |
| `SearchProvidersSection`       | search provider list/edit/delete/test |
| `BrokerAccountsSection`        | broker list/test/delete/settings      |
| `DefaultModelSection`          | workspace default provider/model      |
| `BrokerRoutingDefaultsSection` | routing draft and save                |

**Expected payoff:** Provider/broker work stops touching a 970-line page. This pairs naturally with O4 provider/broker catalogs.

---

### O12. Renderer Style Atom Consolidation

**Files observed:** `DevPanel.tsx`, `AccountsPage.tsx`, `StrategyConfig.tsx`, `CreateEditSessionModal.tsx`, `GlobalPresetComponents.tsx`

**Problem:** Several large renderer files define local `Field`, `SectionHeader`, `warningStyle`, card styles, status chips, toggle buttons, and monospaced labels. Some of this predates the shadcn/UI layer now present under `src/components/ui`.

**Simpler implementation:** Do not rewrite the UI. Extract recurring atoms that already exist in 3+ files:

| Atom                                 | Target                              |
| ------------------------------------ | ----------------------------------- |
| `Field` / label+hint wrapper         | `components/form/Field.tsx`         |
| `SectionCard` / section header       | `components/layout/SectionCard.tsx` |
| `StatusBadge` / connected/error chip | `components/status/StatusBadge.tsx` |
| `JsonBlock` / `CollapsibleText`      | `components/debug/*`                |

**Expected payoff:** Large pages shrink without changing behavior. Future shadcn adoption has clear migration targets.

---

## 5. Recommended Sequencing

| Phase | Scope                                                                                    | Why First                                                                                           |
| ----- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1     | Finish pipeline cleanup residuals P-1/P-2 and mark the original checklist current        | Keeps the active simplification project coherent and prevents stale-plan confusion                  |
| 2     | Shared DTO module + typed IPC endpoint registry skeleton for one low-risk endpoint group | Removes the largest repeated boundary pattern before adding more UI/API features                    |
| 3     | Split DevPanel mechanically                                                              | Biggest single-file maintainability win; low behavior risk if done as move-only extraction          |
| 4     | Extract composition root factories                                                       | Reduces future service wiring conflicts before more broker/provider/runtime work lands              |
| 5     | Adapter definition registries                                                            | Makes provider/search/broker expansion cheaper after the composition root is clearer                |
| 6     | Strategy batch save + session draft normalizer                                           | Simplifies the most stateful renderer/backend interactions after shared DTO/schema direction is set |
| 7     | Replay service split                                                                     | Valuable, but lower day-to-day feature velocity impact than IPC, DevPanel, and service wiring       |

---

## 6. Success Criteria

| Goal                            | Baseline                                         | Target                                       |
| ------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| Add IPC endpoint                | 4+ manually synchronized files                   | endpoint catalog + handler only              |
| Add provider/search/broker type | switch edits across service/UI/helper files      | one catalog definition + adapter             |
| DevPanel change locality        | edit `src/pages/DevPanel.tsx` for most changes   | edit one hook/tab/component file             |
| Strategy save consistency       | multiple independent renderer-triggered saves    | one backend-owned save transaction/operation |
| Session draft behavior          | UI and backend each normalize parts of the draft | shared normalizer used by both               |
| Replay fixture validation       | implicit manual checks in service                | explicit fixture schema test                 |

---

## 7. Non-Goals

| Non-Goal                                        | Reason                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Introduce a full dependency-injection container | Plain factories solve the composition-root problem with less machinery              |
| Generate all IPC code in one big bang           | Too risky; start with catalog-driven wrappers for one endpoint group                |
| Redesign DevPanel visuals                       | The first win is structural extraction, not UI change                               |
| Replace Zustand or React Query                  | Current state libraries are not the core complexity source                          |
| Remove typed domain structs                     | The issue is duplicated/manual synchronization, not the existence of explicit types |

---

## 8. Open Questions

| ID  | Question                                                                                                                                                                  | Needed Before         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Q1  | Should IPC DTOs live in `electron/shared/ipc` or under a broader `electron/shared/api` namespace?                                                                         | O1/O10 implementation |
| Q2  | Should the renderer wrapper `src/lib/exva.ts` remain as ergonomic aliases over the preload API, or should components call grouped preload methods directly through `api`? | O1 implementation     |
| Q3  | Can strategy context writes be committed transactionally across all involved repositories with the current Drizzle client wrapper?                                        | O5 implementation     |
| Q4  | Should provider/broker definition catalogs own UI form metadata, or only backend adapter construction and labels?                                                         | O4 implementation     |
| Q5  | Is replay fixture format intended as a stable external artifact or an internal debug artifact?                                                                            | O9 schema strictness  |

---

## 9. First Concrete Slice

The safest first slice is small and measurable:

1. [x] Update `pipeline-simplification-plan-2026-05-19.md` checkboxes/status to match current code.
2. [x] Add one test proving `resolveEffectivePlanStages()` works for a non-default cycle plan.
3. [x] Extract shared IPC DTOs from `electron/preload/exva-api.ts` and `src/lib/exva.ts` without changing runtime behavior.
4. [x] Convert one endpoint group, preferably `workspace`, to a typed endpoint catalog pattern.

This delivers immediate cleanup, proves the IPC approach on a low-risk group, and avoids destabilizing orchestration while the pipeline changes are still fresh.

**Verification:** `bun run typecheck`; `bunx vitest run electron/main/services/llm/pipeline/implementations/__tests__/default-trade-cycle.test.ts`
