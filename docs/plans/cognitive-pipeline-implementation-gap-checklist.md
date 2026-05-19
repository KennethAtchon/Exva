# Cognitive Pipeline — Implementation Gap Checklist

> **Generated:** 2026-05-18 (audited against source)  
> **Last updated:** 2026-05-18 (marked complete items from implementation sessions)  
> **Sources:** [`docs/design/cognitive-pipeline-rearchitecture-spec.md`](../design/cognitive-pipeline-rearchitecture-spec.md), `docs/plans/cognitive-runtime-phase-{1..8}-*.md`, [`docs/TODO.md`](../TODO.md), and live code under `electron/main/services/ai/`.  
> **Legend:** `[ ]` not done · `[~]` partial / diverges from spec · `[x]` verified in code  
> **Note:** Several phase plans say **Complete** while this checklist records **remaining gaps** found in the repo (plans ≠ full spec acceptance).

---

## Verified baseline (grep / file audit — 2026-05-18)

| Claim | Verified |
|-------|----------|
| `AiRuntime` only exposes `runPhase()` | `electron/main/services/ai/ai-runtime/runtime.ts` |
| No `runAnalyst` / `runInstrumentSelector` / `runReviewer` / `runDecisionMaker` | No matches under `electron/main/` |
| No `session_ai_roles` table | No matches in `electron/main/db/` |
| No `electron/prompts/`, `prompt-pack-builder`, `prompt-instructions.json` | Glob: 0 files |
| No `parseInstrumentSelection` / `decision-parse` | No matches under `electron/` |
| Five phase definitions registered | `pipeline-runtime/definitions/*.phase.ts` |
| Decision: `signal-classifier` + `entry-timer` + `aggregateTradeSignal` | `decision.phase.ts`, `trade-signal-aggregator.ts` |
| `computeExecutionProfile` + `priceLevelsFromProfile` in orchestrator | `agent-orchestrator.ts` → `executionFieldsForSignal` |
| `trades.execution_strategy` column + migration | `schema.ts`, `drizzle/0001_trades_execution_strategy.sql` |
| `validateSelectorOutput` removed from orchestrator | No matches under `electron/main/services/orchestration/` |
| Preset guidance wired | `prompt-envelope-builder.ts` → `preset-behavior-guidance.ts` |
| Preset guidance tests | `__tests__/preset-behavior-guidance.test.ts` |
| Worker prompt lint tests | `__tests__/pipeline-worker-prompts.test.ts` (≤1600 chars + denylist) |
| Phase-level dead prompts removed | No `selector.md` / `technical.md` / `fundamental.md` / `review.md` / `decision.md` under `prompts/` |
| `McpSearchAdapter` registered | `search/adapters/mcp-adapter.ts`, `search-registry.ts` |
| Pipeline engines registered | `engines/register-pipeline-engines.ts` |
| `event_contract_scan` worker swap | `pipeline-discovery-config.ts` + phase runners |
| Compact worker strategy context | `buildWorkerStrategyPromptContext` + `envelopeToMessages` budgets |
| Zod fail → retry → zero dimension | `worker-structured-output.ts`, `worker-executor.ts` |
| Strategy AI phase IPC + UI | `channels.strategy.saveAiPhase*`, `AiPhasesSection.tsx`, `strategyStore` |
| Downstream `rawSummary` stripped | `signal-prompt-payload.ts` in review/decision phases |

---

## Summary — shipped and working

