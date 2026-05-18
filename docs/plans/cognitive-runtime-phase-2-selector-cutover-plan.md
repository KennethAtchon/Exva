# Cognitive Runtime Phase 2 Selector Cutover — Plan

> **Date:** 2026-05-17
> **Status:** Draft
> **Deciders:** Ken
> **Implements:** `docs/design/cognitive-pipeline-rearchitecture-spec.md` Phase 2
> **Depends on:** `docs/plans/cognitive-runtime-phase-1-redesign-plan.md`

---

## 1. Problem Statement

Phase 1 established the phase-first runtime substrate, but selector behavior is still structurally the old system wearing a new entrypoint. `AiRuntime.runPhase()` and `PipelineRuntime.run()` now route selector execution through `selector.phase.ts`, yet that phase definition still runs one broad `instrument-selector` worker, still depends on `selector-runtime-control.ts` for phase switching and forced submit behavior, and still relies on `parseInstrumentSelection()` in `worker-executor.ts` to turn terminal tool traces into an `InstrumentSelection`. The selector remains prompt-heavy, step-heuristic-driven, and downstream-validated rather than upstream-constructed.

That means the specific 2026-05-17 failure mode is reduced but not eliminated at the architectural level. Selector control still depends on tool-step heuristics, English workflow, and post-hoc filtering in `AgentOrchestrator.validateSelectorOutput()`. The desired Phase 2 end state from the design spec is different: discovery workers produce typed `Candidate` fragments, verification workers enrich those fragments, and deterministic code owns ranking, risk gating, and final `InstrumentSelection` construction.

If Phase 2 is skipped, Exva keeps the weakest part of the old pipeline exactly where the spec said it must change first. The runtime substrate will exist, but the highest-blast-radius phase will still be the least deterministic one.

---

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
| --- | --- | --- |
| 1 | Replace single-worker selector behavior | `selector.phase.ts` no longer defines one broad `instrument-selector` worker as the actual selector implementation |
| 2 | Move selector workflow into code | Discovery, verification, scoring, risk filtering, and submission are explicit TypeScript steps rather than `selector-runtime-control.ts` heuristics |
| 3 | Introduce typed selector candidate contracts | Discovery and verification workers emit schema-validated `Candidate`-shaped outputs rather than prose or implicit tool traces |
| 4 | Make submission deterministic | Final `InstrumentSelection` is built by code, not by trusting model-authored ranking/output shape |
| 5 | Preserve the phase-first runtime boundary | `AgentOrchestrator` still invokes selector through the phase runtime entrypoint rather than reintroducing direct role-specific code |
| 6 | Keep selector replayable | `docs/hello.json` and the Phase 0 fixtures can run against both the current selector and the new selector pipeline for parity checks |

**Non-Goals**

| # | Non-Goal | Reason |
| --- | --- | --- |
| 1 | Cleaning up every old selector surface | That is Phase 3 work; Phase 2 is the behavior cutover |
| 2 | Rewriting technical, fundamental, review, or decision | Later phases own those conversions |
| 3 | Shipping per-worker UI controls | v1 continues to expose phase-level config only |
| 4 | Eliminating all post-selector orchestrator validation on day one | Some guardrails may remain temporarily until Phase 3 deletes the old path |

---

## 3. Background & Context

### Current selector shape

The current runtime already routes selector through the new substrate, but the implementation is still transitional:

| File | Current responsibility | Why it matters to Phase 2 |
| --- | --- | --- |
| `electron/main/services/ai/pipeline-runtime/definitions/selector.phase.ts` | Defines one `instrument-selector` worker with broad tools and terminal-tool output | Current selector phase entrypoint to replace internally |
| `electron/main/services/ai/ai-runtime/selector-runtime-control.ts` | Discovery/verification/commit heuristics, submit forcing, and symbol extraction heuristics | Core old control layer that the new selector pipeline should obsolete |
| `electron/main/services/ai/pipeline-runtime/execution/worker-executor.ts` | Special-cases selector terminal result via `parseInstrumentSelection()` | Shows selector still behaves differently from the target typed-worker pipeline |
| `electron/main/services/orchestration/agent-orchestrator.ts` | Runs selector, then re-validates output with `validateSelectorOutput()` | Downstream filtering is compensating for weak upstream selector guarantees |
| `electron/main/services/orchestration/selector-definition-hash.ts` | Includes selector settings in cache/input identity | Must stay correct across the cutover |

### Selector engine work this phase must include

