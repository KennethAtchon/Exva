# OpenRouter, Gemma, and `SEARCH_PROVIDER_REQUIRED` - Research Note

> **Date:** 2026-05-08
> **Status:** Draft
> **Scope:** Why Exva blocks `session:start` with `SEARCH_PROVIDER_REQUIRED` when using AI-selected universe mode, and what solution paths make sense.

## Summary

The immediate failure is **not** an OpenRouter transport failure and it happens **before** Exva calls the configured OpenRouter/Gemma model. In Exva, `ai_selected_universe` sessions require a resolved **search provider account** at preflight time. The preflight check reads `session.defaultSearchProviderId ?? workspace.defaultSearchProviderId` and rejects startup when that resolves to `null` or to a non-configured account. This is implemented in `electron/main/services/session/preflight/selector-config-check.ts:12-29` and covered by `electron/main/services/session/preflight/selector-config-check.test.ts:11-22`.

The architecture currently treats **AI providers** and **search providers** as different account categories. OpenRouter is supported only as an AI provider (`providerType: "openrouter"`, `category: "ai"`) through `OpenRouterAdapter`; search providers are a separate registry with only `brave` and `tavily` adapters today. See `src/components/accounts/AddAiProviderModal.tsx:65-71`, `electron/main/services/ai/adapters/openrouter-adapter.ts:24-136`, and `electron/main/services/ai/search/search-registry.ts:21-48`. Because of that split, an OpenRouter account cannot satisfy the selector's search-provider requirement in the current codebase.

The deeper product issue is UX: the session editor expects search providers to exist and lets the user pick one (`src/components/sessions/CreateEditSessionModal.tsx:223-236`), but the visible Accounts UI currently exposes only AI providers and broker accounts, not search-provider account creation (`src/pages/AccountsPage.tsx:212-390`, `393-467`). That makes the preflight error easy to hit and hard to resolve from the UI.

## Exact Failure Path

1. Starting a session triggers the selector preflight pipeline through `electron/main/services/session/preflight/index.ts:18`.
2. If the session uses `selectionMode === "ai_selected_universe"` and `aiPickerEnabled`, Exva requires a search provider. `selector-config-check.ts` returns `SEARCH_PROVIDER_REQUIRED` if neither the session override nor the workspace default resolves to a configured search account. (`electron/main/services/session/preflight/selector-config-check.ts:8-29`)
3. The failing error string in your logs exactly matches the branch where no search provider ID resolves at all: `"AI-selected universe requires a configured search provider. Set a session override or workspace default before starting."` (`selector-config-check.ts:16-18`)
4. This happens before model execution, so OpenRouter/Gemma is not yet involved in this specific failure. That is an inference from the preflight ordering plus the stack trace showing `SessionService.start` rejecting during preflight. (`electron/main/services/session/preflight/index.ts:15-21`; your log)

## What the Code Says About Providers

### AI providers

- OpenRouter is supported as an AI provider via `OpenRouterAdapter`, which uses OpenAI-compatible chat calls against `https://openrouter.ai/api/v1` by default. (`electron/main/services/ai/adapters/openrouter-adapter.ts:24-39`) OpenAI-compatible tool/function calling is a standard pattern in model APIs. ([OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling))
- The Add Provider modal only creates `category: "ai"` records for `anthropic`, `openai`, and `openrouter`. (`src/components/accounts/AddAiProviderModal.tsx:6-14`, `65-71`)

### Search providers

- Search providers are loaded through `SearchRegistry`, not `ProviderRegistry`. `SearchRegistry` rejects any account that is not `category === "search"`. (`electron/main/services/ai/search/search-registry.ts:17-24`)
- The only supported search adapter types today are `brave` and `tavily`. (`electron/main/services/ai/search/search-registry.ts:40-48`)
- Provider account schema also models AI and search separately: `category` is `"ai" | "search"`, while `providerType` can be `anthropic | openai | openrouter | brave | tavily`. (`src/lib/schemas.ts:142-153`)

## Why This Feels Like "OpenRouter Search Is Broken"

From the user point of view, the selector is an AI workflow and OpenRouter/Gemma is the configured model, so it is natural to assume the missing piece belongs to that same provider. But Exva's current architecture deliberately separates:

- model execution (`OpenRouterAdapter`, `ProviderRegistry`)
- web/news search (`SearchRegistry`)

That split is consistent with the existing architecture docs, which state that `search_web` and search-backed `get_news` use the session or workspace default search account, separate from the role's model provider. (`docs/plan/archieve/instrument-selector-discovery-remediation-plan.md:57-60`; `docs/plan/ai-harness-architecture.md` noted in that file)

So the current system behavior is internally consistent, but the UI and error messaging do not make the distinction obvious.

## External Research Relevant To The Fix

### AI SDK tool-loop control supports the selector contract Exva wants

