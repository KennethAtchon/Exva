# Selector Timeout Run Review - 2026-05-16

## Scope

- Log file: `/Users/ken/.exva/logs/exva-2026-05-16.log`
- Session: `00e7a78e-88a0-41ba-ae1e-708f4950dbc5`
- Cycle: `cbf5b5b9-238b-43bc-b060-43fef2e0021c`
- Role: `instrument_selector`
- Model: `openrouter / deepseek/deepseek-v4-flash:free`

## Executive Summary

This run did not fail because search was unavailable or because the provider was immediately down. It failed because the selector never converged on a shortlist and kept spending full 60-second provider turns in broad research loops until every provider attempt timed out.

The exact break is between successful tool execution and model completion:

- tool calls kept succeeding for the entire session
- the model repeatedly consumed those tool results without emitting `submit_candidates`
- each provider attempt hit the 60s timeout
- the same selector stage was retried five times
- the fifth selector-stage failure was marked non-retryable and the run stopped

## Expected vs Actual

### Expected

The selector should do bounded discovery, verify a small set of candidates, then call `submit_candidates` with a ranked shortlist so the cycle can move forward.

### Actual

The selector stayed in open-ended discovery, repeated broad web and Reddit searches, occasionally made malformed search requests, and never submitted candidates. The provider timed out on every attempt until Exva terminated the selector stage.

## Failure Timeline

| Time | Evidence | Meaning |
|---|---|---|
| `22:04:41` | log lines `589-592` | Session runtime starts cleanly and selector begins with full tool access. |
| `22:04:41` | line `591` | Prompt already flagged large: `promptChars=8422`, `promptTooLong=true`. |
| `22:04:43` to `22:05:16` | lines `594-618` | First provider attempt does real work: web search, trending symbols, Reddit, fetches, quotes, OHLCV, news. |
| `22:05:41` | line `619` | First provider attempt times out after `60021ms`. |
| `22:06:22` to `22:11:16` | lines `622-688` | Attempts 2-5 repeat the same pattern: broad discovery, candidate re-checks, more fetches, no `submit_candidates`. |
| `22:09:20` | lines `673-679` | Selector starts to drift: repeated quote/news verification with no narrowing. |
| `22:16:51` | line `761` | Model issues nonsensical search query: `execute`. |
| `22:17:09` | line `783` | Model searches for its own narration: `Jan 17 action corrected. Starting fresh with full universe search.` |
| `22:25:31` | line `869` | Model searches a full self-instruction paragraph including `Hot Topic (HOTT)` and `Starbucks (SBUX)`. |
| `22:28:27` | line `929` | Model searches literal tool name: `search_web`. |
| `22:48:37` | lines `1005-1010` | Even in the last pass it is still only verifying candidates with quotes, not submitting them. |
| `22:38:37` | lines `1011-1013` | Fifth selector-stage failure ends the run with `PROVIDER_UNREACHABLE` caused by repeated `AI request timed out`. |

## Root Cause

The root cause is uncontrolled selector-loop behavior under a large prompt and a long-tool workflow.

More precisely:

1. The selector entered a broad discovery strategy instead of a bounded shortlist strategy.
2. Tool usage stayed successful, so the model kept receiving more context and opportunities to continue researching.
3. The model never crossed the decision boundary to `submit_candidates`.
4. Each provider attempt used the full 60-second budget and was aborted.
5. The execution layer retried the same selector stage multiple times, but the retries did not change the prompt, tool budget, or stop condition enough to break the loop.

This is why the final surfaced error is `PROVIDER_UNREACHABLE`, but the underlying behavioral failure is selector non-convergence.

## Evidence By Layer

### 1. Runtime startup was healthy

- `589-590`: runtime and orchestrator start normally
- `591`: selector starts with all expected tools available
- there is no early auth, registry, or search-provider failure in this run

### 2. External search was available

- `594`, `596-599`, `616-617`, `647-653`, `749-754`, `983`, `986-987`, `1002`: web fetch/search returns data repeatedly
- `598`, `615`, `625`, `629`, `650`, `664`, `709`, `715`, `729`, `748`, `768`, `790`, `802`, `817`, `834`, `856`, `872`, `889`, `902`, `915`, `931`, `954`, `977`, `1001`, `1004`: Reddit/trending tools also return data repeatedly

This rules out "search provider missing" as the issue for this run.

### 3. The model was burning turns on repeated research

Examples:

- repeated broad searches across the same themes: `594`, `596-597`, `616-617`, `647-650`, `657-660`, `713-718`, `742-746`, `848-852`, `871-876`, `951-954`, `998-1004`
- repeated re-verification of the same few symbols: `601-608`, `630-639`, `673-679`, `732-738`, `773-779`, `823-828`, `862-865`, `893-899`, `916-925`, `962-969`, `1005-1010`

