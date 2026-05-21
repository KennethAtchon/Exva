# Worker Output via Configurable Terminal Tool — Plan

> **Date:** 2026-05-20
> **Status:** Draft
> **Deciders:** Ken

## 1. Problem Statement

Exva's pipeline workers communicate their output contract to the model in two incompatible, partly-broken ways. For `outputMode: "object"` workers (e.g. selector verification workers `market-validator`, `catalyst-extractor`, `liquidity-gate` in `plan/plans/selector/plan.ts`), the output shape is declared three times: as a Zod `outputSchema` on the `WorkerDefinition`, as `experimental_output: Output.object({ schema })` in `run-agent-execute.ts:319`, and as hand-written `Return JSON: { ... }` prose inside the prompt markdown (`prompts/selector-workers/web-scout.md:12-26`). The prose duplicates the schema and drifts from it with no compiler or test catching the divergence. For `outputMode: "tool_terminal"` workers (selector discovery), output is collected through a single hardcoded `submit_candidates` tool wired into `context/tool-factory-registry.ts:84-95`, `SUPPORTED_TOOL_IDS`, and `HarnessToolAvailability` — a bespoke construct that only fits the instrument-selection shape and cannot be reused by other workers.

The deeper problem is that the `object` path is a known-unreliable combination in the Vercel AI SDK we depend on. When `generateText` is given both `experimental_output` (structured output / JSON response format) and `tools`, the SDK and several providers either ignore the tools ("JSON response format does not support tools. The provided tools are ignored"), throw `NoOutputGeneratedError`, or — specifically for Anthropic, our primary adapter — refuse to call the tools at all. Every `object` worker in the codebase that also declares `tools` plus a `toolRequirements` gate is sitting on this fault line: if structured output suppresses tool calls, `enforceWorkerToolRequirements` (`execution/worker-tool-requirements.ts:32`) throws `VALIDATION_FAILED`. This is a latent correctness bug, not just an aesthetic one.

If nothing changes, every new worker copies the prose-schema anti-pattern, the schema/prose drift continues to silently corrupt outputs, the `object`+tools path stays exposed to provider-dependent breakage, and each new terminal output shape requires another hardcoded tool like `submit_candidates`.

## 2. Goals & Non-Goals

**Goals**

| #   | Goal                                                                         | Success Looks Like                                                                                                         |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Single source of truth for worker output shape                               | Output shape is defined once, as a Zod schema on the worker config; no `Return JSON` prose in prompts.                     |
| 2   | One generic, runtime-configured terminal tool replaces all output mechanisms | A single tool (e.g. `submit_result`) is built per-worker from that worker's output schema; `submit_candidates` is deleted. |
| 3   | Avoid the SDK structured-output + tools incompatibility                      | Workers that use tools obtain structured output through the terminal tool call, not `experimental_output`.                 |
| 4   | Standardize terminal-tool behavior across all phases                         | Every worker terminates and yields output through the same code path and validation, regardless of phase.                  |
| 5   | Keep the change configurable and scalable                                    | Adding a new worker requires only a schema + description in config; no edits to the tool registry or executor.             |

**Non-Goals**

| #   | Non-Goal                                                                      | Reason                                                                          |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Rewriting the data/evidence tools (`search_web`, `get_quote`, etc.)           | They are orthogonal; only the _output_ mechanism is in scope.                   |
| 2   | Changing prompt strategy-context rendering (`<trusted_strategy_facts>`, etc.) | Covered by the separate strategy-semantic-context plan; do not let it creep in. |
| 3   | Changing the aggregation / scoring / risk-filter engines                      | They consume parsed output objects; the contract they receive is unchanged.     |
| 4   | Replacing the AI SDK or provider adapters                                     | Out of scope; the fix lives above the adapter boundary.                         |

## 3. Background & Context

Execution flow today (`execution/worker-executor.ts`):

1. `buildPromptEnvelope` + `envelopeToMessages` build the system/user messages from `worker.promptAssetPath` markdown.
2. `buildToolSet` (`context/tool-factory-registry.ts`) builds the `ToolSet` from `worker.tools` plus an optional `terminalToolNames` list.
3. `adapter.runAgent({ ..., schema, terminalToolNames, ... })` calls `executeRunAgent` (`adapters/run-agent-execute.ts`), which:
   - adds a `hasToolCall(name)` stop condition for each terminal tool name (line 237-239),
   - if `schema` is set, calls `generateText` with `experimental_output: Output.object({ schema })` (line 316-321).
