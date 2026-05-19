# Cognitive Pipeline — Implementation Gap Checklist

> **Generated:** 2026-05-18 (audited against source)  
> **Sources:** [`docs/design/cognitive-pipeline-rearchitecture-spec.md`](../design/cognitive-pipeline-rearchitecture-spec.md), `docs/plans/cognitive-runtime-phase-{1..8}-*.md`, [`docs/TODO.md`](../TODO.md), and live code under `electron/main/services/ai/`.  
> **Legend:** `[ ]` not done · `[~]` partial / diverges from spec · `[x]` verified in code  
> **Note:** Several phase plans say **Complete** while this checklist records **remaining gaps** found in the repo (plans ≠ full spec acceptance).

---

## Verified baseline (grep / file audit)

| Claim | Verified |
|-------|----------|
| `AiRuntime` only exposes `runPhase()` | `electron/main/services/ai/ai-runtime/runtime.ts` (67 lines) |
| No `runAnalyst` / `runInstrumentSelector` / `runReviewer` / `runDecisionMaker` | No matches under `electron/main/` |
| No `session_ai_roles` table | No matches in `electron/main/db/` |
| No `electron/prompts/`, `prompt-pack-builder`, `prompt-instructions.json` | Glob: 0 files |
| No `parseInstrumentSelection` / `decision-parse` | No matches under `electron/` |
| Five phase definitions registered | `pipeline-runtime/definitions/*.phase.ts` |
| `tradeSignalSchema` used by decision phase | `decision.phase.ts` → `tradeSignalSchema` |
| `computeExecutionProfile` used for sizing | `agent-orchestrator.ts` ~1223, 1269 |
| `executionStrategy` not read by orchestrator | No matches in `agent-orchestrator.ts` |
| No `execution_strategy` on `trades` | `electron/main/db/schema.ts` — column absent |
| `validateSelectorOutput` never called | Only definition at `agent-orchestrator.ts:1004` |
| Preset guidance wired | `prompt-envelope-builder.ts` → `preset-behavior-guidance.ts` |
| No preset-guidance tests | No `preset-behavior*.test.ts` |
| Phase-level dead prompts (unused paths) | Nothing loads `selector.md` / `technical.md` / `fundamental.md` / `review.md` |
| `decision.md` loaded | `decision.phase.ts` `promptAssetPath: "decision"` |

---

## Summary — shipped and working

- [x] Phase-first pipeline runtime for selector → technical → fundamental → review → decision  
- [x] Typed `*Signal` schemas (`electron/shared/ai/pipeline-signals.ts`)  
- [x] Selector: 6 workers, merge/score/`RiskFilter`/`buildInstrumentSelection`, dependency-graph trace  
- [x] Technical / fundamental / review workers + aggregators (unit tests on scoring, technical, fundamental, review)  
- [x] `PhaseTraceV1` + DevPanel phase matrix (`strategy.get` → `aiPhases`)  
- [x] `session_ai_phases` / `session_ai_phase_workers` + `PhaseConfigResolver` + session seeding in `write-service` tests  
- [x] Search: DuckDuckGo, Brave, Tavily via `SearchRegistry`  
- [x] Minimal `ExecutionProfileEngine` (position cap only) + `resolvePositionSizeUsd` removed from orchestrator  

---

## Plans vs code (status honesty)

| Plan doc | Header status | Gaps still in code (this checklist) |
|----------|---------------|-------------------------------------|
| `cognitive-runtime-phase-1-redesign-plan.md` | **Draft** | Engine bindings, lint, MCP, phase UI, replay |
| `cognitive-runtime-phase-2-selector-cutover-plan.md` | Complete | **§2D replay suite still Pending**; orchestrator selector prose |
| `cognitive-runtime-phase-3-selector-cleanup-plan.md` | Complete | Dead `validateSelectorOutput`; `aiPickerEnabled` naming (OQ open) |
| `cognitive-runtime-phase-4..6` | Complete | Event-contract configs, trimmed payloads, review thresholds |
| `cognitive-runtime-phase-7-decision-execution-plan.md` | Complete | **Strategy profiles, SL/TP, `execution_strategy` column, entry-timer** |
| `cognitive-runtime-phase-8-legacy-cleanup-plan.md` | Complete | UI labels, docs, dead orchestrator helpers |

---

## Phase 0 — Evals & replay

Spec §17 / §19; **no `cognitive-runtime-phase-0` plan file**.

