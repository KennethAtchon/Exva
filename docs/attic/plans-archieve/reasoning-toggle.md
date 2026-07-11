# Reasoning/Thinking Level Toggle — Plan

> **Date:** 2026-05-21
> **Status:** Implemented (2026-05-22)
> **Deciders:** Kenneth Atchon

---

## 1. Problem Statement

Exva has no way to control reasoning depth at runtime. When a user picks Claude claude-sonnet-4-5 or an OpenAI o-series model, the model may support extended thinking or reasoning effort modes — but Exva passes neither parameter, so the model runs at its provider default. This means the user cannot trade higher latency/cost for better analysis on high-stakes phases (e.g. `decision`, `review`) nor reduce cost on cheaper phases (e.g. `selector`). There is also no way to disable thinking on Anthropic models when tool-calling is involved, which causes silent API errors on some model versions because extended thinking and certain tool configurations are mutually exclusive.

The current read-only telemetry in `executeRunAgent` captures `result.reasoningText` and logs it, but there is no upstream control. The gap is entirely on the write path: no field in `SessionAiPhase`, `AgentRunOptions`, `RunAgentExecuteParams`, or the Vercel AI SDK `generateText` call carries a reasoning directive.

If nothing is done, users who pick reasoning-capable models get inconsistent, provider-default behavior with no visibility or control, and the potential for silent API errors when mixing extended thinking with tool use.

---

## 2. Goals & Non-Goals

**Goals**

| #   | Goal                                                                          | Success Looks Like                                                                                                                                  |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Users can set a reasoning level per pipeline phase in the Strategy UI         | The AI Phases section has a "Reasoning" selector (Off / Auto / Low / Medium / High / Max) that persists across sessions                             |
| 2   | The chosen level is translated correctly per provider at call time            | Anthropic gets `providerOptions.anthropic.thinking`, OpenAI gets `providerOptions.openai.reasoningEffort`, OpenRouter gets appropriate pass-through |
| 3   | Non-reasoning models are unaffected                                           | When `reasoningLevel` is `off` or provider/model doesn't support it, zero extra params are sent                                                     |
| 4   | Existing reasoning telemetry (`thinkingText` in `RunTrace`) continues to work | DevPanel thinking block still populated                                                                                                             |

**Non-Goals**

| #   | Non-Goal                                                 | Reason                                                                           |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Per-worker reasoning override (worker-level granularity) | Phase-level is sufficient for v1; worker override can be layered later           |
| 2   | Streaming thinking to the UI in real time                | Read-only log capture is already in place; streaming adds complexity             |
| 3   | Auto-detecting whether a model supports thinking         | User is responsible for pairing a reasoning-capable model with a non-`off` level |
| 4   | Cost-estimation changes for thinking tokens              | Pricing data for thinking tokens is not maintained in `model-pricing.ts` yet     |

---

## 3. Background & Context

### Current data flow

```
UI (AiPhasesSection.tsx)
  → onUpdatePhase(phase, patch)
    → IPC → SessionAiPhasesRepo.upsertPhase()
      → session_ai_phases (SQLite)
        → PhaseConfigResolver.resolveWorkerExecConfig()
          → adapter.runAgent(AgentRunOptions)
            → executeRunAgent(RunAgentExecuteParams)
              → generateText({ ...baseArgs })   ← no providerOptions today
```

### Relevant types (all need extension)

| File                                                          | Type                      | Missing field            |
| ------------------------------------------------------------- | ------------------------- | ------------------------ |
| `electron/shared/ai/pipeline-phase.ts:212`                    | `SessionAiPhase`          | `reasoningLevel`         |
| `electron/shared/ai/pipeline-phase.ts:236`                    | `PhaseRuntimeSummary`     | `reasoningLevel`         |
| `electron/main/services/llm/adapters/provider-adapter.ts:33`  | `AgentRunOptions`         | `reasoningLevel`         |
| `electron/main/services/llm/adapters/run-agent-execute.ts:51` | `RunAgentExecuteParams`   | `reasoningLevel`         |
| `electron/main/db/schema.ts:169`                              | `session_ai_phases` table | `reasoning_level` column |