4. Output resolution branches on `worker.outputMode` (`worker-executor.ts:196-251`):
   - `object` → `resolveStructuredWorkerOutput` validates `trace.structuredOutput` against the contract, with `retry_once` / `substitute_empty` fallback.
   - `tool_terminal` → `resolveTerminalResult` returns the first tool call's parsed `resultJson`.
   - `text` → `{ text: assistantText }`.

Key types: `WorkerDefinition` (`electron/shared/ai/pipeline-phase.ts:69`) carries `outputMode`, `outputSchema`, `tools`, `toolConfig`, `toolRequirements`. `WorkerOutputContract` (`core/types.ts:13`) carries `schema` + `onValidationFailure`. `WorkerToolConfig` (`electron/shared/ai/pipeline-config.ts:36`) is the existing per-worker tool configuration object — currently only `search_web` binding — and is the natural home for output-tool configuration.

Constraints that cannot change in this plan: the engines downstream (`selector-candidate-merger`, `selector-scoring-engine`, etc.) expect the same parsed object shapes; the persisted trace format (`assembleTrace`, `tool_calls_json`) is consumed by `parseWorkerToolTrace` and the UI; provider adapters expose a fixed `runAgent` signature.

Prior related work: `docs/plans/worker-strategy-semantic-context-plan.md` already removed the legacy undeclared-worker prompt path and made `strategyContext` a required declared field — establishing the precedent that worker I/O contracts should be declared in config, not free text. This plan extends that precedent from _input_ context to _output_ contract.

## 4. Research Summary

**AI SDK `experimental_output` + tools incompatibility (the forcing function)**
The Vercel AI SDK `generateText` does not reliably support `experimental_output` (`Output.object`) together with `tools`. Reported behaviors include the tools being silently dropped with the warning "JSON response format does not support tools," `NoOutputGeneratedError`/`NoObjectGenerated` when a tool has no `execute` or when `stopWhen` is used, provider errors like "json mode cannot be combined with tool/function calling," and Anthropic models specifically not calling tools when structured output is forced. Support is model-dependent (some Gemini/OpenAI minis work; Anthropic does not). Key insight: our `object`+tools workers are relying on a path the SDK does not guarantee, and on our primary provider it can suppress the very tool calls that `toolRequirements` then demands — a built-in contradiction. This is the strongest argument for moving output off `experimental_output` and onto a tool call.

- https://github.com/vercel/ai/issues/8354
- https://github.com/vercel/ai/issues/10235
- https://github.com/vercel/ai/issues/8009
- https://community.vercel.com/t/vercel-ai-sdk-structured-output-and-toolchoice-compatibility-limitations/35095

**The "answer tool" / tool-as-output pattern**
Tool calling is itself a constrained form of structured output: the model's arguments must conform to the tool's JSON schema, enforced by the same constrained-decoding machinery providers use for JSON mode. A widely-used pattern is to give the agent a dedicated terminal "answer"/"submit" tool whose input schema _is_ the desired output shape; the agent calls it to finish. This solves invalid-JSON problems, works uniformly across providers (no JSON-mode/tools conflict), and scales cleanly to many tools. The trade-off is marginally higher latency and that the schema must be expressed as a tool input schema. Key insight: this is exactly what `submit_candidates` already does for one shape — the plan is to generalize it, driven by config, to every worker.

- https://medium.com/@virtualik/structured-output-as-a-full-replacement-for-function-calling-430bf98be686
- https://agenta.ai/blog/the-guide-to-structured-outputs-and-function-calling-with-llms
- https://www.promptingguide.ai/agents/function-calling

**Schema-as-tool-description / single-source-of-truth**
Zod schemas convert directly to JSON Schema, and the AI SDK's `tool({ inputSchema })` surfaces that schema (plus an optional `.describe()` per field and a tool `description`) to the model as the authoritative contract. Field-level descriptions on the Zod schema replace hand-written prose. Key insight: once the schema drives the tool, the prompt only needs _behavioral_ instructions ("call `search_web` first; don't invent symbols"), never shape instructions — eliminating drift by construction. Researched but not load-bearing: `generateObject` as an alternative; rejected because it does not support a tool loop at all, so it cannot serve workers that must gather evidence before answering.

