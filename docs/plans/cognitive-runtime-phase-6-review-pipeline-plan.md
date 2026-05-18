# Cognitive Runtime Phase 6 Review Pipeline — Plan

> **Date:** 2026-05-17
> **Status:** Complete
> **Deciders:** Ken
> **Implements:** `docs/design/cognitive-pipeline-rearchitecture-spec.md` Phase 6
> **Depends on:** `docs/plans/cognitive-runtime-phase-5-fundamental-pipeline-plan.md`

---

## 1. Problem Statement

The current review phase still consumes free text and returns free text. `review.phase.ts` takes `technicalAnalysis: string` and `fundamentalAnalysis: string`, then one `reviewer` worker returns `{ text: string }`. That means review currently acts as a prose bridge instead of a deterministic evaluator of two typed signals. Even if phases 4 and 5 produce structured outputs, the system does not realize their value until review also becomes typed.

Review is where the pipeline should explicitly reason about conflict, tail risk, and recommended disposition. Those are system-level control points, not just editorial prose. Phase 6 therefore needs to convert review from a narrative summarizer into a narrow-worker phase that emits `ReviewSignal`.

---

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
| --- | --- | --- |
| 1 | Make review consume typed upstream signals | `ReviewPipeline` accepts `TechnicalSignal` and `FundamentalSignal`, not strings |
| 2 | Introduce `ReviewSignal` | Review output includes typed conflict, tail-risk, and recommendation fields |
| 3 | Split review into bounded workers | Conflict detection and risk assessment run independently |
| 4 | Keep recommendation logic explicit | `proceed`, `reduce_size`, and `skip` are stable enum outputs, not implied prose |
| 5 | Remove temporary adapters from Phase 5 | Any raw-summary bridge is deleted by the end of this phase |

**Non-Goals**

| # | Non-Goal | Reason |
| --- | --- | --- |
| 1 | Execution sizing or order math | Phase 7 owns execution profile logic |
| 2 | External market-regime modeling | Still out of scope |
| 3 | Multi-reviewer debate architecture | v1 keeps review narrow and deterministic |

---

## 3. Background & Context

| File | Current responsibility | Gap |
| --- | --- | --- |
| `electron/main/services/ai/pipeline-runtime/definitions/review.phase.ts` | One `reviewer` worker consuming strings | No typed review contract |
| `electron/main/services/orchestration/agent-orchestrator.ts` | Builds review input from technical/fundamental text blocks | Hard-coded prose coupling |
| `docs/design/cognitive-pipeline-rearchitecture-spec.md` | Defines target `ReviewSignal` | Migration target already specified |

The review phase is also where graceful degradation becomes important. If upstream technical or fundamental dimensions are null, review should produce a typed skip or reduce-size recommendation rather than fabricating certainty.

### Engine and config wiring required in this phase

Review should be the first phase where multiple typed upstream signals and DB-backed policy context meet cleanly:

| Input or engine concern | Source |
| --- | --- |
| Technical signal | `TechnicalSignal` from Phase 4 |
| Fundamental signal | `FundamentalSignal` from Phase 5 |
| Risk posture and exposure preferences | `session_risk_config` via `SessionStrategyContextService` |
| Holding style and trade rules | `session_timeframe_config` + `session_trade_rules` via `SessionStrategyContextService` |
| Review aggregation | `review-aggregator` transformer engine |

---

## 4. Research Summary

No new external research is needed. This phase is the deterministic review layer required by the existing spec.

---

## 5. Options Considered

**Option A: Keep one review worker and just swap string inputs for JSON payloads**

| Dimension | Assessment |
| --- | --- |
| Complexity | Low |
| Reliability | Medium-low |
| Long-term value | Medium-low |

**Option B: Use multiple review workers but keep a final LLM reviewer**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | Medium |
| Long-term value | Medium |

**Option C: Use bounded review workers plus deterministic `ReviewSignal` aggregation**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | High |
| Long-term value | High |

---

## 6. Recommendation

**We recommend Option C: convert review directly to typed-signal input and output, with conflict detection and risk assessment as separate workers and a deterministic review aggregator.**

This keeps review aligned with the overall architecture: the AI identifies bounded judgments, and the system packages them into a stable signal that decision can trust.