### SDK capabilities (installed)

**Anthropic (`@ai-sdk/anthropic`)** — `AnthropicProviderOptions.thinking`:

```ts
{ type: "enabled"; budgetTokens?: number }   // explicit budget
{ type: "adaptive" }                          // model decides
{ type: "disabled" }                          // suppress thinking
```

Passed as `providerOptions: { anthropic: { thinking: ... } }` in `generateText`.

**OpenAI (`@ai-sdk/openai`)** — `reasoningEffort` on the per-call model wrapper:

```ts
// line 11, @ai-sdk/openai dist/index.d.ts
reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
```

Passed on the model instance: `client(opts.model, { reasoningEffort: "high" })`.

**OpenRouter** — OpenAI-compat provider; passes `reasoning: { effort }` via `extraBody` or OpenAI `reasoning_effort` in request body. The `@ai-sdk/openai` adapter used for OpenRouter does not forward `reasoningEffort` from model-level options through the OpenRouter base URL by default. Must verify at integration time (see Open Questions).

### Constraint: thinking + tools on Anthropic

Anthropic extended thinking (type `enabled`) is incompatible with parallel tool use. If tools are present and thinking is `enabled`, the adapter must either suppress thinking or pass `disableParallelToolUse: true`. The plan handles this by always using `adaptive` instead of `enabled` when tools are in play (see Option C implementation notes).

---

## 4. Research Summary

**Vercel AI SDK providerOptions**
The `generateText` call accepts `providerOptions?: ProviderOptions` (confirmed in `node_modules/ai/dist/index.d.ts:1099`). This is the correct injection point — it bypasses the SDK abstraction without needing to swap provider clients. Each provider reads its own namespace: `{ anthropic: AnthropicProviderOptions }`, `{ openai: { reasoningEffort } }`. No forking of the Vercel AI SDK is required.
Key insight: `providerOptions` is already wired in `generateText` — the only gap is that Exva's `RunAgentExecuteParams` doesn't carry it downstream to the call site.
Source: https://sdk.vercel.ai/docs/ai-sdk-core/settings#provider-options

**Anthropic extended thinking**
Extended thinking is supported on Claude claude-sonnet-4-5, claude-opus-4-7, and Opus 4.x via `thinking: { type: "enabled", budgetTokens }`. When `type: "adaptive"` the model self-regulates thinking budget. `budgetTokens` caps thinking token spend (minimum 1000, counts toward `maxOutputTokens`). Thinking tokens are billed at standard output rates but not included in `result.usage.outputTokens` on older SDK versions — verify at runtime.
Key insight: `adaptive` is the safest default for tool-using agents; `enabled` with an explicit budget is only appropriate for non-tool phases (e.g. `review`, `decision`).
Source: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking

**OpenAI reasoning effort**
o1, o3, o4-mini, and future o-series models accept `reasoning_effort`. The AI SDK surfaces this as the `reasoningEffort` option on `client(modelId, { reasoningEffort })`. Standard GPT-4o models ignore it. `temperature` must be omitted (or will error) on o-series — Exva already handles this via a model-ID check in the temperature-omission logic. Effort maps to thinking token budget internally; cost is higher at `high`.
Key insight: the option is on the model wrapper, not `generateText`. This means adapters must forward it at model instantiation time, not in `baseArgs`.
Source: https://platform.openai.com/docs/guides/reasoning

