# Cognitive Runtime Phase 5 Fundamental Pipeline — Plan

> **Date:** 2026-05-17
> **Status:** Complete
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

| #   | Goal                                          | Success Looks Like                                                                      |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Replace the single fundamental analyst worker | `fundamental.phase.ts` no longer returns `{ text }` from one worker                     |
| 2   | Introduce `FundamentalSignal`                 | Downstream phases consume typed catalyst, earnings, sentiment, and contradiction fields |
| 3   | Split fundamental work into bounded workers   | Earnings, catalyst, and sentiment contexts are independently produced                   |
| 4   | Keep aggregation deterministic                | Fundamental synthesis happens in code, not an LLM merge                                 |
| 5   | Prepare review for typed cross-phase input    | Review can consume technical and fundamental signals directly                           |

**Non-Goals**

| #   | Non-Goal                                          | Reason                        |
| --- | ------------------------------------------------- | ----------------------------- |
| 1   | Review logic conversion                           | Phase 6 owns review migration |
| 2   | Cross-session memory or learned catalyst taxonomy | Out of scope                  |
| 3   | UI for per-worker tuning                          | Config-only in v1             |

---

## 3. Background & Context

| File                                                                          | Current responsibility                                | Gap                            |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| `electron/main/services/llm/pipeline/definitions/fundamental.phase.ts` | One `analyst-fundamental` worker returning `{ text }` | No typed phase signal          |
| `electron/main/services/orchestration/agent-orchestrator.ts`                  | Passes `fundamental.output.text` to later phases      | Hard free-text coupling        |
| `docs/design/cognitive-pipeline-rearchitecture-spec.md`                       | Defines target `FundamentalSignal` fields             | Migration target already clear |

The important difference from the technical phase is that fundamental output must also encode contradiction risk and catalyst freshness. Those are not just informative fields; they are inputs to later review and risk decisions.

### Engine and config wiring required in this phase

Fundamental workers should be bound to the actual persisted research posture and workspace search defaults:

| Input or engine concern                                     | Source                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Discovery mode, evidence mode, catalyst posture, strictness | `session_research_posture` via `SessionStrategyContextService`                         |
| Search-provider defaults                                    | `workspace_preferences` + session default search provider                              |
| Risk/timeframe context for evidence interpretation          | `session_risk_config` + `session_timeframe_config` via `SessionStrategyContextService` |
| Fundamental aggregation                                     | `fundamental-aggregator` transformer engine                                            |

---

## 4. Research Summary

No new external research is needed for this phase beyond the Phase 1 architecture references. The main work is translating the spec's target `FundamentalSignal` into code.

---

## 5. Options Considered

**Option A: Keep one fundamental worker and add a stronger schema**

| Dimension       | Assessment |
| --------------- | ---------- |
| Complexity      | Low        |
| Reliability     | Medium-low |
| Long-term value | Medium-low |

**Option B: Multiple workers plus an LLM merger**

| Dimension       | Assessment |
| --------------- | ---------- |
| Complexity      | Medium     |
| Reliability     | Medium     |
| Long-term value | Medium     |

**Option C: Multiple workers plus deterministic `FundamentalSignal` aggregation**

| Dimension       | Assessment |
| --------------- | ---------- |
| Complexity      | Medium     |
| Reliability     | High       |
| Long-term value | High       |

---

## 6. Recommendation

**We recommend Option C: implement `FundamentalSignal` directly with narrow workers for earnings, catalyst, and sentiment, then aggregate in code.**

This phase should mirror the technical-phase pattern closely so the runtime learns one reusable analysis-phase shape: bounded workers, typed outputs, deterministic aggregator, structured trace.

---

## 7. Implementation Plan

### Phase 5A: Define `FundamentalSignal` and worker schemas — **Done**

Deliverables completed:

- `FundamentalSignal` schema extended in `electron/shared/ai/pipeline-signals.ts` with `catalystScore` added as a derived composite field (`strength × freshness × (1 − contradictionRisk)`) — not in the spec's schema sketch but required for downstream review consumption.
- `EarningsOutput`, `CatalystOutput`, `SentimentOutput` worker schemas defined in `engines/fundamental-aggregator.ts`.
- Explicit null/default semantics: all scored fields `.nullable().default(null)`; `contradictionRisk` defaults to 0.