Selector is not just a worker split. It is the first real engine-driven phase. The Phase 2 cutover should explicitly absorb these deterministic surfaces:

| Concern | Current code | Target engine/pipeline owner |
| --- | --- | --- |
| Candidate evidence validation | `CandidateValidationService` | `candidate-validator` validator engine bound during verification |
| Quote/liquidity/support checks | orchestrator validation + broker/tool calls | verification workers + selector `RiskFilter` |
| Candidate ranking | implicit prompt ranking | selector `ScoringEngine` / transformer engine |
| Session strategy constraints | `SessionStrategyContextService`, `session_trade_rules`, `session_risk_config`, `session_timeframe_config` | context + policy inputs to selector pipeline |
| Broker tradability and assignment constraints | broker routing/assignment services | selector risk filter + broker-aware verification |

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

| Dimension | Assessment |
| --- | --- |
| Complexity | Low |
| Reliability | Low |
| Stack fit | High |
| Long-term value | Poor |

Risks: preserves the exact architectural weakness the spec is trying to remove.

**Option B: Keep one selector worker but move more validation into orchestrator code**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | Medium |
| Stack fit | Good |
| Long-term value | Medium-low |

Risks: improves guardrails but still leaves ranking and workflow hidden inside one model call.

**Option C: Build the selector narrow-worker pipeline now**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium-high |
| Reliability | High |
| Stack fit | Strong |
| Long-term value | High |

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

`AgentOrchestrator` should still think in terms of `runPhase("selector")`, but the selector phase implementation should internally route to a dedicated `SelectorPipeline` rather than a single worker definition.

---

## 7. Implementation Plan

### Phase 2A: Define selector pipeline contracts

Goal: formalize the typed data structures the selector pipeline will use internally.

Done criteria: `Candidate`, `ScoringWeights`, selector worker output schemas, and selector pipeline config exist and are validated at startup.

Deliverables:

- Add `Candidate` schema and shared selector-specific config/types under `electron/shared/ai/`.
- Define worker output schemas for discovery and verification workers.
- Define selector pipeline config for standard and event-contract discovery modes.
- Define selector worker prompt assets under `electron/prompts/selector-workers/`.
- Define deterministic ranking and submission interfaces up front so worker outputs do not leak prose contracts.
- Define the selector engine bindings explicitly: `candidate-validator`, candidate-ranking transformer, and selector `RiskFilter` inputs sourced from `SessionStrategyContextService`, broker routing, broker assignments, and workspace search defaults.

Dependencies: Phase 1 runtime substrate.

Risks: overfitting candidate schema too early and forcing awkward worker outputs.

Rollback plan: revert before cutover; keep transitional selector path intact until Phase 2C.

### Phase 2B: Build selector pipeline internals side-by-side

Goal: implement the worker-group and deterministic selector services without yet removing the current selector phase definition.

Done criteria: a `SelectorPipeline` can run directly in tests and replay harnesses, returning a valid `InstrumentSelection` from fixtures.

Deliverables:

- Implement `SelectorPipeline`, `WorkerGroupRunner`, `CandidateMerger`, `ScoringEngine`, `RiskFilter`, and `SubmissionBuilder`.
- Implement discovery workers: `web-scout`, `reddit-scout`, `trend-scout`.
- Implement verification workers: `market-validator`, `catalyst-extractor`, `liquidity-gate`.
- Model selector scheduling as a dependency graph: discovery workers fan out in parallel, verification workers depend on merged candidates, and deterministic finalize steps run only after both frontiers complete.
- Reuse existing search/broker tool infrastructure through the phase runtime tool registry rather than bespoke selector wiring.
- Bind `CandidateValidationService` through the engine system instead of calling selector validation ad hoc from the orchestrator.
- Make `RiskFilter` read typed session config from `SessionStrategyContextService` and broker capability/allocation state from the existing repos/services rather than relying on prompt-level instructions.
- Emit selector-specific frontier and convergence events so the developer portal can answer why the selector advanced, stalled, retried, or submitted an empty shortlist.
- Add replay/eval coverage for `docs/hello.json` and the sandbox fixtures.

Dependencies: Phase 2A contracts.

Risks: duplicated logic between the transitional selector and the new selector while both exist.

Rollback plan: keep the new pipeline unused by production code until replay is green.

### Phase 2C: Cut selector phase over to the new pipeline

Goal: make the selector phase use the new deterministic pipeline in the live path.

Done criteria: selector execution no longer depends on `selector-runtime-control.ts` or terminal-tool parsing for its main behavior path.

Deliverables:

- Replace the internals behind `runPhase("selector")` so selector work is performed by `SelectorPipeline`.
- Remove selector-only parsing dependence from the live path in `worker-executor.ts`.
- Move existing `validateSelectorOutput()` checks either into selector verification/risk filtering or into a small post-pipeline sanity guard.
- Move selector-stage config reads to one place: runtime phase config from `session_ai_phases`, and business constraints from `SessionStrategyContextService` plus workspace/broker state.
- Keep logs and persisted traces compatible with existing UI expectations.
- Run replay against all fixtures and compare output shape, cost, and candidate quality.

Dependencies: Phase 2B pipeline parity.

Risks: selector traces may become less readable if the aggregation/persistence story is not handled carefully.

Rollback plan: restore the transitional selector implementation behind the same phase entrypoint if replay or live-dev verification fails.

### Phase 2D: Dev soak and acceptance closeout

Goal: prove the selector pipeline is stable before Phase 3 deletes leftover selector legacy code.

Done criteria: replay, unit tests, and dev-session runs all pass with the new selector enabled by default in development.

Deliverables:

- Run the replay suite on all selector fixtures.
- Verify worker prompts stay within lint limits and banned-phrase rules.
- Verify no `isMockSession` branching exists inside selector workers.
- Document any selector behavior deltas that are intentional.

Dependencies: Phase 2C live cutover.

Risks: parity tests focus on output validity but miss quality regressions in candidate selection.

Rollback plan: keep the Phase 2 branch unmerged until fixture and dev-session behavior are acceptable.

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | Candidate schema is too narrow for prediction-market or event-contract cases | Medium | High | Validate both standard and event-contract fixtures before cutover |
| 2 | Old orchestrator validation and new selector risk filtering diverge | High | Medium | Port each rejection rule explicitly and compare replay diffs |
| 3 | Worker fan-out increases cost unexpectedly | Medium | Medium | Enforce per-worker, per-stage, and per-pipeline spend caps from the spec |
| 4 | Trace persistence becomes harder to debug after aggregation | Medium | Medium | Persist worker-level evidence inside structured trace payloads even if `agent_runs` stays phase-aggregated |

---

## 9. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
| --- | --- | --- | --- | --- |
| Deterministic submission | Selector always returns `InstrumentSelection` via code-built submission | Transitional selector still depends on tool-terminal parse | 100% deterministic submission path | Unit tests + replay |
| Removal of selector loop heuristics | Live selector path depends on `selector-runtime-control.ts` | Yes | No | Grep + code review |
| Typed candidate flow | Discovery/verification pass prose or implicit tool traces | Transitional mixed model | Typed `Candidate` flow only | Schema tests |
| Parallel worker execution | Broad single worker | 1 worker | Discovery and verification worker groups run in bounded parallel | Runtime tests |
| Engine-backed selector validation | Candidate constraints enforced ad hoc in orchestrator | Mixed | Selector verification/risk filtering resolved through pipeline engines/services | Replay + code review |
| Replay parity | Selector failure mode reproducible only in old path | Partial | New path passes all fixtures with explicit output | Replay harness |

Leading indicators:

- `SelectorPipeline.run()` passes on `docs/hello.json` fixture.
- Candidate scoring is deterministic across repeated runs.
- Submission builder cannot throw for empty, partial, or capped candidate lists.

Lagging indicators:

- Selector no longer needs orchestration-prose prompt tuning to guarantee a valid shortlist.
- Later technical/fundamental phases reuse the same worker-group pattern without new runtime primitives.

---

## 10. Open Questions

| # | Question | Owner | Needed By | Status |
| --- | --- | --- | --- | --- |
| 1 | Should selector traces be persisted as one aggregated `agent_run` or one synthetic discovery/verification sub-trace block? | Ken | Before Phase 2C | Open |
| 2 | Which orchestrator-side rejection rules should remain as defense-in-depth after selector risk filtering ships? | Ken | Before Phase 2C | Open |
| 3 | Does the selector pipeline live as a dedicated class outside `pipeline-runtime/definitions`, or as a phase definition with a custom aggregate/finalize path? | Ken | Before Phase 2B | Open |

---

## 11. Alternatives Rejected

| Option | Why Rejected |
| --- | --- |
| More prompt tuning on the current selector | Keeps workflow and ranking in one model call |
| Orchestrator-only validation hardening | Catches bad outputs later instead of preventing them structurally |
| Rewriting selector after technical/fundamental phases | Leaves the highest-risk phase in the old architecture longest |