**OpenRouter reasoning pass-through**
OpenRouter forwards `reasoning: { effort: "low"|"medium"|"high" }` in the request body for models that support it (DeepSeek-R1, Qwen QwQ, etc). Via the `@ai-sdk/openai` adapter pointing at OpenRouter's base URL, the `reasoningEffort` model-level option may or may not be forwarded depending on SDK version — requires empirical validation. An alternative is `extraBody: { reasoning: { effort } }` which OpenRouter explicitly documents. The Vercel AI SDK `openai` provider supports `extraBody` in model options.
Key insight: OpenRouter's reasoning support is model-dependent and requires a separate `extraBody` path, not the same `reasoningEffort` field used for native OpenAI.
Source: https://openrouter.ai/docs/use-cases/reasoning-tokens

---

## 5. Options Considered

### Option A: Status Quo (Do Nothing)

Users pick a model; reasoning depth is whatever the provider default is. No new fields, no migration.

| Dimension      | Assessment                                                                        |
| -------------- | --------------------------------------------------------------------------------- |
| Complexity     | Zero — nothing to build                                                           |
| Performance    | Unpredictable — depends on provider defaults                                      |
| Reliability    | Risk of silent errors when extended thinking conflicts with tool use on Anthropic |
| Cost           | Unpredictable — thinking tokens billed at output rates                            |
| Reversibility  | N/A                                                                               |
| Stack fit      | N/A                                                                               |
| Team readiness | N/A                                                                               |

Risks: Users who pick Anthropic thinking models get inconsistent output quality and potential API errors with no control path. Likelihood: medium (increases as reasoning models become default). Impact: high (incorrect trade analysis is the core product failure mode).

---

### Option B: Model-name-based auto-detection (no UI toggle)

Infer reasoning settings from the model ID at call time. If the model name contains `thinking`, `o1`, `o3`, `o4`, etc., apply a hardcoded level. No new DB column or UI control.

| Dimension      | Assessment                                                                    |
| -------------- | ----------------------------------------------------------------------------- |
| Complexity     | Low — heuristic in adapters only                                              |
| Performance    | Fixed at "medium" equivalent regardless of phase needs                        |
| Reliability    | Model naming is not stable; breaks on new models or custom OpenRouter aliases |
| Cost           | No user control over spend on thinking tokens                                 |
| Reversibility  | Easy — delete the heuristic                                                   |
| Stack fit      | Inconsistent with Exva's per-phase configuration philosophy                   |
| Team readiness | Simple to implement                                                           |

Risks: Naming heuristics break on provider model renames (e.g. OpenRouter custom paths like `anthropic/claude-3-7-sonnet:thinking`). False positives apply thinking budget to models that don't support it, causing API errors. Likelihood: high over time. Impact: medium.

Open questions: Is there a reliable programmatic way to detect thinking support without an API call per model? Not currently in the installed SDKs.

---

### Option C: Per-phase `reasoningLevel` field (Recommended)

Add a `reasoningLevel` field (`"off" | "auto" | "low" | "medium" | "high" | "max"`) to `SessionAiPhase`, the DB schema, the resolver, `AgentRunOptions`, `RunAgentExecuteParams`, and the UI. Each adapter maps the abstract level to its provider-native form at call time.

| Dimension      | Assessment                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Complexity     | Medium — touches 7 files + 1 migration; no new services                                           |
| Performance    | User-controlled tradeoff; `off` = zero overhead                                                   |
| Reliability    | Explicit; tool-use conflict handled per-adapter                                                   |
| Cost           | Transparent; user sets level knowing it costs more                                                |
| Reversibility  | DB migration adds nullable column with default `"off"` — safe to roll back by ignoring the column |
| Stack fit      | Follows the existing per-phase config pattern exactly                                             |
| Team readiness | All touch-points are well-understood from current work                                            |

Risks:

- **Tool + thinking conflict on Anthropic**: Mitigated by always downgrading to `adaptive` when `tools` are present.
- **OpenRouter reasoning pass-through**: Requires empirical validation; fallback is to log a warning and skip if model doesn't support it. Likelihood: low-medium. Impact: low (silent no-op, not an error).
- **Thinking token cost surprise**: Mitigated by documenting in UI tooltip that non-`off` levels increase token spend.

