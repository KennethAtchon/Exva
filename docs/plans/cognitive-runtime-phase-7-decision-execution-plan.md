# Cognitive Runtime Phase 7 Decision and Execution Profile — Plan

> **Date:** 2026-05-17
> **Status:** Draft
> **Deciders:** Ken
> **Implements:** `docs/design/cognitive-pipeline-rearchitecture-spec.md` Phase 7
> **Depends on:** `docs/plans/cognitive-runtime-phase-6-review-pipeline-plan.md`

---

## 1. Problem Statement

The current decision phase is still the old architecture in its most operationally sensitive form. `decision.phase.ts` uses `tradeDecisionSchema` as the worker output contract, and `tradeDecisionSchema` still includes AI-authored sizing fields. `AgentOrchestrator.runAiPipeline()` passes raw review text into decision, and `AgentOrchestrator.resolvePositionSizeUsd()` still contains special-case execution math, including prediction-market Kelly sizing. In other words: the system already has a phase runtime, but the model is still being trusted with execution-level values that should belong to deterministic code.

Phase 7 is where the architecture delivers its most important product guarantee: AI chooses direction and strategy posture; code owns size, stop loss, take profit, and order construction. Until this phase lands, the pipeline rewrite remains incomplete from a risk-control perspective.

---

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
| --- | --- | --- |
| 1 | Replace AI-authored trade decision schema with typed `TradeSignal` | Decision outputs action, confidence, reasoning, and execution strategy only |
| 2 | Make decision consume typed upstream signals | Decision receives `TechnicalSignal`, `FundamentalSignal`, and `ReviewSignal` |
| 3 | Introduce deterministic `ExecutionProfileEngine` | Size, stop loss, take profit, and order type come from code |
| 4 | Move all position-sizing logic out of orchestrator | `resolvePositionSizeUsd()` is deleted |
| 5 | Persist execution strategy explicitly | Trade records carry `executionStrategy` for audit and downstream analysis |

**Non-Goals**

| # | Non-Goal | Reason |
| --- | --- | --- |
| 1 | Full trade lifecycle/exit automation redesign | Separate workstream |
| 2 | Per-trade custom risk-policy UI | Not required for the architectural cutover |
| 3 | Regime-aware execution strategy selection | Out of scope for v1 |

---

## 3. Background & Context

| File | Current responsibility | Gap |
| --- | --- | --- |
| `electron/main/services/ai/pipeline-runtime/definitions/decision.phase.ts` | One decision worker returning `tradeDecisionSchema` | Schema still includes execution-math fields |
| `src/lib/schemas.ts` | Defines `tradeDecisionSchema` | Wrong boundary for the new architecture |
| `electron/main/services/orchestration/agent-orchestrator.ts` | Calls decision phase with review text and computes sizing in `resolvePositionSizeUsd()` | Execution logic split between AI and orchestrator |
| `electron/main/services/ai/ai-runtime/decision-parse.ts` | Legacy decision parsing helper | Likely obsolete once decision is fully typed and phase-native |
| `electron/main/services/risk/risk-engine.ts` | Session/trade gating logic | Must become explicit policy-engine input, not ad hoc orchestrator dependency |
| `electron/main/services/orchestration/order-policy-gate.ts` | Placement policy gate | Must be modeled as a first-class policy engine |
| `electron/main/services/risk/broker-allocation-gate.ts` | Broker allocation + conflict gating | Must be part of execution-time engine story |
| `electron/main/services/risk/exit-policy-evaluator.ts` | Exit/lifecycle logic | Must be connected to the same engine system and DB-backed risk/timeframe config |

The prediction-market path is especially important here because it already contains deterministic Kelly-style sizing logic. Phase 7 should generalize that idea into a first-class execution-profile engine rather than leaving it embedded in orchestrator code.

### Engine and config wiring required in this phase

Phase 7 is where the engine system stops being mostly context/aggregation and becomes the actual execution-control layer.

| Engine concern | Current source | Target owner |
| --- | --- | --- |
| AI signal classification | decision worker | `TradeSignal` phase output |
| Position sizing and stop/TP math | `resolvePositionSizeUsd()` + AI sizing fields | `execution-profile` execution engine |
| Confidence/exposure gating | `RiskEngine.validateDecision()` | `risk-gate` policy engine |
| Price/spread/idempotency/broker policy checks | `OrderPolicyGate` | `order-policy` policy engine |
| Broker allocation and cross-session symbol conflicts | `BrokerAllocationGate` | `broker-allocation` policy engine |
| Exit behavior for open positions | `ExitPolicyEvaluator`, `TradeMonitor`, `PositionManagerService` | lifecycle-engine path backed by the same DB config |
| Config source | `session_risk_config`, `session_trade_rules`, `session_timeframe_config`, `workspace_preferences`, broker assignments/routing | typed engine context only |

---

## 4. Research Summary

No new external research changed the architecture decision. This phase applies the Phase 1 structured-output and code-owned-execution boundary to the final AI phase in the pipeline.

---

## 5. Options Considered

**Option A: Keep `tradeDecisionSchema` and just clamp AI sizing harder in code**

| Dimension | Assessment |
| --- | --- |
| Complexity | Low |
| Reliability | Low |
| Long-term value | Poor |

**Option B: Keep one decision worker but move size/stop/TP to code**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Reliability | Medium-high |
| Long-term value | Medium |

**Option C: Convert decision to `TradeSignal` plus deterministic `ExecutionProfileEngine`**

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium-high |
| Reliability | High |
| Long-term value | High |

---

## 6. Recommendation

**We recommend Option C: split decision into AI-authored `TradeSignal` and code-authored `ExecutionProfile`, then delete orchestrator-owned sizing helpers.**