## 5. Options Considered

### Option A: Status quo — keep `object` (`experimental_output`) + bespoke `submit_candidates`

Leave both mechanisms. Prompts keep hand-written JSON blocks; verification workers keep `outputMode: "object"` with tools.

| Dimension      | Assessment                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Complexity     | None to build; ongoing cost in drift and special-casing                                          |
| Performance    | Fine when it works                                                                               |
| Reliability    | Poor: `object`+tools is provider-dependent and broken on Anthropic; schema/prose drift is silent |
| Cost           | Hidden cost: every new worker re-implements prose; debugging flaky structured output             |
| Reversibility  | N/A                                                                                              |
| Stack fit      | Already in place                                                                                 |
| Team readiness | Already understood                                                                               |

Risks: latent `VALIDATION_FAILED` from suppressed tool calls (high likelihood on Anthropic, high impact — phase fails). Drift between prose and schema produces wrong outputs that pass validation (medium likelihood, high impact).

Open questions: are the `object`+tools verification workers currently passing only because of `substitute_empty` masking failures? Must be checked.

### Option B: Minimal — strip prose only, keep `experimental_output`

Delete the `Return JSON` blocks from prompts and rely on `outputSchema` + `experimental_output`. Generate any needed shape hints from the Zod schema.

| Dimension      | Assessment                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Complexity     | Low                                                                                             |
| Performance    | Same                                                                                            |
| Reliability    | Fixes drift, but does **not** fix the SDK `object`+tools incompatibility — the core bug remains |
| Cost           | Low                                                                                             |
| Reversibility  | Easy                                                                                            |
| Stack fit      | Good                                                                                            |
| Team readiness | Trivial                                                                                         |

Risks: leaves the Anthropic tool-suppression bug fully in place (high likelihood, high impact). Does not address `submit_candidates` non-reuse.

Open questions: none material — its ceiling is too low because it ignores the forcing function.

### Option C (Recommended): One runtime-configured terminal output tool for all workers

Introduce a single generic terminal tool, `submit_result`. Its `inputSchema` is set **at build time, per worker**, to that worker's output Zod schema; its `description` comes from worker config. `buildToolSet` always appends this tool (configured from `worker.output`) and always registers it as the terminal/stop tool. The worker "returns" by calling `submit_result(...)`; the executor reads the validated tool input as the output. `outputMode` collapses to effectively one path (terminal tool); `experimental_output` is no longer used for workers that have tools. `submit_candidates` and the `tool_terminal`/`object` divergence are deleted. Output-shape prose is removed from prompts; prompts keep only behavioral instructions. Configuration lives on the worker definition (schema + tool description + validation policy), so a new worker needs zero registry/executor edits.

| Dimension      | Assessment                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Complexity     | Moderate one-time refactor; much simpler steady state                                                                           |
| Performance    | One extra tool call to finish (negligible vs. multi-step research loops)                                                        |
| Reliability    | High: sidesteps the SDK `object`+tools conflict; provider-uniform; schema is the single contract validated on the tool boundary |
| Cost           | Up-front engineering; ongoing cost drops sharply                                                                                |
| Reversibility  | Moderate — touches executor, registry, every worker def and prompt; phased rollout keeps each step reversible                   |
| Stack fit      | Strong: generalizes the existing `submit_candidates` + `terminalToolNames` machinery already in the codebase                    |
| Team readiness | High — pattern already present in one place                                                                                     |

Risks: a worker could end the loop (hit `maxSteps`/spend cap) without ever calling `submit_result`, yielding no output — must define explicit "no terminal call" handling (medium likelihood, medium impact). Very large/nested schemas as tool input may degrade some models — mitigate by keeping output schemas flat, as they already are.

Open questions: should `text`-mode workers (free-form, no schema) also route through the tool, or keep returning `assistantText`? Recommended: keep a thin `text` path for genuinely unstructured workers; everything with a schema uses `submit_result`.

## 6. Recommendation

**We recommend Option C: a single runtime-configured `submit_result` terminal tool for all schema-bearing workers.**