Open questions:

1. Does `@ai-sdk/openai` forward `reasoningEffort` through to OpenRouter's API or does it need `extraBody`?
2. What is the minimum `budgetTokens` that produces meaningful improvement on Anthropic claude-sonnet-4-5? (Anthropic docs say ≥1000 required; practical minimum for trading analysis is unknown.)

**Mapping table**

| `reasoningLevel` | Anthropic (no tools)                       | Anthropic (with tools) | OpenAI     | OpenRouter             |
| ---------------- | ------------------------------------------ | ---------------------- | ---------- | ---------------------- |
| `off`            | `{ type: "disabled" }`                     | `{ type: "disabled" }` | `"none"`   | omit                   |
| `auto`           | `{ type: "adaptive" }`                     | `{ type: "adaptive" }` | `"low"`    | `{ effort: "low" }`    |
| `low`            | `{ type: "enabled", budgetTokens: 2000 }`  | `{ type: "adaptive" }` | `"low"`    | `{ effort: "low" }`    |
| `medium`         | `{ type: "enabled", budgetTokens: 8000 }`  | `{ type: "adaptive" }` | `"medium"` | `{ effort: "medium" }` |
| `high`           | `{ type: "enabled", budgetTokens: 16000 }` | `{ type: "adaptive" }` | `"high"`   | `{ effort: "high" }`   |
| `max`            | `{ type: "enabled", budgetTokens: 32000 }` | `{ type: "adaptive" }` | `"xhigh"`  | `{ effort: "high" }`   |

Note: `budgetTokens` values are initial starting points, not validated against empirical output quality — adjust after Phase 2 testing.

---

## 6. Recommendation

**We recommend Option C: Per-phase `reasoningLevel` field.**

Over the status quo: Option A leaves Anthropic tool-use conflicts unresolved and gives users no control over a major cost/quality lever. Over Option B: name-based heuristics are brittle and contradict Exva's explicit per-phase configuration model. Option C is the only approach that is both safe (handles the tool conflict) and consistent with how every other phase parameter (temperature, maxTokens, provider, model) is managed.

Key assumptions the recommendation depends on:

1. The Vercel AI SDK `providerOptions` param correctly routes to the underlying provider without additional SDK work — confirmed from type inspection of the installed SDK.
2. Anthropic extended thinking and `adaptive` mode do not require model-ID gating beyond the user's own model selection — correct per Anthropic docs for claude-sonnet-4-5 and above.
3. OpenRouter reasoning pass-through can be handled via `extraBody` if the `reasoningEffort` field doesn't forward — needs empirical validation in Phase 2.

Conditions that would change the recommendation:

- If Vercel AI SDK adds a stable `thinkingBudget` abstraction that maps automatically per provider, adopt that instead of per-adapter mapping.
- If OpenRouter reasoning via `extraBody` produces incorrect behavior, drop OpenRouter reasoning support from v1 and document it as unsupported.

---

## 7. Implementation Plan

### Phase 1: Data layer + type propagation

