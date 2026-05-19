# Cognitive Runtime Phase 7 Decision and Execution Profile — Plan

> **Date:** 2026-05-17
> **Status:** Complete
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

### Phase 7A: Define `TradeSignal` and `ExecutionProfileEngine` contracts — **Done**

Deliverables completed:

- `TradeSignal` schema already existed in `electron/shared/ai/pipeline-signals.ts` with `symbol`, `action` ("buy"|"sell"|"skip"), `executionStrategy`, `entryPrice`, `confidence`, `reasoning`. No sizing fields.
- `ExecutionProfileInput` and `ExecutionProfile` types defined in `engines/execution-profile-engine.ts`.
- Open question resolved: `entryPrice` optional (nullable default) for all strategies. Phase trace + trade row is sufficient audit trail for the execution profile.

### Phase 7B: Implement typed decision worker — **Done**

Deliverables completed:

- Single `signal-classifier` worker in `definitions/decision.phase.ts`; receives typed `{ technical: TechnicalSignal; fundamental: FundamentalSignal; review: ReviewSignal }` as serialized JSON context — no live tools.
- `decision.md` prompt rewritten: `action` is "buy"/"sell"/"skip" (not "trade"/"no_trade"); `executionStrategy` required; sizing fields explicitly excluded.
- `tradeSignalSchema` used as `outputSchema` (cast with `ZodType<TradeSignal>` per phase pattern).
- `run` hook with single `runner.execute` call and `assembleAggregateTrace`.

### Phase 7C: Implement and wire `ExecutionProfileEngine` — **Done**

Deliverables completed:

- `engines/execution-profile-engine.ts` — pure `computeExecutionProfile()` function; caps position size at `min(maxPositionUsd, maxExposureUsd)` for all instrument classes; prediction-market Kelly removed (data no longer in `TradeSignal`; engine falls back to cap consistently).
- `skip` actions bypass the engine entirely (`{ positionSizeUsd: 0, side: "BUY" }` placeholder on rejected trade).
- `engines/execution-profile-engine.test.ts` — 5 tests covering stock sizing, prediction market cap, cap direction, sell side, futures cap.
- `resolvePositionSizeUsd()` deleted; both `createTradeFromDecision` and `buildTradeFromDecision` call `computeExecutionProfile`.

### Phase 7D: Schema, persistence, and cleanup cutover — **Done**

Deliverables completed:

- `TradeDecision` type removed from `ai-runtime/runtime.ts` and all re-exports (`ai-runtime/index.ts`, `ai/index.ts`).
- `tradeDecisionSchema` export removed from `ai/index.ts`.
- `decision-parse.ts` and `__tests__/decision-parse.test.ts` deleted.
- `DecisionOutput` local type removed from orchestrator; `AiDecisionRun = AgentResult<TradeSignal>`.
- `resolvePredictionTradeFields()` simplified — no longer takes decision output; instrument context is authoritative.
- Action semantics updated: `action === "skip"` (not `!== "trade"`); `waitForApproval` now typed to `TradeSignal`.

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
| 1 | Does `ExecutionProfileEngine` persist a separate audit artifact, or is the final trade row plus phase trace enough? | Ken | Before Phase 7D | Resolved: trade row + phase trace is sufficient. No separate audit artifact. |
| 2 | Should `entryPrice` in `TradeSignal` remain optional for all strategies, or only for a subset? | Ken | Before Phase 7A | Resolved: nullable for all strategies. |

---

## 11. Alternatives Rejected

| Option | Why Rejected |
| --- | --- |
| Clamp AI sizing harder | Still leaves the wrong system boundary |
| One decision worker with no sizing but no execution engine abstraction | Improves safety, but leaves reusable execution math under-modeled |