- [x] Phase-first pipeline runtime for selector → technical → fundamental → review → decision  
- [x] Typed `*Signal` schemas (`electron/shared/ai/pipeline-signals.ts`)  
- [x] Selector: discovery → verification → score → `RiskFilter` → `buildInstrumentSelection`, dependency-graph trace  
- [x] Technical / fundamental / review / decision workers + aggregators (unit tests on scoring, technical, fundamental, review, trade-signal)  
- [x] `PhaseTraceV1` + DevPanel phase matrix (`strategy.get` → `aiPhases`)  
- [x] `session_ai_phases` / `session_ai_phase_workers` + `PhaseConfigResolver` + session seeding  
- [x] Search: DuckDuckGo, Brave, Tavily, **MCP** (opt-in via provider `metadata.baseUrl`) via `SearchRegistry`  
- [x] `ExecutionProfileEngine` (Kelly/confidence sizing, SL/TP %, limit vs market) + orchestrator trade fields  
- [x] Decision: dual workers + `aggregateTradeSignal` (review skip + entry timing)  
- [x] `event_contract_scan` alternate worker sets (selector / technical / fundamental)  
- [x] Worker prompt lint (char cap + banned phrases)  
- [x] Strategy page **AI Phases** tab + save IPC for per-phase provider/model/prompt  

---

## Plans vs code (status honesty)

| Plan doc | Header status | Gaps still in code (this checklist) |
|----------|---------------|-------------------------------------|
| `cognitive-runtime-phase-1-redesign-plan.md` | **Draft** | `WorkerDefinition.engines` wiring, phase spend caps, replay, docs |
| `cognitive-runtime-phase-2-selector-cutover-plan.md` | Complete | **§2D replay suite**; synthetic `submit_candidates` trace; spec `[stage:…]` logs |
| `cognitive-runtime-phase-3-selector-cleanup-plan.md` | Complete | `aiPickerEnabled` naming (OQ open); `selector-runtime-control` analytics-only retention |
| `cognitive-runtime-phase-4..6` | Complete | Replay fixtures; engine-bound context beyond compact prompts |
| `cognitive-runtime-phase-7-decision-execution-plan.md` | Complete | Full per-strategy profile table; ATR/breakout level logic; replay sizing expectations |
| `cognitive-runtime-phase-8-legacy-cleanup-plan.md` | Complete | Remove legacy UI role aliases; docs/spec banner |

---

## Phase 0 — Evals & replay

Spec §17 / §19; **no `cognitive-runtime-phase-0` plan file**.

- [ ] Replay reproduces `sawSubmitCandidates: false` on legacy path from `docs/hello.json` (spec gate)  
- [ ] Five sandbox fixtures with deterministic expectations for **all** stages  
- [ ] Assertion helpers: `assertSubmissionFires`, `assertTechnicalSignalHasField`, `assertTradeSignalAction`, `assertCostBelowUsd`  
- [ ] Side-by-side old-vs-new pipeline diff (today: `CycleReplayService` + IPC — replays validation/policy/exit, **not** full typed pipeline parity)  
- [ ] Wire replay scorecards to pipeline outputs (see archived `phase-specs/phase-7-replay-scorecards.md`)

**Verified:** `electron/main/ipc/replay.ts`, `orchestration/cycle-replay-service.ts` exist; no pipeline assertion module.

---

## Phase 1 — Infrastructure

### Engines (`electron/main/services/ai/engines/`)

**Registered in `register-default-engines.ts`:** `risk-summary`, `candidate-validator`, `order-policy`, `broker-allocation`, `exit-policy`, `risk-gate`.

**Also registered via `register-pipeline-engines.ts`:** `selector-candidate-merger`, `selector-scoring-engine`, `selector-submission-builder`, `technical-aggregator`, `fundamental-aggregator`, `review-aggregator`, `trade-signal-aggregator`, `execution-profile-engine`.

**Modules used in-phase but not via `EngineRegistry` at runtime:** `selector-risk-filter` (instantiated in `selector.phase.ts`).

- [x] Register pipeline aggregators / execution-profile in `EngineRegistry`  
- [ ] Use `WorkerDefinition.engines` in phase definitions (field exists; **no worker sets `engines:`** in `definitions/`)  
- [ ] Shared `electron/shared/ai/pipeline-config.ts` (`PipelineConfig`, `ScoringWeights`, `RiskRuleSet`) — types scattered today  
- [ ] `phaseSpendCapUsd` / `totalSpendCapUsd` enforcement (only per-worker `spendLimitUsd` in `worker-executor.ts` → `runAgent`)  
- [ ] Mid-phase abort when `maxAiSpendUsd` exceeded (session-level `maxDataSpendUsd` on search tools exists; not pipeline-runner aggregate cap)