### Phase 5B: Implement workers and aggregator — **Done**

Deliverables completed:

- `engines/fundamental-aggregator.ts` — `aggregateFundamentalSignal()` with deterministic `catalystScore` derivation; `buildRawSummary()` concatenates per-worker summaries.
- Prompt assets: `fundamental-workers/earnings-context.md` (`get_news` only), `catalyst-context.md` (`get_news` + `search_web`), `sentiment-context.md` (`search_reddit` + `search_web`).
- `fundamental.phase.ts` rewritten: 3 workers in parallel via `runConcurrentGroup(concurrency=3)`; results fed to `aggregateFundamentalSignal`; `assembleAggregateTrace` for persistence.
- `engines/fundamental-aggregator.test.ts` — 5 tests covering earnings/sentiment passthrough, `catalystScore` derivation formula, null on missing inputs, all-absent fallback, and rawSummary content.

### Phase 5C: Wire typed output into orchestrator — **Done**

Deliverables completed:

- `AiFundamentalRun = AgentResult<FundamentalSignal>` added; `AiPipelineResult.fundamental` and `TradeCycleContext.fundamental` updated.
- `runPhase<..., FundamentalSignal>` call updated; validation changed from `.text.trim()` to `.symbol` presence.
- Downstream review/decision phases receive `fundamental.output.rawSummary` as the backward-compat string adapter until Phase 6.

---

## 8. Risk Register

| #   | Risk                                                   | Likelihood | Impact | Mitigation                                                            |
| --- | ------------------------------------------------------ | ---------- | ------ | --------------------------------------------------------------------- |
| 1   | Sentiment and catalyst workers duplicate work          | Medium     | Medium | Keep input/output scope explicit per worker                           |
| 2   | Fundamental evidence varies widely by instrument class | Medium     | High   | Encode null/default cases rather than forcing fabricated confidence   |
| 3   | Temporary review adapter survives too long             | Medium     | Medium | Call it out explicitly in Phase 5 and delete it in Phase 6 acceptance |

---

## 9. Success Criteria

| Goal                              | Metric                                               | Baseline           | Target                                                               | How Measured                      |
| --------------------------------- | ---------------------------------------------------- | ------------------ | -------------------------------------------------------------------- | --------------------------------- |
| Typed fundamental output          | Fundamental phase output shape                       | `{ text: string }` | `FundamentalSignal`                                                  | Schema tests + orchestrator types |
| Narrow workers                    | Worker count in fundamental phase                    | 1                  | 3                                                                    | Phase definition review           |
| Deterministic aggregation         | Aggregation owner                                    | LLM prose          | Code                                                                 | Unit tests                        |
| Review-readiness                  | Downstream contract                                  | Raw prose          | Typed signal available                                               | Code review                       |
| DB-backed research posture wiring | Fundamental posture inferred mainly from prompt text | Transitional       | Research posture and search defaults arrive as typed runtime context | Code review + tests               |

---

## 10. Open Questions

| #   | Question                                                                                                                  | Owner | Needed By       | Status                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ----- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Should `sentiment-context` have direct Reddit/search access in v1, or should it only consume upstream discovery evidence? | Ken   | Before Phase 5B | Resolved: direct access via `search_reddit` + `search_web` per spec table 16.7.                                                                                                                                                         |
| 2   | How should contradiction risk combine multiple weak or conflicting catalyst signals?                                      | Ken   | Before Phase 5B | Resolved: `catalyst-context` worker outputs a single `contradictionRisk` score 0-1; no aggregation needed since it's one worker's judgment. Derived `catalystScore = strength × freshness × (1 − contradictionRisk)` in the aggregator. |

---

## 11. Alternatives Rejected

| Option                                      | Why Rejected                                     |
| ------------------------------------------- | ------------------------------------------------ |
| One fundamental worker with stricter schema | Still centralizes too much reasoning in one call |
| LLM merger for fundamental synthesis        | Conflicts with deterministic aggregation goal    |