---

## 7. Implementation Plan

### Phase 6A: Define `ReviewSignal` and worker outputs — **Done**

Deliverables completed:

- `ReviewSignal` schema already existed in `electron/shared/ai/pipeline-signals.ts` from Phase 4 groundwork.
- `ConflictDetectorOutput` and `RiskAssessorOutput` worker schemas defined in `engines/review-aggregator.ts`.
- Recommendation rules encoded: no-evidence → `skip`; high conflict (≥0.7) AND high risk → `skip`; either alone → `reduce_size`; otherwise → `proceed`.

### Phase 6B: Implement review workers and aggregator — **Done**

Deliverables completed:

- `engines/review-aggregator.ts` — `aggregateReviewSignal()` with deterministic recommendation derivation; `buildRawSummary()` concatenates per-worker summaries.
- Prompt assets: `review-workers/conflict-detector.md` (no tools — receives serialized typed signals as context) and `risk-assessor.md` (no tools — same inputs).
- `review.phase.ts` rewritten: 2 workers in parallel via `runConcurrentGroup(concurrency=2)`; results fed to `aggregateReviewSignal`; `assembleAggregateTrace` for persistence.
- `engines/review-aggregator.test.ts` — 7 tests covering: no-evidence skip, proceed on clean signals, reduce_size on high-risk-only, reduce_size on high-conflict-only, skip on both-high, rawSummary content, conflictExplanation passthrough.
- Open question resolved: `risk-assessor` receives no live tools — typed inputs only.
- Open question resolved: high conflict alone yields `reduce_size` (not forced skip); skip requires both conflict ≥0.7 AND risk "high".

### Phase 6C: Remove raw-string review inputs from the live path — **Done**

Deliverables completed:

- `AiTextRun` removed; `AiReviewRun = AgentResult<ReviewSignal>` added.
- `TradeCycleContext.review` and `AiPipelineResult.review` updated to `AiReviewRun`.
- Orchestrator review `runPhase` call: input changed from `{ technicalAnalysis: string; fundamentalAnalysis: string }` to `{ technical: TechnicalSignal; fundamental: FundamentalSignal }`.
- Phase 5 `rawSummary` adapters for review input removed.
- Decision phase: `review.output.rawSummary` replaces `review.output.text` as backward-compat string adapter until Phase 7.

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | Review recommendation semantics overlap with decision action semantics | Medium | Medium | Keep review limited to `proceed` / `reduce_size` / `skip`; decision owns buy/sell/skip |
| 2 | Null upstream signals create ambiguous review output | Medium | High | Encode explicit skip behavior for insufficient evidence |
| 3 | Review workers quietly reintroduce long narrative summaries as hidden contracts | Medium | Medium | Enforce schema-first downstream inputs and treat summaries as audit-only |

---

## 9. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
| --- | --- | --- | --- | --- |
| Typed review input | Review input contract | Strings | `TechnicalSignal` + `FundamentalSignal` | Types + code review |
| Typed review output | Review output contract | `{ text: string }` | `ReviewSignal` | Schema tests |
| Removal of bridge adapter | Temporary raw-summary adapter | Possible | Gone | Grep |
| Deterministic recommendation packaging | Review recommendation owner | LLM prose | Code aggregation over worker outputs | Unit tests |
| DB-backed review policy wiring | Review posture implied in prose | Transitional | Risk/timeframe/rules arrive as typed context-engine inputs | Code review + tests |

---

## 10. Open Questions

| # | Question | Owner | Needed By | Status |
| --- | --- | --- | --- | --- |
| 1 | Should `risk-assessor` have optional live quote access in v1, or should review stay fully signal-only? | Ken | Before Phase 6B | Resolved: no live tools; typed signal inputs only per spec. |
| 2 | Should high conflict always force `skip`, or can it still yield `reduce_size` if overall evidence remains strong? | Ken | Before Phase 6A | Resolved: high conflict alone → `reduce_size`; skip requires conflict ≥0.7 AND risk "high" together. |

---

## 11. Alternatives Rejected

| Option | Why Rejected |
| --- | --- |
| Single review worker with JSON output | Still centralizes too much cross-phase interpretation |
| LLM-based final review merge | Conflicts with deterministic aggregation goal |