### MCP & search (`docs/TODO.md` + spec §16.12)

- [x] `McpSearchAdapter` — `search/adapters/mcp-adapter.ts` (HTTP JSON-RPC `tools/call`; opt-in)  
- [ ] MCP fallback in worker tool config  
- [ ] Search “plug and play” like engines (unify `SearchRegistry` with engine bindings / phase tool factory)  
- [ ] Do not duplicate tool usage instructions in prompts (`docs/TODO.md` — tools should come from schema descriptions only); audit worker markdown for tool-order prose  

### Prompt lint (spec goals #1, §19 Phase 2)

- [x] Vitest: each `pipeline-runtime/prompts/**/*.md` ≤ 1,600 chars (`pipeline-worker-prompts.test.ts`)  
- [x] Vitest: banned phrase denylist (§11) — same test file  
- [x] Enforce `RUNTIME_DEFAULTS.prompt.maxSystemChars` / `maxUserPayloadChars` in `envelopeToMessages`  
- [~] Token budget ≤ 400 per worker **including** injected context — compact `buildWorkerStrategyPromptContext` + truncation; **not** measured to 400 tokens in CI  

### Prompt files

- [x] Delete unused: `prompts/selector.md`, `technical.md`, `fundamental.md`, `review.md`, `decision.md`  
- [x] Add `decision-workers/signal-classifier.md` + `decision-workers/entry-timer.md`  
- [x] Event-contract worker prompts under `selector-workers/event-*`, `technical-workers/event-*`, `fundamental-workers/event-*`  

### Docs

- [ ] `cognitive-runtime-phase-1-redesign-plan.md`: Draft → accurate status  
- [ ] `docs/engineering/ai-model-configuration-guide.md`: trim legacy body (`docs/TODO.md`)  

### Refactor (`docs/TODO.md`)

- [ ] Move `electron/main/services/ai/engines/` under `ai/` package layout (optional; no code move yet)

---

## Phase 2 — Selector

- [x] `SELECTOR_PHASE.run` — discovery → verification → score → `RiskFilter` → `buildInstrumentSelection` (`selector.phase.ts`)  
- [ ] **Phase 2D:** replay suite on all fixtures (`cognitive-runtime-phase-2-selector-cutover-plan.md` §7 — still **Pending**)  
- [ ] Proof worker: `unusual-options-flow` (config + prompt + test only)  
- [ ] Synthetic `submit_candidates` in `tool_calls_json` for legacy UI (spec §16.14)  
- [ ] Spec log lines `[stage:selector/discovery]…` (pipeline uses phase role in retry metadata; orchestrator prose not fully migrated)  

### Orchestrator selector prose

- [x] **`buildSelectionInstructions`** — no longer references `submit_candidates`; pipeline-oriented wording  
- [x] **Delete dead code:** `validateSelectorOutput` + helper tree removed from orchestrator  
- [ ] `run-agent-execute.ts` still logs `instrument_selector` + `analyzeSelectorSteps` when `role === "instrument_selector"` (legacy analytics path)  

### Selector validation duplication (Phase 2 open Q2)

- [x] In-pipeline: `RiskFilter` → `CandidateValidationService` with quote traces (`selector-risk-filter.ts`)  
- [x] Orphaned orchestrator validation removed (see above)  
- [~] Align Phase 2 success criterion “live path does not depend on `selector-runtime-control.ts`” — **still imported** for loop analytics in `run-agent-execute.ts`, not for pipeline selector execution  

---

## Phase 3 — Selector cleanup

