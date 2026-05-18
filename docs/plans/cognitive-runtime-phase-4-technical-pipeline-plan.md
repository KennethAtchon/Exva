# Cognitive Runtime Phase 4 Technical Pipeline — Plan

> **Date:** 2026-05-17
> **Status:** Complete
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

### Phase 4A: Define the technical signal contract — **Done**

Deliverables completed:

- `electron/shared/ai/pipeline-signals.ts` created with `TechnicalSignal`, `FundamentalSignal`, `ReviewSignal`, `TradeSignal`, and `ExecutionStrategyType` schemas (all four inter-phase contracts defined upfront).
- `ChartPatternOutput`, `MomentumOutput`, `VolumeOutput` worker output schemas defined in `engines/technical-aggregator.ts`.
- Null/default behavior encoded in schemas: all optional scored fields use `.nullable().default(null)`.

### Phase 4B: Implement narrow technical workers and aggregator — **Done**

Deliverables completed:

- `engines/technical-aggregator.ts` — `aggregateTechnicalSignal()` with deterministic `timeframeAlignment` computation (1.0 for trend/volume agreement, 0.5 for one-side neutral, 0.0 for conflict, null if volume absent).
- Prompt assets: `technical-workers/chart-pattern.md`, `momentum-indicator.md`, `volume-profile.md` (≤200 tokens each; focused tool sets: `get_ohlcv` only for chart/volume, `get_ohlcv` + `get_quote` for momentum).
- `technical.phase.ts` rewritten: 3 workers (`chart-pattern`, `momentum-indicator`, `volume-profile`) run in parallel via `runConcurrentGroup(concurrency=3)`; results fed to `aggregateTechnicalSignal`; `assembleAggregateTrace` for persistence.
- `engines/technical-aggregator.test.ts` — 7 tests covering trend/pattern/volume field mapping, alignment computation, all-absent fallback, and rawSummary content.

### Phase 4C: Wire orchestrator and runtime to typed technical outputs — **Done**

Deliverables completed:

- `AiTechnicalRun = AgentResult<TechnicalSignal>` type added; `AiPipelineResult.technical` and `TradeCycleContext.technical` updated.
- `runPhase<..., TechnicalSignal>` call updated; empty-output check changed from `.text.trim()` to `.symbol` presence.
- Downstream review/decision phases receive `technical.output.rawSummary` as the backward-compat string adapter until Phase 6 migrates review to typed inputs.

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
| 1 | Should `volume-profile` get only OHLCV or also quote context for gap-aware interpretation? | Ken | Before Phase 4B | Resolved: OHLCV only. Gap context is inferred from bars; adding quote would duplicate momentum worker's data. |
| 2 | Do we persist worker raw summaries individually or only the aggregated `rawSummary` in the phase trace? | Ken | Before Phase 4C | Resolved: aggregated `rawSummary` only in the phase trace, via `assembleAggregateTrace`. Individual worker summaries are concatenated into `rawSummary` by `buildRawSummary()` in the aggregator. |

---

## 11. Alternatives Rejected

| Option | Why Rejected |
| --- | --- |
| Single technical analyst with stricter JSON | Still too broad and opaque |
| LLM-based technical merge worker | Reintroduces model-dependent aggregation |