**Goal:** `reasoningLevel` exists in DB, shared types, repo, resolver, and `AgentRunOptions` / `RunAgentExecuteParams`. No behavioral change yet (adapters don't pass it to the SDK call).

**Done criteria:** TypeScript compiles cleanly with the new field flowing end-to-end; DB migration runs without error; resolver reads the field; `executeRunAgent` accepts but ignores it (logs it only).

**Deliverables:**

- [x] DB migration: add `reasoning_level TEXT NOT NULL DEFAULT 'off'` to `session_ai_phases` (`0001_reasoning_level.sql`)
- [x] Update `electron/main/db/schema.ts` `sessionAiPhases` table
- [x] Add `reasoningLevel: ReasoningLevel` to `SessionAiPhase` and `PhaseRuntimeSummary` in `pipeline-phase.ts`
- [x] Export `ReasoningLevel = "off" | "auto" | "low" | "medium" | "high" | "max"` from `pipeline-phase.ts`
- [x] Update `SessionAiPhasesRepo.toSessionAiPhase`, `upsertPhase`, `upsertPhase.set`
- [x] Add `reasoningLevel` to `ResolvedPhaseExecConfig` and `PhaseConfigResolver.resolvePhaseConfig`
- [x] Add `reasoningLevel?: ReasoningLevel` to `AgentRunOptions` in `provider-adapter.ts`
- [x] Add `reasoningLevel?: ReasoningLevel` to `RunAgentExecuteParams` in `run-agent-execute.ts`
- [x] Log `reasoningLevel` in `execute run agent start` logger call

**Dependencies:** None.

**Rollback:** Revert migration (column is nullable-equivalent via default); revert type changes.

---

### Phase 2: Adapter mapping (provider options)

**Goal:** Each adapter translates `reasoningLevel` to provider-native params and passes them through `providerOptions` to `generateText`.

**Done criteria:** Manual test — pick `claude-3-7-sonnet-thinking` on Anthropic with `reasoningLevel: "medium"`, run a `review` phase cycle, confirm `thinkingText` in DevPanel is non-null and reasoning block length is meaningfully longer than with `off`.

**Deliverables:**

- [x] Create `electron/main/services/llm/adapters/reasoning-options.ts` — exports `buildAnthropicReasoningOptions(level, hasTools)`, `buildOpenAiReasoningOptions(level, modelId)`, `buildOpenRouterReasoningOptions(level)` using the mapping table in §5
- [x] Update `AnthropicAdapter.runAgent` to pass `providerOptions: { anthropic: buildAnthropicReasoningOptions(opts.reasoningLevel, Boolean(opts.tools)) }` when level is not `off`
- [x] Update `executeRunAgent` `baseArgs` to accept and spread `providerOptions`
- [x] Update `OpenAiAdapter.runAgent` to pass `reasoningEffort` via `providerOptions.openai` (see implementation note below)
- [x] Update `OpenRouterAdapter.runAgent` to inject `reasoning: { effort }` into the request body via a custom `fetch` wrapper (see implementation note below)
- [x] Unit test `reasoning-options.ts`: assert correct output for each provider × level × hasTools combination

**Implementation note (2026-05-22):** Installed `@ai-sdk/openai` v2 no longer accepts per-model settings as a second argument to `client(modelId)`. OpenAI reasoning effort is passed through `providerOptions.openai.reasoningEffort` on the `generateText` call instead. OpenRouter `extraBody` is likewise unavailable on the model wrapper; reasoning is merged into the JSON POST body via a scoped `fetch` middleware in `OpenRouterAdapter.createClient`.

**Dependencies:** Phase 1 complete.

**Risks in this phase:** Anthropic tool-conflict error if the mapping table is wrong. Detection: integration test with tools present on a thinking model. Rollback: return `null` from `buildAnthropicReasoningOptions` (passes nothing to SDK).

---

### Phase 3: UI

**Goal:** `AiPhasesSection.tsx` renders a "Reasoning" select per phase card. User changes persist via `onUpdatePhase`.

**Done criteria:** UI smoke test — change `review` phase reasoning from Off to High, reload the page, confirm the value is retained.

**Deliverables:**

- [x] Add `REASONING_LEVEL_OPTIONS` array (`{ value, label }`) to `AiPhasesSection.tsx`
- [x] Render a `ShadcnSelect` for `reasoningLevel` in `PhaseCard` below the temperature/maxTokens row
- [x] Include a tooltip or sub-label: "Non-off levels increase token spend. Pair with a reasoning-capable model."
- [x] Verify `onUpdatePhase({ reasoningLevel })` reaches `PhaseRuntimeSummary` and IPC without type errors
- [x] Update IPC validation schema (`strategyAiPhaseSaveSchema`) to include `reasoningLevel` in `upsertPhase` patch

**Dependencies:** Phase 1 (types must exist for TSC to pass).

**Rollback:** Remove UI control; default remains `"off"` so all existing sessions are unaffected.

---

## 8. Risk Register

| #   | Risk                                                                  | Likelihood | Impact | Mitigation                                                              |
| --- | --------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------- |
| 1   | Anthropic API rejects `thinking: enabled` + tools in same call        | Medium     | High   | Always use `adaptive` when `tools` is non-empty (see mapping table)     |
| 2   | OpenRouter does not forward `extraBody.reasoning` to underlying model | Medium     | Low    | Log warning, pass nothing; document as unsupported in v1                |
| 3   | `budgetTokens` values in mapping table are too low for useful output  | Medium     | Medium | Phase 2 manual test; tune values before Phase 3 ships                   |
| 4   | Thinking tokens push output past `maxTokens` cap, truncating response | Low        | Medium | Document in UI; user can raise `maxTokens` alongside reasoning level    |
| 5   | DB migration on existing data loses rows (STRICT mode conflict)       | Low        | High   | Migration only adds a column with DEFAULT; no existing rows are touched |

---

## 9. Success Criteria

| Goal                                 | Metric                                                   | Baseline          | Target                             | How Measured                     |
| ------------------------------------ | -------------------------------------------------------- | ----------------- | ---------------------------------- | -------------------------------- |
| Reasoning control works on Anthropic | `thinkingText` non-null in RunTrace when level ≥ `low`   | Always null today | Non-null on thinking-capable model | DevPanel inspection              |
| Reasoning control works on OpenAI    | o-series call includes `reasoning_effort` in API request | Never sent        | Sent when level ≠ `off`            | Network log in Electron devtools |
| Off level = no change vs today       | RunTrace identical to current behavior when `off`        | N/A               | Zero diff in trace fields          | Unit test assertion              |
| UI persists across reload            | Phase reasoning level survives app restart               | N/A               | Value retained                     | Manual smoke test                |

**Leading indicator:** Phase 1 TypeScript compiles cleanly with zero `any` suppressions added.

**Lagging indicator:** `review` and `decision` phase analysis quality improves on complex setups when switching from `off` to `medium` — subjective, measured by user evaluation over multiple sessions.

---

## 10. Open Questions

| #   | Question                                                                                                         | Owner   | Needed By     | Status                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------- | ------------- | ------------------------------------------------------------------------------ |
| 1   | Does `@ai-sdk/openai` forward `reasoningEffort` through to OpenRouter's API, or does it require `extraBody`?     | Kenneth | Phase 2 start | Open — requires a live test call to OpenRouter with a DeepSeek-R1 or QwQ model |
| 2   | What `budgetTokens` value produces a measurable improvement in Anthropic trading-analysis output vs `adaptive`?  | Kenneth | Phase 2 done  | Open — needs empirical testing on `review` phase workloads                     |
| 3   | Does `result.usage.outputTokens` include thinking tokens in the installed `@ai-sdk/anthropic` version?           | Kenneth | Phase 2 start | Open — affects cost tracking accuracy                                          |
| 4   | Should `reasoningLevel` be part of worker-level override (`SessionAiPhaseWorker`) in v1 or strictly phase-level? | Kenneth | Phase 1 start | Deferred to v2 per Non-Goals — document decision                               |

---

## 11. Alternatives Rejected

| Option                                      | Why Rejected                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Model-name heuristics (Option B)            | Brittle against OpenRouter custom model paths; no user control; contradicts per-phase config philosophy    |
| Status quo (Option A)                       | Leaves Anthropic tool-conflict risk unresolved; no cost/quality control for reasoning models               |
| Worker-level granularity in v1              | Adds UI and DB complexity disproportionate to v1 value; phase-level is sufficient for the primary use case |
| `thinkingBudgetTokens` as raw integer in UI | Too low-level; requires users to understand provider internals; abstract levels are safer UX               |