- [ ] Replay reproduces `sawSubmitCandidates: false` on legacy path from `docs/hello.json` (spec gate)  
- [ ] Five sandbox fixtures with deterministic expectations for **all** stages  
- [ ] Assertion helpers: `assertSubmissionFires`, `assertTechnicalSignalHasField`, `assertTradeSignalAction`, `assertCostBelowUsd`  
- [ ] Side-by-side old-vs-new pipeline diff (today: `CycleReplayService` + IPC `session.buildCycleFixture` / `saveCycleFixture` / `getPaperScorecard` — replays validation/policy/exit, **not** full typed pipeline parity)  
- [ ] Wire replay scorecards to pipeline outputs (see archived `phase-specs/phase-7-replay-scorecards.md`)

**Verified:** `electron/main/ipc/replay.ts`, `orchestration/cycle-replay-service.ts` exist; no pipeline assertion module.

---

## Phase 1 — Infrastructure

### Engines (`electron/main/services/ai/engines/`)

**Registered in `register-default-engines.ts`:** `risk-summary`, `candidate-validator`, `order-policy`, `broker-allocation`, `exit-policy`, `risk-gate`.

**Exist as modules but not in registry:** `selector-scoring-engine`, `selector-candidate-merger`, `selector-risk-filter`, `selector-submission-builder`, `technical-aggregator`, `fundamental-aggregator`, `review-aggregator`, `execution-profile-engine`.

- [ ] Register pipeline aggregators / execution-profile in `EngineRegistry`  
- [ ] Use `WorkerDefinition.engines` in phase definitions (field exists; **no worker sets `engines:`** in `definitions/`)  
- [ ] Shared `electron/shared/ai/pipeline-config.ts` (`PipelineConfig`, `ScoringWeights`, `RiskRuleSet`) — types scattered today  
- [ ] `phaseSpendCapUsd` / `totalSpendCapUsd` enforcement (only per-worker `spendLimitUsd` in `worker-executor.ts` → `runAgent`)  
- [ ] Mid-phase abort when `maxAiSpendUsd` exceeded (session-level `maxDataSpendUsd` on search tools exists; not pipeline-runner aggregate cap)

### MCP & search (`docs/TODO.md` + spec §16.12)

- [ ] `McpSearchAdapter` — **file does not exist** (adapters: `duckduckgo`, `brave`, `tavily` only)  
- [ ] MCP fallback in worker tool config  
- [ ] Search “plug and play” like engines (unify `SearchRegistry` with engine bindings / phase tool factory)  
- [ ] Do not duplicate tool usage instructions in prompts (`docs/TODO.md` — tools should come from schema descriptions only); audit `strategy-prompt-context` + worker markdown for tool-order prose  

### Prompt lint (spec goals #1, §19 Phase 2)

**Char audit (2026-05-18, file bytes):** worker assets mostly &lt; 1,600 chars except `decision.md` (**1,742**), `fundamental-workers/catalyst-context.md` (1,067), `review-workers/*` (~957–999). Unused phase files: `selector.md` (587), `technical.md` (384), etc.

- [ ] Vitest: each `pipeline-runtime/prompts/**/*.md` ≤ 1,600 chars  
- [ ] Vitest: banned phrase denylist (§11)  
- [ ] Enforce `RUNTIME_DEFAULTS.prompt.maxSystemChars` / `maxUserPayloadChars` (`pipeline-phase.ts` — **not referenced outside definition**)  
- [ ] Token budget ≤ 400 per worker **including** injected `<trusted_session_context>` + `<preset_behavior>` (currently full strategy snapshot every call — `prompt-envelope-builder.ts:45-48`)

### Prompt files

- [ ] Delete unused: `prompts/selector.md`, `technical.md`, `fundamental.md`, `review.md` (not referenced by any `promptAssetPath`)  
- [ ] Add `decision-workers/signal-classifier.md` + `decision-workers/entry-timer.md`; shrink `decision.md`  

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
- [ ] Spec log lines `[stage:selector/discovery]…` (orchestrator still emits `"Running instrument selector agent..."` ~1449)  

### Orchestrator selector prose (verified dead or stale)