- [x] `selector-runtime-control.ts` trimmed (step heuristics removed per Phase 3 plan)  
- [x] `worker-executor` selector `parseInstrumentSelection` branch removed (per Phase 3 plan)  
- [~] `selector-runtime-control.ts` retained for `analyzeSelectorSteps` / loop detection  
- [ ] Open: rename `aiPickerEnabled` vs “phase selector enabled” (`cognitive-runtime-phase-3-selector-cleanup-plan.md` OQ #1)  

---

## Phase 4 — Technical

- [x] Workers: `chart-pattern`, `momentum-indicator`, `volume-profile` + `aggregateTechnicalSignal`  
- [x] `event_contract_scan` → alternate worker set (`pipeline-discovery-config.ts` → `implied-probability`, `price-drift`, `event-liquidity`)  
- [~] `buildAnalystContext` passes **prose** `selectorResearchBrief` into technical/fundamental `context` field (`agent-orchestrator.ts`) — not a typed prior-phase object  
- [~] Engine-bound timeframe/rules context — compact worker prompt only; not `EngineRegistry` bindings at runtime  
- [ ] Replay fixtures for `TechnicalSignal`  

---

## Phase 5 — Fundamental

- [x] Three workers + `aggregateFundamentalSignal` + `catalystScore` derivation tests  
- [x] `event_contract_scan` fundamental workers (`resolution-context`, `event-catalyst`, `event-sentiment`)  
- [ ] Research posture / search defaults via engines, not prompt-only  
- [ ] Replay fixtures  

---

## Phase 6 — Review

- [x] `conflict-detector`, `risk-assessor`, `aggregateReviewSignal`  
- [x] **Recommendation thresholds** aligned with spec §16.8 (`review-aggregator.ts`: skip if conflict > 0.7 **or** high risk; reduce_size if conflict > 0.4 **or** medium risk)  
- [x] Compact downstream JSON: strip `rawSummary` via `signalForWorkerPrompt` in `review.phase.ts` / `decision.phase.ts`  
- [x] Enforce review `skip` in code — `aggregateTradeSignal` returns `action: "skip"` when `review.recommendation === "skip"`  
- [ ] Optional: `risk-assessor` + `get_quote` (spec OQ #11)  

---

## Phase 7 — Decision & execution

### Decision

- [x] Workers: `signal-classifier` + `entry-timer`; prompts under `decision-workers/`  
- [x] `TradeSignalAggregator` — `aggregateTradeSignal` in `trade-signal-aggregator.ts`  
- [x] `signal.executionStrategy` consumed — orchestrator `executionFieldsForSignal` / trade insert  
- [x] `entry_price` on trade from signal when `computeExecutionProfile` returns `limitPrice`  

### ExecutionProfileEngine

- [~] `ExecutionProfile` — sizing (Kelly × confidence × strategy factor), SL/TP %, limit vs market, `priceLevelsFromProfile`; **not** full spec §16.9 strategy table (ATR multiples, breakout levels per strategy)  
- [~] `STRATEGY_PROFILES` for all `executionStrategy` enum values — partial (`VALID_STRATEGIES`, `STRATEGY_SIZE_FACTOR` only)  
- [x] Kelly / confidence sizing from session risk config  
- [~] `compute()` throws on `action: "skip"` — engine throws; orchestrator bypasses with `{ positionSizeUsd: 0 }` for skip trades  
- [x] DB: `trades.execution_strategy` column + populate on insert  
- [x] Set `stop_loss_price` / `take_profit_price` from engine when `entry_price` is set  
- [ ] Replay: per-strategy sizing expectations  

### Schema

- [ ] `tradeDecisionSchema` in `src/lib/schemas.ts` still has legacy sizing fields — remove or deprecate  
- [ ] Update `docs/architecture/ai-runtime-and-harness.md`, `background-config-and-guards.md` references  

### Phase 7 plan honesty

- [~] Reconcile `cognitive-runtime-phase-7-decision-execution-plan.md` “Complete” — core path shipped; full strategy-specific execution table still open  

---

## Phase 8 — Legacy cleanup (residual)

- [~] UI: phase-first labels exist in `AGENT_LABEL` / Dashboard; legacy aliases (`analyst_technical`, `instrument_selector`) **kept** for backward compat  
- [~] DevPanel `normalizeRole()` maps legacy agent types → phase names (intentional)  
- [ ] Extract loop-detection out of `selector-runtime-control` naming  
- [ ] Spec banner “Complete” vs this checklist — add “Known gaps” to spec or link here  

---

## Spec goals §3 (code-verified)

| # | Goal | Status | Evidence |
|---|------|--------|----------|
| 1 | Prompts ≤400 tokens, no workflow prose | [~] | Lint + denylist; compact context; 400-token budget not CI-gated |
| 2 | Typed inter-phase contracts | [x] | `pipeline-signals.ts`, orchestrator `runPhase` |
| 3 | Selector submission structural | [x] | `selector-submission-builder.ts` |
| 4 | AI never sizes / SL / TP | [~] | Engine computes; SL/TP prices set when entry known |
| 5 | Config-driven workers | [~] | `pipeline-discovery-config.ts` for discovery mode; adding worker still needs `*.phase.ts` |
| 6 | Dependency parallel execution | [~] | `worker-graph-scheduler.ts`; selector custom `run` |
| 7 | Deterministic scoring | [x] | `selector-scoring-engine.test.ts` |
| 8 | MCP search | [x] | `mcp-adapter.ts`, `SearchProviderType` includes `mcp` |
| 9 | Sandbox without worker branches | [~] | `resolve-mock-tool-context.ts` → `toolContext`; no `isMockSession` in workers |
| 10 | Orchestrator API compat | [x] | `resolveInstruments`, trade creation |
| 11 | Phase-first UX | [~] | DevPanel matrix + Strategy **AI Phases** tab; worker-level overrides UI minimal |
| 12 | Observability | [~] | `PhaseTraceV1` yes; spec `[stage:…]` logs mostly no |

---

## UX & configuration

- [x] Strategy UI: Phase Profiles — **AI Phases** tab in `StrategyConfig.tsx` (`AiPhasesSection.tsx`)  
- [x] IPC: `strategy:save-ai-phase`, `strategy:save-ai-phase-worker` + `SessionStrategyContextService`  
- [x] DevPanel: `PhaseRuntimeMatrixCard` read-only  
- [ ] Scoring weights user-editable (v1 hardcoded `DEFAULT_SCORING_WEIGHTS` in `selector.phase.ts`)  

---

## Worker runtime §11

- [x] Zod fail → retry once → zero dimension (`worker-structured-output.ts`, `worker-executor.ts`)  
- [x] Trim worker context (`buildWorkerStrategyPromptContext` + envelope budgets)  
- [ ] `onDependencyFailure` on worker defs (type only; not enforced in scheduler)  
- [ ] Pipeline spend abort log message (spec §13)  

---

## Discovery mode §16.17

| Mode | Selector | Technical | Fundamental |
|------|----------|-----------|-------------|
| `standard` (non-event) | [x] | [x] | [x] |
| `event_contract_scan` | [x] | [x] | [x] |

Implemented in `pipeline-discovery-config.ts`; phases read `strategyContext.researchPosture.discoveryMode` at runtime.

---

## `docs/TODO.md` — action items mapped

### Research & prompts (lines 1–16)

- [~] Improve web research quality → `McpSearchAdapter` shipped; MCP fallback + tool-schema-only descriptions still open  
- [ ] Reasoning/sorting layer for consolidated worker outputs (future N→10→1 pattern)  
- [ ] Read/process: review docs (product input, not code)  
- [ ] Refactor `docs/engineering/ai-model-configuration-guide.md` entirely  

### Architecture vision (lines 18–24)

- [x] Orchestrator retained  
- [~] Config-based subagents — phases + discovery config yes; new worker still requires code change  
- [ ] N→10→1 consolidator tiers (explicitly out of spec v1 — track as future)  

### Execution / order management (lines 29–44)

- [~] **Order management strategy system** per instrument class — basic `computeExecutionProfile` only  
- [~] Auto SL/TP from code for each `executionStrategy` — % from session risk when entry price known; not per-strategy ATR table  
- [ ] Optional **AI-adjustable SL/TP** while trade open → `dynamicRiskAdjustment` + `risk_monitor` worker (spec §16.10)  
- [~] AI finds entries; system executes sizing/risk — sizing/SL/TP wired; not full spec execution table  

### Concrete cleanup (lines 50–52)

- [x] Delete `electron/prompts/`  
- [x] Remove `prompt-pack-builder`  
- [x] Orchestrator selector dead validation removed; `buildSelectionInstructions` pipeline-oriented  
- [ ] Delegate more of `run-agent-execute` / runtime to pipeline timeline where applicable  
- [ ] Search plugin plug-and-play like engines  
- [ ] Move `engines/` folder under `ai/`  

### Presets (lines 58–59)

- [x] `preset-behavior-guidance.ts` + envelope wiring  
- [x] Tests: `preset-behavior-guidance.test.ts` (built-in preset IDs)  
- [ ] Per-worker phase guidance (e.g. web-scout) distinguished from global strategy block if needed  

---

## Adjacent plans (not cognitive phases, but `docs/plans/`)

- [ ] **`elasticsearch-research-memory-integration-plan.md`** (Draft)  
- [ ] **`preset-db-seed-migration-plan.md`**  
- [ ] Archived plans under `docs/plans/archieve/` — historical only  

---

## Metrics & CI (§14, §19)

- [ ] CI grep: no `technicalAnalysis` / `fundamentalAnalysis` strings between phases  
- [ ] CI: `tradeDecisionSchema` sizing fields unused or removed  
- [ ] CI: prompt length + denylist tests in pipeline (tests exist; **not wired to CI** yet)  
- [ ] Measured: terminal submission rate, AI-authored sizing rate, sandbox cycle cost ≤ $0.50  

---

## Suggested priority (remaining)

1. **Phase 0 / 2 replay** — fixtures, assertion helpers, pipeline parity scorecards  
2. **Phase spend caps** + pipeline-runner `maxAiSpendUsd` abort  
3. **`WorkerDefinition.engines`** wiring or remove unused field  
4. **Synthetic `submit_candidates`** trace entry for legacy UI  
5. **Full per-strategy execution table** (ATR, breakout levels) in `ExecutionProfileEngine`  
6. **MCP fallback** in worker tool config + search/engine unification  
7. **Legacy UI cleanup** — drop duplicate `analyst_*` labels when safe  
8. **Docs** — `ai-model-configuration-guide.md`, architecture docs, spec “Known gaps” link  
9. **CI** — wire existing vitest prompt/denylist tests  

---

## Code reference map

| Area | Path |
|------|------|
| Runtime entry | `electron/main/services/ai/ai-runtime/runtime.ts` |
| Phase defs | `electron/main/services/ai/pipeline-runtime/definitions/` |
| Discovery mode config | `electron/main/services/ai/pipeline-runtime/pipeline-discovery-config.ts` |
| Worker exec | `electron/main/services/ai/pipeline-runtime/execution/worker-executor.ts` |
| Structured output retry | `electron/main/services/ai/pipeline-runtime/execution/worker-structured-output.ts` |
| Prompt envelope | `electron/main/services/ai/pipeline-runtime/prompting/prompt-envelope-builder.ts` |
| Signals | `electron/shared/ai/pipeline-signals.ts` |
| Compact signal JSON | `electron/shared/ai/signal-prompt-payload.ts` |
| Engines | `electron/main/services/ai/engines/` |
| Orchestrator | `electron/main/services/orchestration/agent-orchestrator.ts` |
| Phase DB | `electron/main/db/repositories/sessions/session-ai-phases-repo.ts` |
| Strategy AI UI | `src/components/strategy/AiPhasesSection.tsx` |
| Replay IPC | `electron/main/ipc/replay.ts` |
| Design spec | `docs/design/cognitive-pipeline-rearchitecture-spec.md` |
| Product TODO | `docs/TODO.md` |
