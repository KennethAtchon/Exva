# Cognitive Runtime Phase 4 Technical Pipeline — Plan

> **Date:** 2026-05-17
> **Status:** Draft
> **Deciders:** Ken
> **Implements:** `docs/design/cognitive-pipeline-rearchitecture-spec.md` Phase 4
> **Depends on:** `docs/plans/cognitive-runtime-phase-2-selector-cutover-plan.md`

---

## 1. Problem Statement

The current technical phase is phase-keyed in name only. `technical.phase.ts` defines a single `analyst-technical` worker whose entire output contract is `{ text: string }`, and `AgentOrchestrator.runAiPipeline()` treats that free-text block as the canonical technical analysis artifact. That means the technical phase still has the same structural weakness the re-architecture is trying to remove: one broad worker, one prose output, and no typed downstream contract for trend, momentum, pattern, or volume signals.

This blocks the rest of the pipeline. Review cannot consume structured technical evidence because none exists. Decision cannot reason over technical dimensions deterministically because they are buried in prose. The technical phase therefore needs the same conversion selector got: narrow workers, typed outputs, code aggregation, and a stable inter-phase schema.

---

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
| --- | --- | --- |
| 1 | Replace the single technical analyst worker | `technical.phase.ts` no longer uses one `analyst-technical` worker returning `{ text }` |
| 2 | Introduce `TechnicalSignal` as the phase contract | Downstream consumers receive typed fields such as `trendDirection`, `momentumScore`, and `volumeScore` |
| 3 | Split technical work into narrow workers | Chart pattern, momentum, and volume workers run independently with trimmed inputs |
| 4 | Make aggregation deterministic | Technical aggregation happens in code, not via another LLM merge step |
| 5 | Keep technical runs replayable and observable | Structured traces preserve worker evidence and the final aggregated signal |

**Non-Goals**

| # | Non-Goal | Reason |
| --- | --- | --- |
| 1 | Rewriting fundamental/review/decision in the same change | Separate phases keep the migration verifiable |
| 2 | Creating a market-regime ontology | Out of scope for this rewrite |
| 3 | Building execution sizing logic | Phase 7 owns execution math |

---

## 3. Background & Context

### Current technical implementation

| File | Current responsibility | Gap |
| --- | --- | --- |
| `electron/main/services/ai/pipeline-runtime/definitions/technical.phase.ts` | One worker, `{ text }` output | No typed technical schema |
| `electron/main/services/orchestration/agent-orchestrator.ts` | Treats technical output as raw text | Downstream phases cannot consume structured evidence |
| `electron/shared/ai/pipeline-phase.ts` | Already supports multi-worker/object output definitions | Runtime substrate exists; behavior still needs migration |

### Target technical shape from the spec

The design spec already defines the target technical phase: parallel workers for chart patterns, momentum, and volume, plus a deterministic `TechnicalSignal` aggregator. Phase 4 should implement that exact shape rather than inventing another intermediate form.

### Engine and config wiring required in this phase

Technical workers should not rediscover session posture from prose. The phase should explicitly consume DB-backed session context and engine outputs:

| Input or engine concern | Source |
| --- | --- |
| Trading horizon and hold style | `session_timeframe_config` via `SessionStrategyContextService` |
| Side bias and setup posture | `session_trade_rules` via `SessionStrategyContextService` |
| Risk posture context | `session_risk_config` via `SessionStrategyContextService` |
| Technical aggregation | `technical-aggregator` transformer engine |

---

## 4. Research Summary

No new external research is needed. This phase is an internal application of the Phase 1 runtime pattern to the technical-analysis stage.

---

## 5. Options Considered

**Option A: Keep one technical analyst but force JSON output**

| Dimension | Assessment |
| --- | --- |
| Complexity | Low |
| Reliability | Medium-low |
| Long-term value | Medium-low |

Risks: still leaves all technical reasoning in one opaque model call.

**Option B: Add a technical merge worker on top of multiple text workers**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | Medium |
| Long-term value | Medium |

Risks: introduces another LLM merge dependency where the spec wants deterministic aggregation.

**Option C: Implement narrow technical workers plus code aggregation**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | High |
| Long-term value | High |

Risks: requires designing real typed schemas now, but that is the point of the migration.

---

## 6. Recommendation