The run keeps cycling over `NVDA`, `PLTR`, `TSLA`, and `SOL`, with occasional extras like `BTC`, `ETH`, `RKLB`, and `ACHR`, but it never promotes them into a final shortlist.

### 4. The model began querying with internal chatter instead of market queries

This is strong evidence that the selector lost task discipline:

- `645`: `search_web` called with empty args
- `761`: query is just `execute`
- `783`: query is self-commentary about starting fresh
- `869`: query includes a full self-correction paragraph about `HOTT` and `SBUX`
- `891`: another malformed/empty-result search pattern
- `929`: query is the literal tool name `search_web`
- `974`: query is `startup discovery for trend_hunt breakout long`

These are not user-goal-aligned market queries. They show the model is leaking internal reasoning into tool input.

### 5. Provider failures are consistent with timeout, not immediate rejection

- every provider failure in this session is `AI request timed out`
- attempt durations are consistently ~`60000ms`: `619`, `640`, `654`, `665`, `686`, `702`, `710`, `719`, `739`, `755`, `780`, `803`, `806`, `829`, `842`, `866`, `881`, `905`, `926`, `945`, `955`, `971`, `988`, `995`, `1011`

This points to slow or non-terminating model turns, not a hard provider outage or a schema rejection.

### 6. Final app error is a wrapper, not the true first cause

- `688`, `757`, `844`, `947`, `1013` surface `PROVIDER_UNREACHABLE`

That app-level error is technically correct for the failed attempt, but it obscures the actual operational cause: the selector spent its turn budget researching and never completed.

## Contributing Factors

### Prompt size started high

- `591`, `691`, `758`, `845`, `948` all show `promptChars=8422` and `promptTooLong=true`

That does not by itself cause failure, but it raises latency and leaves less room for long tool loops.

### No hard convergence guard

The model was allowed to keep broadening discovery even after already having enough candidate evidence to make a shortlist.

### Retry policy repeated the same bad behavior

The execution-step retries changed timing but not behavior. Each retry restarted the same loop with the same tool set and effectively the same decision boundary.

### Some fetched pages were noisy or low-signal

- `818` returns mostly page shell noise
- `819` returns Yahoo error content
- `839` returns HTTP `403`
- `858` returns aborted fetch
- `859` returns blocked private/loopback fetch policy

These were not the primary break, but they added friction and more opportunities for the model to keep searching instead of concluding.

## What This Run Tells Us About The Real Product Issue

The main issue is not "OpenRouter timed out" in isolation. The deeper issue is that the selector prompt and runtime policy allow too much open-ended exploration relative to the model's latency budget.

In other words:

- Exva asks the selector to do a lot
- Exva gives it many tools and many possible branches
- Exva does not force early narrowing strongly enough
- when the model drifts, the system retries drift rather than changing strategy

That combination makes timeout the visible symptom.

## Recommended Fixes

### Immediate

1. Add a hard selector convergence rule.
   Require `submit_candidates` once the model has at least `N` verified candidates or after `M` tool steps without new candidate classes.

2. Add a per-attempt tool budget for the selector.
   Example: cap each selector attempt to a small number of discovery calls and a small number of verification calls.

3. Reject malformed/self-referential tool queries.
   If a query looks like internal narration, an empty string, a tool name, or a self-correction paragraph, fail fast and record a selector-behavior error.

4. Surface a distinct timeout diagnosis.
   Differentiate:
   - provider unreachable
   - provider rate limited
   - provider timed out after tool loop
   - selector failed to converge

### Near-term

1. Shrink the selector operating prompt.
   The prompt is already marked too long before the first token is generated.

2. Add a retry-mode prompt variant.
   Retries should switch to a stricter "use existing evidence, no broad rediscovery, submit now" instruction set.

3. Persist and reuse prior candidate state within the cycle.
   The retries repeatedly rediscover `NVDA`, `PLTR`, `TSLA`, and `SOL` instead of resuming from the already-verified shortlist.

4. Add observability for convergence.
   Track counts like:
   - tool calls per attempt
   - unique symbols considered
   - repeated symbol rechecks
   - last `submit_candidates` opportunity missed
   - malformed query count

### Longer-term

1. Split selector into explicit phases.
   Discovery and verification should be separate bounded steps, not one large free-form loop.

2. Consider smaller/faster selector-specific models or stricter step budgets.
   This role is operationally sensitive to latency.

## Bottom Line

This run is a selector-convergence failure masquerading as a provider outage.

The provider timeout is real, but the deeper product problem is that the selector was allowed to keep researching indefinitely instead of being forced to decide. The evidence is the repeated successful tool use, the absence of any `submit_candidates` call, the malformed self-referential searches, and the five identical timeout cycles ending at `1013`.
