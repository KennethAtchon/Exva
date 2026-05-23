# Cognitive Runtime Phase 2 Selector Cutover — Plan

> **Date:** 2026-05-17
> **Status:** Complete
> **Deciders:** Ken
> **Implements:** `docs/design/cognitive-pipeline-rearchitecture-spec.md` Phase 2
> **Depends on:** `docs/plans/cognitive-runtime-phase-1-redesign-plan.md`
> **Implementation note:** The `SelectorPipeline` dedicated class approach (described in sections 6 and 7) was superseded by the `PipelineDefinition.run` hook approach (resolves Open Question #3). See section 10 for details.

---

## 1. Problem Statement

Phase 1 established the phase-first runtime substrate, but selector behavior is still structurally the old system wearing a new entrypoint. `AiRuntime.runPhase()` and `PipelineRuntime.run()` now route selector execution through `selector.phase.ts`, yet that phase definition still runs one broad `instrument-selector` worker, still depends on `selector-runtime-control.ts` for phase switching and forced submit behavior, and still relies on `parseInstrumentSelection()` in `worker-executor.ts` to turn terminal tool traces into an `InstrumentSelection`. The selector remains prompt-heavy, step-heuristic-driven, and downstream-validated rather than upstream-constructed.

That means the specific 2026-05-17 failure mode is reduced but not eliminated at the architectural level. Selector control still depends on tool-step heuristics, English workflow, and post-hoc filtering in `AgentOrchestrator.validateSelectorOutput()`. The desired Phase 2 end state from the design spec is different: discovery workers produce typed `Candidate` fragments, verification workers enrich those fragments, and deterministic code owns ranking, risk gating, and final `InstrumentSelection` construction.

If Phase 2 is skipped, Exva keeps the weakest part of the old pipeline exactly where the spec said it must change first. The runtime substrate will exist, but the highest-blast-radius phase will still be the least deterministic one.

---

## 2. Goals & Non-Goals

**Goals**

| #   | Goal                                         | Success Looks Like                                                                                                                                  |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Replace single-worker selector behavior      | `selector.phase.ts` no longer defines one broad `instrument-selector` worker as the actual selector implementation                                  |
| 2   | Move selector workflow into code             | Discovery, verification, scoring, risk filtering, and submission are explicit TypeScript steps rather than `selector-runtime-control.ts` heuristics |
| 3   | Introduce typed selector candidate contracts | Discovery and verification workers emit schema-validated `Candidate`-shaped outputs rather than prose or implicit tool traces                       |
| 4   | Make submission deterministic                | Final `InstrumentSelection` is built by code, not by trusting model-authored ranking/output shape                                                   |
| 5   | Preserve the phase-first runtime boundary    | `AgentOrchestrator` still invokes selector through the phase runtime entrypoint rather than reintroducing direct role-specific code                 |
| 6   | Keep selector replayable                     | `docs/hello.json` and the Phase 0 fixtures can run against both the current selector and the new selector pipeline for parity checks                |

**Non-Goals**

| #   | Non-Goal                                                         | Reason                                                                    |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | Cleaning up every old selector surface                           | That is Phase 3 work; Phase 2 is the behavior cutover                     |
| 2   | Rewriting technical, fundamental, review, or decision            | Later phases own those conversions                                        |
| 3   | Shipping per-worker UI controls                                  | v1 continues to expose phase-level config only                            |
| 4   | Eliminating all post-selector orchestrator validation on day one | Some guardrails may remain temporarily until Phase 3 deletes the old path |

---

## 3. Background & Context

### Current selector shape

The current runtime already routes selector through the new substrate, but the implementation is still transitional:

| File                                                                       | Current responsibility                                                                     | Why it matters to Phase 2                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `electron/main/services/llm/pipeline/definitions/selector.phase.ts` | Defines one `instrument-selector` worker with broad tools and terminal-tool output         | Current selector phase entrypoint to replace internally                        |
| `electron/main/services/llm/selector-runtime-control.ts`         | Discovery/verification/commit heuristics, submit forcing, and symbol extraction heuristics | Core old control layer that the new selector pipeline should obsolete          |
| `electron/main/services/llm/pipeline/execution/worker-executor.ts`  | Special-cases selector terminal result via `parseInstrumentSelection()`                    | Shows selector still behaves differently from the target typed-worker pipeline |
| `electron/main/services/orchestration/agent-orchestrator.ts`               | Runs selector, then re-validates output with `validateSelectorOutput()`                    | Downstream filtering is compensating for weak upstream selector guarantees     |
| `electron/main/services/orchestration/selector-definition-hash.ts`         | Includes selector settings in cache/input identity                                         | Must stay correct across the cutover                                           |

### Selector engine work this phase must include

Selector is not just a worker split. It is the first real engine-driven phase. The Phase 2 cutover should explicitly absorb these deterministic surfaces:

| Concern                                       | Current code                                                                                              | Target engine/pipeline owner                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Candidate evidence validation                 | `CandidateValidationService`                                                                              | `candidate-validator` validator engine bound during verification |
| Quote/liquidity/support checks                | orchestrator validation + broker/tool calls                                                               | verification workers + selector `RiskFilter`                     |
| Candidate ranking                             | implicit prompt ranking                                                                                   | selector `ScoringEngine` / transformer engine                    |
| Session strategy constraints                  | `SessionStrategyContextService`, `session_trade_rules`, `session_risk_config`, `session_timeframe_config` | context + policy inputs to selector pipeline                     |
| Broker tradability and assignment constraints | broker routing/assignment services                                                                        | selector risk filter + broker-aware verification                 |

### Selector should be the first real dependency-graph phase

Selector is the best first proof of graph scheduling because its workflow is naturally layered:

- discovery frontier: `web-scout`, `reddit-scout`, `trend-scout`
- deterministic merge barrier: `CandidateMerger`
- verification frontier: `market-validator`, `catalyst-extractor`, `liquidity-gate`
- deterministic finalize barrier: scoring, risk filtering, submission

The key point is that verification workers should not start until discovery output has been merged into a candidate set. That dependency belongs in runtime config, not prompt text.

Selector observability requirements for this phase:

- DevPanel must show discovery workers and verification workers as separate frontiers
- selector trace must show which workers ran in parallel and which were waiting on merge/finalize barriers
- selector failures must distinguish: malformed query, no-progress loop, dependency-blocked, verification failure, and failed-to-submit
- replay output must include frontier-level candidate counts so convergence can be debugged without rereading raw tool transcripts

### Why the transitional selector is not enough

- `selector.phase.ts` still exposes the full broad toolset to one model call.
- `selector-runtime-control.ts` still decides when discovery is "done" using step counts, no-new-info streaks, and symbol heuristics.
- `worker-executor.ts` still has selector-only parsing behavior.
- `validateSelectorOutput()` still rejects candidates after the fact based on quote, discovery-evidence, and strategy checks.

Phase 2 should invert that model. Selector workers should produce typed partial evidence, and selector code should rank and filter before the orchestrator ever sees the final shortlist.

---

## 4. Research Summary

No new external research changed the architecture choice for this phase. Phase 2 inherits the Phase 1 conclusion that Exva should use code-defined workflows with schema-constrained outputs rather than broader autonomous-agent loops.

Sources carried forward from Phase 1:

- [https://openai.com/index/introducing-structured-outputs-in-the-api/](https://openai.com/index/introducing-structured-outputs-in-the-api/)
- [https://sdk.vercel.ai/docs/ai-sdk-core/generating-structured-data](https://sdk.vercel.ai/docs/ai-sdk-core/generating-structured-data)
- [https://www.anthropic.com/engineering/building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents)

---

## 5. Options Considered

**Option A: Keep the current single-worker selector and only tighten prompts**

| Dimension       | Assessment |
| --------------- | ---------- |
| Complexity      | Low        |
| Reliability     | Low        |
| Stack fit       | High       |
| Long-term value | Poor       |

Risks: preserves the exact architectural weakness the spec is trying to remove.

**Option B: Keep one selector worker but move more validation into orchestrator code**

| Dimension       | Assessment |
| --------------- | ---------- |
| Complexity      | Medium     |
| Reliability     | Medium     |
| Stack fit       | Good       |
| Long-term value | Medium-low |

Risks: improves guardrails but still leaves ranking and workflow hidden inside one model call.

**Option C: Build the selector narrow-worker pipeline now**

| Dimension       | Assessment  |
| --------------- | ----------- |
| Complexity      | Medium-high |
| Reliability     | High        |
| Stack fit       | Strong      |
| Long-term value | High        |

Risks: biggest implementation surface in the near term, but it matches the spec and creates the reusable pattern for phases 4-7.

---

## 6. Recommendation

**We recommend Option C: replace the transitional selector with the full narrow-worker selector pipeline while keeping the phase-runtime entrypoint stable.**

This is the first phase where the runtime substrate proves its value. The selector should stop being a special prompt-driven loop and become a pipeline made of worker groups plus deterministic code stages:

- discovery workers produce typed candidate fragments
- candidate merger dedupes and normalizes symbols
- verification workers enrich candidates with quote/news/liquidity evidence
- scoring engine ranks candidates deterministically
- risk filter removes unsupported or weak candidates
- submission builder produces the final `InstrumentSelection`

**As implemented:** Rather than routing to a dedicated `SelectorPipeline` class, the phase-runtime was extended with a `PipelineDefinition.run` hook that lets any phase own its full multi-stage execution. `selector.phase.ts` declares all discovery and verification workers and implements the `run` fn that sequences them. Selector-specific processing utilities (`candidate-merger`, `scoring-engine`, `risk-filter`, `submission-builder`) live in `engines/` as plain modules. The `selector-pipeline/` folder and the hardcoded `if (opts.phase === "selector")` bypass in `pipeline-runtime.ts` are both deleted. See Open Question #3 resolution in section 10.

---

## 7. Implementation Plan

### Phase 2A: Define selector pipeline contracts — **Done**

Deliverables completed:

- `Candidate` schema and shared selector types in `electron/shared/ai/selector-pipeline-candidate.ts`.
- Worker output schemas for discovery (`candidateOutputSchema`) and verification (`verificationOutputSchema`) workers defined in `selector.phase.ts`.
- Discovery worker prompt assets: `selector-workers/web-scout.md`, `reddit-scout.md`, `trend-scout.md`.
- Verification worker prompt assets: `selector-workers/market-validator.md`, `catalyst-extractor.md`, `liquidity-gate.md`.
- Deterministic ranking and submission interfaces defined up front in `engines/selector-scoring-engine.ts` and `engines/selector-submission-builder.ts`.

### Phase 2B: Build selector pipeline internals — **Done**

Deliverables completed:

- `PipelineDefinition.run` hook added to `electron/shared/ai/pipeline-phase.ts` — replaces the planned `SelectorPipeline` class with a hook that keeps everything expressed through the definition.
- `PipelineRunContext` and `PipelineWorkerRunner` interfaces added to `pipeline/core/types.ts`.
- `pipeline/core/concurrent-group-runner.ts` — generic settled-concurrency runner (replaces `worker-group-runner.ts`).
- `engines/selector-candidate-merger.ts` — dedup and score-max merge across discovery workers.
- `engines/selector-scoring-engine.ts` — deterministic weighted scoring.
- `engines/selector-risk-filter.ts` — instrument-class, score, rationale, broker-route, and CandidateValidationService checks.
- `engines/selector-submission-builder.ts` — builds final `InstrumentSelection` from ranked/filtered candidates.
- Discovery workers (`web-scout`, `reddit-scout`, `trend-scout`) and verification workers (`market-validator`, `catalyst-extractor`, `liquidity-gate`) declared in `selector.phase.ts` with full typed schemas.

### Phase 2C: Cut selector phase over to the new pipeline — **Done**

Deliverables completed:

- `selector.phase.ts` now implements `run` fn with full two-stage (discovery → verification) orchestration.
- `pipeline-runtime.ts` dispatches generically via `definition.run` — no more `if (opts.phase === "selector")` hardcoded bypass.
- `selector-pipeline/` folder deleted entirely.
- Selector processing still exposed to `pipeline-runtime.ts` through the `PipelineWorkerRunner` interface injected by the runtime.

### Phase 2D: Dev soak and acceptance closeout — **Pending Phase 3**

Still outstanding:

- Replay suite on all selector fixtures.
- Selector-specific terminal parse branch in `worker-executor.ts:resolveTerminalResult()` is now dead code — cleanup deferred to Phase 3A.
- `selector-runtime-control.ts` is no longer imported by the live selector path but still exists — deferred to Phase 3A.

---

## 8. Risk Register

| #   | Risk                                                                         | Likelihood | Impact | Mitigation                                                                                                 |
| --- | ---------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | Candidate schema is too narrow for prediction-market or event-contract cases | Medium     | High   | Validate both standard and event-contract fixtures before cutover                                          |
| 2   | Old orchestrator validation and new selector risk filtering diverge          | High       | Medium | Port each rejection rule explicitly and compare replay diffs                                               |
| 3   | Worker fan-out increases cost unexpectedly                                   | Medium     | Medium | Enforce per-worker, per-stage, and per-pipeline spend caps from the spec                                   |
| 4   | Trace persistence becomes harder to debug after aggregation                  | Medium     | Medium | Persist worker-level evidence inside structured trace payloads even if `agent_runs` stays phase-aggregated |

---

## 9. Success Criteria

| Goal                                | Metric                                                                  | Baseline                                                   | Target                                                                          | How Measured         |
| ----------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------- |
| Deterministic submission            | Selector always returns `InstrumentSelection` via code-built submission | Transitional selector still depends on tool-terminal parse | 100% deterministic submission path                                              | Unit tests + replay  |
| Removal of selector loop heuristics | Live selector path depends on `selector-runtime-control.ts`             | Yes                                                        | No                                                                              | Grep + code review   |
| Typed candidate flow                | Discovery/verification pass prose or implicit tool traces               | Transitional mixed model                                   | Typed `Candidate` flow only                                                     | Schema tests         |
| Parallel worker execution           | Broad single worker                                                     | 1 worker                                                   | Discovery and verification worker groups run in bounded parallel                | Runtime tests        |
| Engine-backed selector validation   | Candidate constraints enforced ad hoc in orchestrator                   | Mixed                                                      | Selector verification/risk filtering resolved through pipeline engines/services | Replay + code review |
| Replay parity                       | Selector failure mode reproducible only in old path                     | Partial                                                    | New path passes all fixtures with explicit output                               | Replay harness       |

Leading indicators:

- `SelectorPipeline.run()` passes on `docs/hello.json` fixture.
- Candidate scoring is deterministic across repeated runs.
- Submission builder cannot throw for empty, partial, or capped candidate lists.

Lagging indicators:

- Selector no longer needs orchestration-prose prompt tuning to guarantee a valid shortlist.
- Later technical/fundamental phases reuse the same worker-group pattern without new runtime primitives.

---

## 10. Open Questions

| #   | Question                                                                                                                                                     | Owner | Needed By       | Status                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Should selector traces be persisted as one aggregated `agent_run` or one synthetic discovery/verification sub-trace block?                                   | Ken   | Before Phase 2C | Resolved: one aggregated `agent_run` via `assembleAggregateTrace` with discovery at frontier 0 and verification at frontier 1                                                                                                                                                       |
| 2   | Which orchestrator-side rejection rules should remain as defense-in-depth after selector risk filtering ships?                                               | Ken   | Before Phase 2C | Deferred to Phase 3 cleanup                                                                                                                                                                                                                                                         |
| 3   | Does the selector pipeline live as a dedicated class outside `pipeline/definitions`, or as a phase definition with a custom aggregate/finalize path? | Ken   | Before Phase 2B | Resolved: `PipelineDefinition.run` hook in `selector.phase.ts`. Selector utilities live in `engines/selector-*`. No dedicated class or phase-specific folder. The hook approach generalizes to any future phase that needs multi-stage orchestration without creating a new folder. |

---

## 11. Alternatives Rejected

| Option                                                | Why Rejected                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| More prompt tuning on the current selector            | Keeps workflow and ranking in one model call                      |
| Orchestrator-only validation hardening                | Catches bad outputs later instead of preventing them structurally |
| Rewriting selector after technical/fundamental phases | Leaves the highest-risk phase in the old architecture longest     |