Over the status quo (A): it removes the silent schema/prose drift and, decisively, fixes the AI SDK `experimental_output` + tools incompatibility that currently threatens every `object`-mode worker that also calls tools — a real, provider-dependent bug on our primary Anthropic adapter, not a hypothetical. Over the minimal option (B): B leaves that exact bug in place; stripping prose without moving output off `experimental_output` treats the symptom and not the cause. Over keeping `submit_candidates` bespoke: C reuses the same proven stop-tool machinery (`hasToolCall`, `terminalToolNames`) but parameterizes it, so the tool registry stops growing one hardcoded tool per output shape.

Key assumptions the recommendation depends on: (1) the AI SDK reliably supports a tool whose `inputSchema` is set at build time and that has an `execute` returning its validated input — this is the existing `submit_candidates` mechanism, already working; (2) downstream engines can consume the validated tool-input object unchanged (they consume the same shapes today). Conditions that would change the recommendation: if a future AI SDK release makes `experimental_output` + tools robust across providers including Anthropic, Option B's ceiling rises and the cost/benefit narrows — but C's single-mechanism simplification still stands on its own.

## 7. Implementation Plan

**Phase 0: Validate the forcing function**

Goal: confirm whether `object`+tools workers are actually broken or merely masked. Done when: a focused test/log run shows whether `market-validator` (Anthropic) calls its required tools when `experimental_output` is active.

- [ ] Add a temporary assertion/log in `run-agent-execute.ts` recording whether tool calls occurred when `schema` is set.
- [ ] Run selector verification against the Anthropic adapter (or inspect existing traces in `docs/hello.json`).
- [ ] Record finding in this doc.
      Dependencies: none. Risks: hard to repro without provider creds — fall back to documented SDK behavior. Rollback: delete the temporary logging.

**Phase 1: Introduce the configurable terminal output tool (additive, behind existing modes)**

Goal: build `submit_result` from worker config without removing old paths. Done when: a new worker can opt into terminal-tool output and it works end to end.

- [ ] Add an `output` config block to `WorkerToolConfig`/`WorkerDefinition`: `{ toolName?: string; description: string; schema: ZodType; onValidationFailure }`. Default `toolName = "submit_result"`.
- [ ] In `buildToolSet`, when a worker has an output config, construct `tool({ description, inputSchema: schema, execute: async (input) => input })` and register its name in the terminal set.
- [ ] Add a new `outputMode: "tool_result"` (or reuse `tool_terminal`) whose resolver reads the validated input of the terminal tool call from the trace and validates it against the schema with the existing `resolveStructuredWorkerOutput` policy.
- [ ] Unit-test build + resolution with a fake trace.
      Dependencies: Phase 0. Risks: schema-to-tool-input edge cases — covered by tests. Rollback: feature is additive; remove the new branch.

**Phase 2: Migrate selector discovery workers off `submit_candidates`**

Goal: discovery (`web-scout`, etc.) uses `submit_result` configured with the candidate schema. Done when: selector discovery produces identical candidate objects via the generic tool.

- [ ] Point discovery workers' output config at the candidate schema (reuse `candidateOutputSchema`).
- [ ] Remove `Return JSON` blocks from `prompts/selector-workers/*.md`; add field `.describe()` to the schema where the prose carried real guidance.
- [ ] Delete `submit_candidates` from `tool-factory-registry.ts`, `SUPPORTED_TOOL_IDS`, `HarnessToolAvailability`, and `SELECTOR_PHASE.terminalToolNames` wiring.
- [ ] Update `pipeline-worker-prompts.test.ts` expectations.
      Dependencies: Phase 1. Risks: candidate shape mismatch — diff old vs new trace output on a mock session. Rollback: revert worker config + restore `submit_candidates`.

**Phase 3: Migrate `object`-mode verification + other-phase workers**

Goal: every schema-bearing worker uses `submit_result`; `experimental_output` no longer used alongside tools. Done when: all phases (selector, technical, fundamental, review, decision) run through the single mechanism.

- [ ] Convert `market-validator`, `catalyst-extractor`, `liquidity-gate`, and technical/fundamental/review/decision workers to output config + `tool_result`.
- [ ] Strip JSON-shape prose from their prompts; move field guidance into schema descriptions.
- [ ] Remove the `experimental_output` branch usage for tool-bearing workers in `run-agent-execute.ts` (keep `generateObject`-free; retain a no-tool structured path only if any worker genuinely has no tools and no terminal tool).
- [ ] Update affected tests (`strategy-prompt-context.test.ts`, `preset-behavior-guidance.test.ts`, `worker-tool-requirements.test.ts`).
      Dependencies: Phase 2. Risks: a worker that never calls `submit_result` — implement explicit no-terminal-call error or one retry. Rollback: per-worker revert (each worker is independent).