This is the clean architectural boundary the spec calls for. The decision worker remains useful for market judgment, but deterministic financial math leaves the model boundary entirely.

---

## 7. Implementation Plan

### Phase 7A: Define `TradeSignal` and `ExecutionProfileEngine` contracts

Goal: make the AI/code boundary explicit.

Done criteria: `TradeSignal` schema exists without sizing fields, and `ExecutionProfileEngine` has a stable typed interface.

Deliverables:

- Add shared `TradeSignal` schema and execution-strategy enum.
- Define execution-profile input/output types.
- Define how `ReviewSignal.recommendation` influences allowed decision outcomes.
- Define policy-engine contracts for `risk-gate`, `order-policy`, and `broker-allocation`, including which DB-backed config and broker snapshots each consumes.
- Define lifecycle-engine contracts for exit policy so post-entry risk behavior is part of the same engine model rather than a separate architecture.

Dependencies: typed review output from Phase 6.

Risks: too much strategy logic may leak into the AI signal if the boundary is not explicit.

Rollback plan: revert before wiring if the contract is incomplete.

### Phase 7B: Implement typed decision workers and aggregator

Goal: replace the current decision worker contract.

Done criteria: decision phase produces `TradeSignal` from typed upstream signals.

Deliverables:

- Implement `DecisionPipeline` workers such as `signal-classifier` and `entry-timer`.
- Replace `tradeDecisionSchema` in the decision phase definition with `TradeSignal`.
- Register `decision-validator` as an explicit validator engine instead of burying post-processing in orchestrator code.
- Add deterministic decision aggregation/finalization tests.

Dependencies: Phase 7A contract.

Risks: decision prompts may still try to infer sizing unless the output contract is tightly constrained.

Rollback plan: keep current decision definition until the new one passes tests.

### Phase 7C: Implement and wire `ExecutionProfileEngine`

Goal: move all execution math into deterministic code.

Done criteria: size, stop loss, take profit, and order shape are computed by `ExecutionProfileEngine` alone.

Deliverables:

- Implement `ExecutionProfileEngine` as a pure service.
- Move prediction-market Kelly logic out of `resolvePositionSizeUsd()` into the engine.
- Replace orchestrator sizing calls with engine invocation.
- Ensure `skip` actions never call the execution engine for live order construction.
- Bind `RiskEngine`, `OrderPolicyGate`, and `BrokerAllocationGate` through engine interfaces so placement-time checks read canonical config from `SessionStrategyContextService`, workspace prefs, broker assignments, and quote snapshots.
- Define the engine-call order explicitly: `TradeSignal` -> `execution-profile` -> `risk-gate` -> `order-policy` -> `broker-allocation` -> broker submission.

Dependencies: Phase 7B `TradeSignal` output.

Risks: execution-profile logic may need instrument-class-specific branches that are easy to under-specify.

Rollback plan: revert engine wiring if risk-profile parity is not acceptable.

### Phase 7D: Schema, persistence, and cleanup cutover

Goal: finish the boundary change in types and storage.

Done criteria: AI-authored trade decisions no longer include size/stop/TP, and new trades persist `executionStrategy`.

Deliverables:

- Remove `sizeUsd`, `stopLossPct`, and `takeProfitPct` from the AI-authored decision schema.
- Add `executionStrategy` persistence where required.
- Delete `resolvePositionSizeUsd()`.
- Delete or repurpose legacy decision parsing helpers.
- Ensure `TradeMonitor` and `PositionManagerService` are pointed at the lifecycle-engine path for exit-policy evaluation so execution and post-entry management share the same risk/timeframe config source.

Dependencies: Phase 7C engine wiring.

Risks: reporting/UI surfaces may still assume the old decision schema shape.

Rollback plan: revert the schema/storage cutover commit if downstream consumers are missed.

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | Execution-profile rules are underspecified for one or more instrument classes | Medium | High | Cover stock, crypto, futures, and prediction-market fixtures explicitly |
| 2 | Downstream consumers still expect `tradeDecisionSchema` sizing fields | High | Medium | Audit all schema consumers before removal |
| 3 | Review recommendation and decision action semantics conflict | Medium | Medium | Encode explicit decision constraints from review recommendation |

---

## 9. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
| --- | --- | --- | --- | --- |
| Remove AI-authored execution math | AI decision schema fields | Includes size/stop/TP | Excludes them | Schema review |
| Centralize sizing logic | `resolvePositionSizeUsd()` owner | Orchestrator | Deleted; engine-owned | Grep |
| Typed decision input | Decision input contract | Strings | `TechnicalSignal` + `FundamentalSignal` + `ReviewSignal` | Types + code review |
| Persist execution strategy | Trade storage | Implicit/absent | Explicit field | Schema + integration test |
| Engine-owned placement controls | Risk/order/allocation gates called ad hoc from orchestrator | Mixed | Explicit engine-backed execution path using DB-backed session/workspace/broker config | Integration tests + code review |

---

## 10. Open Questions

| # | Question | Owner | Needed By | Status |
| --- | --- | --- | --- | --- |
| 1 | Does `ExecutionProfileEngine` persist a separate audit artifact, or is the final trade row plus phase trace enough? | Ken | Before Phase 7D | Open |
| 2 | Should `entryPrice` in `TradeSignal` remain optional for all strategies, or only for a subset? | Ken | Before Phase 7A | Open |

---

## 11. Alternatives Rejected

| Option | Why Rejected |
| --- | --- |
| Clamp AI sizing harder | Still leaves the wrong system boundary |
| One decision worker with no sizing but no execution engine abstraction | Improves safety, but leaves reusable execution math under-modeled |
