# AI harness: agent/tool consistency audit

**Status (implemented):** Tool registration and system prompts are driven by the same **`HarnessToolAvailability`** derived from `ROLE_TOOL_POLICY` ∩ infra (`harness-tools.ts` + `AgentPromptPackBuilder`). See `docs/plan/ai-harness-architecture.md` §4/§6/§8 and Phase 2 tool sections for updated wording.

Historical audit (for context):

Audit compared `docs/plan/ai-harness-architecture.md` (especially §4 role/tools table), `electron/main/services/ai/ai-runtime/ai-runtime-types.ts` (`ROLE_TOOL_POLICY`, `ROLE_HARNESS_CAPS`), `electron/main/services/ai/ai-runtime/runtime.ts`, `role-tools.ts` (removed — superseded by `harness-tools.ts`), `electron/main/services/ai/prompt-pack-builder.ts`.

---

## What changed in code

- **`RoleToolPolicy`** now includes `allowMarketQuoteTools` and `allowSubmitCandidates`; **`instrument_selector`** sets **`allowMarketNewsTool: true`** so policy matches runtime.
- **`deriveHarnessToolAvailability`** computes effective tools (search provider id present; broker routing/registry present where needed).
- **`buildHarnessToolSet`** is the **only** place that constructs role toolsets (`instrument_selector` and chain analysts/reviewer).
- **Prompt pack** “Tool Policy For This Run” uses **`harnessToolAvailability`**, not `allow*` alone—fixes prompts claiming `search_web` when it was omitted.
- **`get_news`** is registered only when a search provider is configured (**consistent with `search_web` omission**). Quote/OHLCV omit search deps.
- **`createMarketTools`** supports **`include`** to register only the subset requested.

---

## Historical issues (resolved)

The former §2 items (dual paths, misleading selector policy, prompt/runtime mismatch, inconsistent `get_news` degradation, stale doc footnotes) are addressed as above; planning doc paths and Phase 2 tool-contract prose were refreshed.
