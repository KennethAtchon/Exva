# Cognitive Runtime Phase 5 Fundamental Pipeline — Plan

> **Date:** 2026-05-17
> **Status:** Draft
> **Deciders:** Ken
> **Implements:** `docs/design/cognitive-pipeline-rearchitecture-spec.md` Phase 5
> **Depends on:** `docs/plans/cognitive-runtime-phase-4-technical-pipeline-plan.md`

---

## 1. Problem Statement

The current fundamental phase has the same structural problem as the current technical phase: `fundamental.phase.ts` defines one broad `analyst-fundamental` worker that returns `{ text: string }`, and the orchestrator forwards that prose block directly into review and decision. Catalyst type, catalyst freshness, earnings context, and sentiment are therefore implicit inside a paragraph instead of explicit in code.

That prevents deterministic review and decision logic from being built on top of stable inputs. It also means the system cannot separately tune or replace earnings, catalyst, or sentiment reasoning without rewriting one large prompt. Phase 5 should convert the fundamental phase into narrow workers plus a typed `FundamentalSignal` contract.

---

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
| --- | --- | --- |
| 1 | Replace the single fundamental analyst worker | `fundamental.phase.ts` no longer returns `{ text }` from one worker |
| 2 | Introduce `FundamentalSignal` | Downstream phases consume typed catalyst, earnings, sentiment, and contradiction fields |
| 3 | Split fundamental work into bounded workers | Earnings, catalyst, and sentiment contexts are independently produced |
| 4 | Keep aggregation deterministic | Fundamental synthesis happens in code, not an LLM merge |
| 5 | Prepare review for typed cross-phase input | Review can consume technical and fundamental signals directly |

**Non-Goals**

| # | Non-Goal | Reason |
| --- | --- | --- |
| 1 | Review logic conversion | Phase 6 owns review migration |
| 2 | Cross-session memory or learned catalyst taxonomy | Out of scope |
| 3 | UI for per-worker tuning | Config-only in v1 |

---

## 3. Background & Context

| File | Current responsibility | Gap |
| --- | --- | --- |
| `electron/main/services/ai/pipeline-runtime/definitions/fundamental.phase.ts` | One `analyst-fundamental` worker returning `{ text }` | No typed phase signal |
| `electron/main/services/orchestration/agent-orchestrator.ts` | Passes `fundamental.output.text` to later phases | Hard free-text coupling |
| `docs/design/cognitive-pipeline-rearchitecture-spec.md` | Defines target `FundamentalSignal` fields | Migration target already clear |

The important difference from the technical phase is that fundamental output must also encode contradiction risk and catalyst freshness. Those are not just informative fields; they are inputs to later review and risk decisions.

### Engine and config wiring required in this phase

Fundamental workers should be bound to the actual persisted research posture and workspace search defaults:

| Input or engine concern | Source |
| --- | --- |
| Discovery mode, evidence mode, catalyst posture, strictness | `session_research_posture` via `SessionStrategyContextService` |
| Search-provider defaults | `workspace_preferences` + session default search provider |
| Risk/timeframe context for evidence interpretation | `session_risk_config` + `session_timeframe_config` via `SessionStrategyContextService` |
| Fundamental aggregation | `fundamental-aggregator` transformer engine |

---

## 4. Research Summary

No new external research is needed for this phase beyond the Phase 1 architecture references. The main work is translating the spec's target `FundamentalSignal` into code.

---

## 5. Options Considered

**Option A: Keep one fundamental worker and add a stronger schema**

| Dimension | Assessment |
| --- | --- |
| Complexity | Low |
| Reliability | Medium-low |
| Long-term value | Medium-low |

**Option B: Multiple workers plus an LLM merger**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | Medium |
| Long-term value | Medium |

**Option C: Multiple workers plus deterministic `FundamentalSignal` aggregation**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | High |
| Long-term value | High |

---

## 6. Recommendation

**We recommend Option C: implement `FundamentalSignal` directly with narrow workers for earnings, catalyst, and sentiment, then aggregate in code.**