- [ ] **`buildSelectionInstructions`** still tells model to call `submit_candidates` (~1607–1610 `agent-orchestrator.ts`) — pipeline never uses that tool; move intent into worker prompts / posture only (`docs/TODO.md`)  
- [ ] **Delete dead code:** `validateSelectorOutput` + helpers (`hasSuccessfulQuote`, `hasDiscoveryEvidence`, `buildSelectorResearchBrief`, …) — **defined but never called** after pipeline cutover  
- [ ] `run-agent-execute.ts` still logs `instrument_selector` + `analyzeSelectorSteps` when `role === "instrument_selector"` — legacy path only if something still sets that role (pipeline uses `role: phase` in retry metadata)  

### Selector validation duplication (Phase 2 open Q2)

- [x] In-pipeline: `RiskFilter` → `CandidateValidationService` with quote traces (`selector-risk-filter.ts`)  
- [ ] Document or remove orphaned orchestrator validation (above)  
- [ ] Align Phase 2 success criterion “live path does not depend on `selector-runtime-control.ts`” — **still imported** for loop analytics in `run-agent-execute.ts`, not for pipeline selector  

---

## Phase 3 — Selector cleanup

- [x] `selector-runtime-control.ts` trimmed (step heuristics removed per Phase 3 plan)  
- [x] `worker-executor` selector `parseInstrumentSelection` branch removed (per Phase 3 plan)  
- [~] `selector-runtime-control.ts` retained for `analyzeSelectorSteps` / loop detection  
- [ ] Open: rename `aiPickerEnabled` vs “phase selector enabled” (`cognitive-runtime-phase-3-selector-cleanup-plan.md` OQ #1)  

---

## Phase 4 — Technical

- [x] Workers: `chart-pattern`, `momentum-indicator`, `volume-profile` + `aggregateTechnicalSignal`  
- [ ] `event_contract_scan` → alternate worker set (spec §16.17 — **no `EVENT_STAT_*` symbols in repo**)  
- [~] `buildAnalystContext` passes **prose** `selectorResearchBrief` into technical/fundamental `context` field (`agent-orchestrator.ts:1122-1126`) — not a typed prior-phase object  
- [ ] Engine-bound timeframe/rules context (not only `buildStrategyPromptContext` prose)  
- [ ] Replay fixtures for `TechnicalSignal`  

---

## Phase 5 — Fundamental

- [x] Three workers + `aggregateFundamentalSignal` + `catalystScore` derivation tests  
- [ ] `EVENT_CONTEXTUAL_PIPELINE_CONFIG` for `event_contract_scan`  
- [ ] Research posture / search defaults via engines, not prompt-only  
- [ ] Replay fixtures  

---

## Phase 6 — Review

- [x] `conflict-detector`, `risk-assessor`, `aggregateReviewSignal`  
- [~] **Recommendation thresholds differ** (`review-aggregator.ts:deriveRecommendation` vs spec §16.8):  
  - Code: `skip` if conflict ≥ 0.7 **and** risk `high`; `reduce_size` if either high conflict or high risk  
  - Spec: `skip` if conflict &gt; 0.7 **or** high risk; `reduce_size` if conflict &gt; 0.4 **or** medium risk  
- [ ] Compact downstream JSON: strip `rawSummary` before `JSON.stringify` in `review.phase.ts` / `decision.phase.ts`  
- [ ] Enforce review `skip` in code, not only via `decision.md` prompt (“when review recommends skip”)  
- [ ] Optional: `risk-assessor` + `get_quote` (spec OQ #11)  

---

## Phase 7 — Decision & execution

### Decision (verified)

- [~] Single worker `signal-classifier`; prompt `decision.md` (1,742 chars)  
- [ ] `entry-timer` worker + `TradeSignalAggregator` (spec §16.9)  
- [ ] `signal.executionStrategy` consumed anywhere after decision (orchestrator: **no matches**)  
- [ ] `entry_price` on trade from signal (`createTradeFromDecision` sets `entry_price: null` ~1286)  

### ExecutionProfileEngine (verified minimal)

Current `execution-profile-engine.ts`:

```ts
positionSizeUsd = min(maxPositionUsd, maxExposureUsd ?? maxPositionUsd)
// no stopLossPct, takeProfitPct, orderType, strategy-specific logic
```

- [ ] Full `ExecutionProfile` per spec §16.9 (`sizeUsd`, `stopLossPct`, `takeProfitPct`, `orderType`, `limitPrice`)  
- [ ] `STRATEGY_PROFILES` for all `executionStrategy` enum values  
- [ ] Kelly / prediction-market sizing from session risk config (removed from orchestrator; not in engine)  
- [ ] `compute()` throws on `action: "skip"` (orchestrator bypasses with `{ positionSizeUsd: 0 }`)  
- [ ] DB: `trades.execution_strategy` column + populate on insert  
- [ ] Set `stop_loss_price` / `take_profit_price` from engine (always `null` today)  
- [ ] Replay: per-strategy sizing expectations  

### Schema

- [ ] `tradeDecisionSchema` in `src/lib/schemas.ts` still has `sizeUsd` / `stopLossPct` / `takeProfitPct` — **no TS consumers outside docs** (grep); remove or deprecate  
- [ ] Update `docs/architecture/ai-runtime-and-harness.md`, `background-config-and-guards.md` references  

### Phase 7 plan honesty

- [ ] Reconcile `cognitive-runtime-phase-7-decision-execution-plan.md` “Complete” with items above (plan §7 claims full engine; code is cap-only)  

---

## Phase 8 — Legacy cleanup (residual)

- [ ] UI: phase-first labels in `AGENT_LABEL` / Dashboard / CostBreakdown (legacy `analyst_technical`, `instrument_selector` still present — `src/components/custom-ui/index.tsx`)  
- [ ] DevPanel `phaseLabel()` still maps legacy agent types  
- [ ] Extract loop-detection out of `selector-runtime-control` naming  
- [ ] Spec banner “Complete” vs this checklist — add “Known gaps” to spec or link here  

---

## Spec goals §3 (code-verified)

| # | Goal | Status | Evidence |
|---|------|--------|----------|
| 1 | Prompts ≤400 tokens, no workflow prose | [~] | No lint; large injected context |
| 2 | Typed inter-phase contracts | [x] | `pipeline-signals.ts`, orchestrator `runPhase` |
| 3 | Selector submission structural | [x] | `selector-submission-builder.ts` |
| 4 | AI never sizes / SL / TP | [~] | Engine cap-only; SL/TP columns null |
| 5 | Config-driven workers | [~] | Workers in `*.phase.ts`, not data-only config |
| 6 | Dependency parallel execution | [~] | `worker-graph-scheduler.ts`; selector custom `run` |
| 7 | Deterministic scoring | [x] | `selector-scoring-engine.test.ts` |
| 8 | MCP search | [ ] | No adapter file |
| 9 | Sandbox without worker branches | [~] | `resolve-mock-tool-context.ts` → `toolContext`; grep `isMockSession` in workers: none |
| 10 | Orchestrator API compat | [x] | `resolveInstruments`, trade creation |
| 11 | Phase-first UX | [~] | DevPanel read-only; Strategy page no phases |
| 12 | Observability | [~] | `PhaseTraceV1` yes; spec `[stage:…]` logs mostly no |

---

## UX & configuration

- [ ] Strategy UI: Phase Profiles (tabs/cards) — `StrategyConfig.tsx` has presets/risk/timeframe, **no `aiPhases` UI**  
- [ ] IPC: `SessionAiPhasesRepo.upsertPhase` / `upsertWorker` exist — **no `channels.strategy.save*` for phases** (`electron/main/ipc/strategy.ts`)  
- [x] DevPanel: `PhaseRuntimeMatrixCard` read-only  
- [ ] Scoring weights user-editable (v1 hardcoded `DEFAULT_SCORING_WEIGHTS` in `selector.phase.ts`)  

---

## Worker runtime §11

- [ ] Zod fail → retry once → zero dimension (`worker-executor.ts:123-127` throws `VALIDATION_FAILED`)  
- [ ] Trim worker context (full strategy in every envelope)  
- [ ] `onDependencyFailure` on worker defs (type only)  
- [ ] Pipeline spend abort log message (spec §13)  

---

## Discovery mode §16.17

| Mode | Selector | Technical | Fundamental |
|------|----------|-----------|-------------|
| `event_contract_scan` | [ ] | [ ] | [ ] |

`discoveryMode` is stored and surfaced in strategy prompt (`strategy-prompt-context.ts:39`) but **does not switch pipeline configs**.

---

## `docs/TODO.md` — action items mapped

### Research & prompts (lines 1–16)

- [ ] Improve web research quality (opencode-style MCP delegation) → `McpSearchAdapter` + tool-schema-only descriptions  
- [ ] Reasoning/sorting layer for consolidated worker outputs (future N→10→1 pattern)  
- [ ] Read/process: `docs/reviews/hello-json-run-post-mortem-2026-05-17.md`, `research-prompt-review.md`, `system-review.md` (product input, not code)  
- [ ] Refactor `docs/engineering/ai-model-configuration-guide.md` entirely  

### Architecture vision (lines 18–24)

- [x] Orchestrator retained  
- [~] Config-based subagents — phases yes; adding worker still requires `*.phase.ts` edit  
- [ ] N→10→1 consolidator tiers (explicitly out of spec v1 — track as future)  

### Execution / order management (lines 29–44)

- [ ] **Order management strategy system** per instrument class (futures, prediction market, etc.) — beyond `computeExecutionProfile` cap  
- [ ] Auto SL/TP from code for each `executionStrategy` (spec §16.9 table)  
- [ ] Optional **AI-adjustable SL/TP** while trade open → `dynamicRiskAdjustment: "ai_managed"` + `risk_monitor` worker (spec §16.10)  
- [ ] AI finds entries; system executes sizing/risk consistently (partial — size cap only)  

### Concrete cleanup (lines 50–52)

- [x] Delete `electron/prompts/`  
- [x] Remove `prompt-pack-builder`  
- [ ] Delegate orchestrator selector instructions / dead validation to pipeline (`buildSelectionInstructions`, `validateSelectorOutput`)  
- [ ] Delegate more of `run-agent-execute` / runtime to pipeline timeline where applicable  
- [ ] Search plugin plug-and-play like engines  
- [ ] Move `engines/` folder under `ai/`  

### Presets (lines 58–59)

- [~] `preset-behavior-guidance.ts` + envelope wiring — **done**  
- [ ] Tests: preset `aiGuidance` renders per phase for built-in presets (`electron/shared/presets/*.json`)  
- [ ] Per-worker phase guidance (e.g. web-scout) distinguished from global strategy block if needed  

---

## Adjacent plans (not cognitive phases, but `docs/plans/`)

- [ ] **`elasticsearch-research-memory-integration-plan.md`** (Draft) — workspace research index; complements MCP/search TODO; does not replace live search  
- [ ] **`preset-db-seed-migration-plan.md`** — preset DB seeding; related to preset guidance coverage  
- [ ] Archived plans under `docs/plans/archieve/` — historical; do not treat as open pipeline work unless explicitly revived  

---

## Metrics & CI (§14, §19)

- [ ] CI grep: no `technicalAnalysis` / `fundamentalAnalysis` strings between phases (orchestrator: clean)  
- [ ] CI: `tradeDecisionSchema` sizing fields unused or removed  
- [ ] CI: prompt length + denylist tests  
- [ ] Measured: terminal submission rate, AI-authored sizing rate, sandbox cycle cost ≤ $0.50  

---

## Suggested priority

1. **ExecutionProfileEngine** + `execution_strategy` + SL/TP on trades  
2. **Decision** `entry-timer` + aggregator; wire `executionStrategy`  
3. **Orchestrator cleanup:** delete `validateSelectorOutput` tree; fix `buildSelectionInstructions`  
4. **Prompt lint** + strip `rawSummary` from downstream task JSON  
5. **Phase 0/2 replay** fixtures + assertions  
6. **Strategy UI + IPC** for `session_ai_phases`  
7. **MCP search** + research memory (Elasticsearch plan)  
8. **Event-contract pipeline configs**  
9. Docs/plan status alignment  

---

## Code reference map

| Area | Path |
|------|------|
| Runtime entry | `electron/main/services/ai/ai-runtime/runtime.ts` |
| Phase defs | `electron/main/services/ai/pipeline-runtime/definitions/` |
| Worker exec | `electron/main/services/ai/pipeline-runtime/execution/worker-executor.ts` |
| Prompt envelope | `electron/main/services/ai/pipeline-runtime/prompting/prompt-envelope-builder.ts` |
| Signals | `electron/shared/ai/pipeline-signals.ts` |
| Engines | `electron/main/services/ai/engines/` |
| Orchestrator | `electron/main/services/orchestration/agent-orchestrator.ts` |
| Phase DB | `electron/main/db/repositories/sessions/session-ai-phases-repo.ts` |
| Replay IPC | `electron/main/ipc/replay.ts` |
| Design spec | `docs/design/cognitive-pipeline-rearchitecture-spec.md` |
| Product TODO | `docs/TODO.md` |