Vercel AI SDK supports `prepareStep`, `activeTools`, forced `toolChoice`, and `stopWhen` / `hasToolCall(...)`, which are appropriate for enforcing a search-first selector loop and making `submit_candidates` terminal. ([AI SDK Loop Control](https://ai-sdk.dev/docs/agents/loop-control), [AI SDK Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling))

### Function-calling reliability depends on schema clarity and app-owned guardrails

OpenAI's function-calling guidance recommends clear tool descriptions, strict schemas where possible, fewer active tools, and moving known state out of the model and into application code. That supports Exva's existing direction: enforce search-provider presence in code, pass provider state explicitly, and validate selector output rather than trusting the model alone. ([OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling))

### Model/tool quality is a separate concern from this preflight failure

Even after the search-provider issue is fixed, model quality and tool-use behavior still matter. The repo already tracks a specific risk that forced first-step tool choice may behave inconsistently with some OpenRouter models. (`docs/plan/archieve/instrument-selector-discovery-remediation-plan.md:175`, `368-369`) That means Gemma may still be a follow-on variable, but it is **not** the root cause of the current `SEARCH_PROVIDER_REQUIRED` error.

## Options

### Option A: Keep the current architecture, improve UX and error recovery

What it means:

- Keep OpenRouter as AI-only.
- Keep Brave/Tavily as separate search providers.
- Add visible search-provider management in Accounts.
- Add workspace default search-provider controls.
- Make the preflight error explicitly say that OpenRouter does not count as the required search provider.

Pros:

- Smallest change.
- Preserves the current separation of concerns.
- Aligns with existing code and tests.

Cons:

- Requires users to manage two provider types.
- Still leaves search dependent on third-party search accounts.

Assessment:

- Complexity: Low
- Code fit: Excellent
- User clarity: Good after UI copy fixes
- Risk: Low

### Option B: Add first-class Search Provider UI and make it impossible to create an unstartable selector session

What it means:

- Everything in Option A.
- Also block or warn earlier in the session editor when `ai_selected_universe` is chosen and no search provider exists.
- Add one-click navigation from the preflight error to the relevant Accounts setup.

Pros:

- Best user experience.
- Prevents the broken path earlier.
- Keeps runtime rules honest.

Cons:

- Slightly more UI work.
- Still requires separate provider concepts.

Assessment:

- Complexity: Low to medium
- Code fit: Excellent
- User clarity: Best short-term path
- Risk: Low

### Option C: Treat OpenRouter as a valid search backend

What it means:

- Extend `SearchRegistry` with a new adapter that uses an OpenRouter model as a search-like tool.
- Potentially synthesize search summaries through an LLM if a real search API is absent.

Pros:

- Fewer separate account concepts for the user.
- Could let one OpenRouter key power both reasoning and discovery.

Cons:

- This does **not** exist in the current code.
- OpenRouter is a model-routing layer, not a dedicated search adapter in this app today.
- A model-only "search" substitute is not equivalent to grounded web search and risks hallucinated discovery.
- Would blur the contract between retrieval and generation.

Assessment:

- Complexity: Medium to high
- Code fit: Weak in the current architecture
- User clarity: Simpler conceptually, riskier technically
- Risk: Medium to high

### Option D: Make selector discovery app-owned instead of model-owned

What it means:

- Perform market/news discovery in application code first.
- Inject ranked results into the selector prompt as trusted context.
- Use the LLM to refine and select, not to do raw retrieval.

Pros:

- More deterministic.
- Less sensitive to weak tool-use behavior from smaller models.
- Better auditability.

Cons:

- Larger architectural change.
- Requires more product decisions about retrieval, ranking, freshness, and cost.

Assessment:

- Complexity: High
- Code fit: Strategic future path, not immediate fix
- User clarity: Good once built
- Risk: Medium

## Recommendation

Recommend **Option B**.

Reason:

- It fixes the actual current problem without fighting the repo's architecture.
- It addresses both layers of failure:
  - runtime truth: AI-selected universe really does require a configured search account
  - UX truth: the user currently has no clear in-app setup path for that requirement
- It keeps OpenRouter/Gemma in the right place: model execution, not search-provider resolution.

## Concrete Changes To Consider

1. Add a **Search providers** section to `AccountsPage` alongside AI providers and brokers.
2. Add a modal parallel to `AddAiProviderModal` for `category: "search"` with `providerType: "brave" | "tavily"`.
3. Add a **Workspace default search provider** selector in Accounts so sessions can inherit a default.
4. In `CreateEditSessionModal`, when `selectionMode === "ai_selected_universe"`, show a blocking inline warning if there are zero configured search providers.
5. Change the preflight error copy to something like: `AI-selected universe needs a configured search provider account (Brave or Tavily). Your OpenRouter model account does not satisfy this requirement.`
6. Add a CTA from the error state to open Accounts setup.
7. Only after the above, evaluate whether Gemma on OpenRouter is reliable enough for the selector role under forced tool phases.

## Open Questions

1. Should Exva continue with separate search accounts long-term, or eventually support provider-native web-search tools from model vendors where available?
2. Is Brave or Tavily the intended default recommendation for users, based on cost and result quality?
3. After search-provider setup is fixed, is `google/gemma-`* on OpenRouter strong enough for `instrument_selector`, especially when first-step search and tool-use discipline are required?

## Bottom Line

The current `SEARCH_PROVIDER_REQUIRED` failure is best understood as a **missing dedicated search account plus missing setup UI**, not as an OpenRouter bug. OpenRouter/Gemma may still matter for downstream tool-use quality, but the current startup error is triggered earlier by Exva's provider split and the absence of a configured `search` account.