**Phase 4: Collapse `outputMode` and clean up**

Goal: simplify the executor branching now that one mechanism dominates. Done when: `outputMode` is `tool_result` | `text` only; dead code removed.

- [ ] Remove `object`/`tool_terminal` branches and `resolveTerminalResult`'s ad-hoc "first tool result" logic in favor of "find the terminal tool call by name".
- [ ] Update `WorkerDefinition`/`core/types.ts` docs and the strategy-context plan cross-reference.
- [ ] Full test run + one mock pipeline run.
      Dependencies: Phase 3. Risks: missed caller — type system catches most. Rollback: revert the cleanup commit (behavior already on the new path).

## 8. Risk Register

| #   | Risk                                                                                 | Likelihood | Impact | Mitigation                                                                            |
| --- | ------------------------------------------------------------------------------------ | ---------- | ------ | ------------------------------------------------------------------------------------- |
| 1   | Current `object`+tools workers already silently failing/masked by `substitute_empty` | Medium     | High   | Phase 0 validation before migrating                                                   |
| 2   | Worker exhausts steps/spend without calling `submit_result` → no output              | Medium     | Medium | Explicit no-terminal-call detection + single retry; clear `VALIDATION_FAILED` message |
| 3   | Large/nested schema as tool input degrades model compliance                          | Low        | Medium | Keep output schemas flat (already are); per-field `.describe()`                       |
| 4   | Downstream engine expects a shape that prose-era output diverged into                | Low        | High   | Diff old vs new trace output in Phase 2/3 on mock sessions                            |
| 5   | Prompt loses behavioral nuance when prose removed                                    | Medium     | Low    | Migrate real guidance into schema `.describe()` and keep behavioral steps in prompt   |
| 6   | Provider adapter differences in tool-input fidelity                                  | Low        | Medium | Mechanism already proven via `submit_candidates`; test per adapter                    |

## 9. Success Criteria

| Goal                   | Metric                                                       | Baseline                 | Target               | How Measured                             |
| ---------------------- | ------------------------------------------------------------ | ------------------------ | -------------------- | ---------------------------------------- |
| Single source of truth | Count of `Return JSON`/shape prose blocks in `prompts/**`    | current (>1)             | 0                    | grep in CI                               |
| One output mechanism   | Distinct output-resolution branches in `worker-executor.ts`  | 3                        | 1 (+thin text)       | code review                              |
| No SDK conflict        | `object`+tools worker definitions remaining                  | several                  | 0                    | grep `outputMode: "object"` with `tools` |
| Bespoke tool removed   | `submit_candidates` references                               | several                  | 0                    | grep                                     |
| Reliability (lagging)  | Selector `VALIDATION_FAILED` rate from missing tool evidence | TBD (Phase 0)            | ↓ to ~0 on Anthropic | trace/log audit                          |
| Scalability (leading)  | Files edited to add a new schema-bearing worker              | registry+executor+prompt | config only          | review of next worker PR                 |

## 10. Open Questions

| #   | Question                                                                                                              | Owner | Needed By | Status                               |
| --- | --------------------------------------------------------------------------------------------------------------------- | ----- | --------- | ------------------------------------ |
| 1   | Are current `object`+tools verification workers actually calling tools on Anthropic, or masked by `substitute_empty`? | Ken   | Phase 0   | Open                                 |
| 2   | Keep a `text` mode for unstructured workers, or force all output through the tool?                                    | Ken   | Phase 1   | Open (recommend keep thin text path) |
| 3   | Reuse `outputMode: "tool_terminal"` name or introduce `tool_result`?                                                  | Ken   | Phase 1   | Open                                 |
| 4   | Should `onValidationFailure` policy live per-worker or be standardized to one default?                                | Ken   | Phase 1   | Open                                 |

## 11. Alternatives Rejected

| Option                                 | Why Rejected                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A — Status quo                         | Leaves silent schema/prose drift and the Anthropic `object`+tools tool-suppression bug in place |
| B — Strip prose only                   | Fixes drift but not the core SDK incompatibility; ceiling too low given the forcing function    |
| `generateObject` for structured output | Does not support a tool loop; workers must gather evidence before answering, so it cannot apply |