**We recommend Option C: convert the technical phase directly to narrow workers with a typed `TechnicalSignal` output and deterministic aggregation.**

The technical phase should become the first analysis-phase proof that the new pipeline can carry structured evidence instead of prose. Each worker should answer one bounded question, and the aggregator should synthesize the final phase signal without another model call.

---

## 7. Implementation Plan

### Phase 4A: Define the technical signal contract

Goal: make the technical phase output explicit and stable.

Done criteria: `TechnicalSignal` and per-worker output schemas exist in shared code and validate against fixtures.

Deliverables:

- Add `TechnicalSignal` schema under shared AI pipeline signal types.
- Define worker output schemas for `chart-pattern`, `momentum-indicator`, and `volume-profile`.
- Define null/default behavior for partial worker failure.
- Define the context-engine payload shape for technical workers so timeframe/rules/risk data comes from trusted session config instead of broad prompt text.

Dependencies: Phase 1 runtime substrate.

Risks: schema shape may overfit current equity-style technical analysis.

Rollback plan: revert schema addition before wiring if design issues surface.

### Phase 4B: Implement narrow technical workers and aggregator

Goal: build the actual technical phase behavior.

Done criteria: three technical workers run in bounded parallel and aggregate into one `TechnicalSignal`.

Deliverables:

- Implement `TechnicalPipeline` and `signal-aggregator.ts`.
- Implement worker prompt assets and tool bindings.
- Prefer market data tools (`get_ohlcv`, `get_quote`) over generic search tools where possible.
- Register and use a `technical-aggregator` transformer engine/finalizer instead of leaving aggregation as an unowned helper.
- Add worker-level tests plus aggregator tests.

Dependencies: Phase 4A schemas.

Risks: market-data tool interfaces may need small payload shaping helpers for worker input trimming.

Rollback plan: keep the current technical definition untouched until parity is proven.

### Phase 4C: Wire orchestrator and runtime to typed technical outputs

Goal: make the live path consume `TechnicalSignal` instead of technical prose.

Done criteria: `AgentOrchestrator` stores and passes typed technical output forward.

Deliverables:

- Replace `{ text: string }` technical runtime and orchestrator types with `TechnicalSignal`.
- Update persistence/trace assembly to include the aggregated structured signal.
- Keep any audit summary text as trace-only data, not as the downstream contract.
- Ensure technical workers consume timeframe/rules/risk context from `SessionStrategyContextService`-backed engine inputs, not from legacy broad strategy prompt blocks.

Dependencies: Phase 4B pipeline implementation.

Risks: review/fundamental/decision phases still expect strings until later migrations.

Rollback plan: use a temporary adapter only if needed for an intermediate branch; do not leave it as the final design.

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | Technical schema omits a dimension later needed by review/decision | Medium | Medium | Add only stable fields now; keep summaries for audit only |
| 2 | Workers overlap too much and produce redundant evidence | Medium | Medium | Keep each worker task bounded and non-overlapping |
| 3 | Partial worker failure causes noisy downstream behavior | Medium | High | Encode explicit null/default semantics and review skip behavior |

---

## 9. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
| --- | --- | --- | --- | --- |
| Typed technical output | Technical phase output shape | `{ text: string }` | `TechnicalSignal` | Schema tests + orchestrator types |
| Narrow workers | Worker count in technical phase | 1 | 3 | Phase definition review |
| Deterministic aggregation | Aggregation owner | LLM prose | Code | Unit tests |
| No raw technical prose downstream | Downstream phase input contract | Free text | Typed signal | Grep + code review |
| DB-backed context wiring | Technical phase reads session posture from prompt prose only | Transitional | Timeframe/rules/risk inputs flow through typed context-engine payloads | Code review + tests |

---

## 10. Open Questions

| # | Question | Owner | Needed By | Status |
| --- | --- | --- | --- | --- |
| 1 | Should `volume-profile` get only OHLCV or also quote context for gap-aware interpretation? | Ken | Before Phase 4B | Open |
| 2 | Do we persist worker raw summaries individually or only the aggregated `rawSummary` in the phase trace? | Ken | Before Phase 4C | Open |

---

## 11. Alternatives Rejected

| Option | Why Rejected |
| --- | --- |
| Single technical analyst with stricter JSON | Still too broad and opaque |
| LLM-based technical merge worker | Reintroduces model-dependent aggregation |