This phase should mirror the technical-phase pattern closely so the runtime learns one reusable analysis-phase shape: bounded workers, typed outputs, deterministic aggregator, structured trace.

---

## 7. Implementation Plan

### Phase 5A: Define `FundamentalSignal` and worker schemas

Goal: stabilize the fundamental output contract.

Done criteria: `FundamentalSignal` and worker output schemas exist and validate against fixtures.

Deliverables:

- Add shared `FundamentalSignal` schema.
- Define worker outputs for `earnings-context`, `catalyst-context`, and `sentiment-context`.
- Define explicit null/default semantics for no-news or low-evidence cases.
- Define a context-engine payload for research posture so workers receive typed discovery/evidence/catalyst settings from DB-backed state rather than inherited prose.

Dependencies: shared pipeline-signal module from Phase 4 work.

Risks: sentiment and catalyst fields may overlap if scopes are not kept narrow.

Rollback plan: revert schema changes before wiring if needed.

### Phase 5B: Implement workers and aggregator

Goal: build the live fundamental phase behavior.

Done criteria: the fundamental phase runs three workers in parallel and produces `FundamentalSignal`.

Deliverables:

- Implement `FundamentalPipeline` and signal aggregator.
- Implement prompt assets and tool bindings.
- Prefer current-information tools for earnings/catalyst/sentiment evidence rather than broad narrative prompts.
- Register and use a `fundamental-aggregator` transformer engine/finalizer and explicit research-posture context bindings.
- Add worker and aggregator tests.

Dependencies: Phase 5A contracts.

Risks: evidence quality may be uneven across supported instrument classes.

Rollback plan: keep the current single-worker definition until replay and tests pass.

### Phase 5C: Wire typed output into orchestrator and prepare the review migration

Goal: stop treating fundamental analysis as a text blob.

Done criteria: orchestrator stores/passes `FundamentalSignal`, and any temporary review adapter is explicit and short-lived.

Deliverables:

- Replace `{ text: string }` fundamental runtime/orchestrator types with `FundamentalSignal`.
- If Phase 6 is not in the same branch, introduce a narrow temporary adapter from `rawSummary` to the old review input and mark it Phase-6-only debt.
- Persist structured fundamental traces.
- Ensure workspace/session search-provider resolution is consumed through runtime tool context, not restated in prompts.

Dependencies: Phase 5B implementation.

Risks: temporary adapters become sticky if not explicitly scheduled for removal.

Rollback plan: revert the typed-wiring commit if downstream review integration is not ready.

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | Sentiment and catalyst workers duplicate work | Medium | Medium | Keep input/output scope explicit per worker |
| 2 | Fundamental evidence varies widely by instrument class | Medium | High | Encode null/default cases rather than forcing fabricated confidence |
| 3 | Temporary review adapter survives too long | Medium | Medium | Call it out explicitly in Phase 5 and delete it in Phase 6 acceptance |

---

## 9. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
| --- | --- | --- | --- | --- |
| Typed fundamental output | Fundamental phase output shape | `{ text: string }` | `FundamentalSignal` | Schema tests + orchestrator types |
| Narrow workers | Worker count in fundamental phase | 1 | 3 | Phase definition review |
| Deterministic aggregation | Aggregation owner | LLM prose | Code | Unit tests |
| Review-readiness | Downstream contract | Raw prose | Typed signal available | Code review |
| DB-backed research posture wiring | Fundamental posture inferred mainly from prompt text | Transitional | Research posture and search defaults arrive as typed runtime context | Code review + tests |

---

## 10. Open Questions

| # | Question | Owner | Needed By | Status |
| --- | --- | --- | --- | --- |
| 1 | Should `sentiment-context` have direct Reddit/search access in v1, or should it only consume upstream discovery evidence? | Ken | Before Phase 5B | Open |
| 2 | How should contradiction risk combine multiple weak or conflicting catalyst signals? | Ken | Before Phase 5B | Open |

---

## 11. Alternatives Rejected

| Option | Why Rejected |
| --- | --- |
| One fundamental worker with stricter schema | Still centralizes too much reasoning in one call |
| LLM merger for fundamental synthesis | Conflicts with deterministic aggregation goal |
