# hello.json Run Post-Mortem - 2026-05-17

## Scope

- Log under review: `docs/hello.json`
- Session: `a88245a5-cbf4-4a55-aea5-04550e0906f1`
- Cycle: `f7638af0-c7ef-4ff2-9226-6e200b8e283c`
- Failing role: `instrument_selector`
- Model: `openrouter / deepseek/deepseek-v3.2`

## Executive Summary

This cycle failed in two different ways across two selector-stage attempts:

1. The first selector-stage attempt spent too long in research and timed out repeatedly at the provider layer.
2. The second selector-stage attempt recovered at the provider layer, but still failed because the model stopped without ever calling `submit_candidates`.

The final surfaced app error is therefore correct but incomplete:

- final error: `VALIDATION_FAILED`
- exact message: `Instrument selector must call submit_candidates with a valid instrument list.`

The deeper product issue is that Exva does not currently enforce terminal selector submission strongly enough. The runtime nudges the model toward `submit_candidates`, but it does not require it before accepting a clean `finishReason: "stop"` completion.

## What Happened

### 1. The session and selector started cleanly

- Selector started with all expected tools available at `docs/hello.json:185-204`.
- The prompt was already large: `promptChars=9773` and `promptTooLong=true` at `docs/hello.json:188-191`.

This was not a startup, auth, or tool-availability failure.

### 2. First selector-stage attempt: long research loop, then provider timeout

The model did real work in the first attempt:

- discovery via `search_web` at `docs/hello.json:252-304`, `305-357`, `568-620`
- discovery via `search_reddit` at `docs/hello.json:370-430`, `443-503`
- trend seed via `get_trending_symbols` at `docs/hello.json:516-555`
- verification via `get_news`, `get_quote`, and `get_ohlcv` at `docs/hello.json:633-709` and `723-1505`

But it never reached terminal submission before the provider timed out:

- first timeout signal at `docs/hello.json:2410-2433`
- fifth timeout and wrapped stage failure at `docs/hello.json:6315-6376`

That first selector-stage attempt failed as `PROVIDER_UNREACHABLE` because the model kept researching until the 60s provider deadline expired.

### 3. Second selector-stage attempt: provider recovered, selector still did not submit

The step runner retried the selector stage, and the provider came back up:

- retry starts at `docs/hello.json:6397-6467`
- provider recovery logged at `docs/hello.json:8754-8768`

In the recovered attempt, the model still did bounded research and verification, but stopped without terminal submission:

- `search_web` at `docs/hello.json:6845-6897`
- another `search_web` with null result at `docs/hello.json:6900-6913`
- `search_reddit` at `docs/hello.json:6926-6987`
- `get_news` for `NVDA` at `docs/hello.json:7000-7039`
- `get_ohlcv` for `NVDA` at `docs/hello.json:7052-8673`

Then the selector summary made the real failure explicit:

- `sawSubmitCandidates: false` at `docs/hello.json:8699-8732`
- run still ended with clean `finishReason: "stop"` at `docs/hello.json:8734-8752`
- parser/orchestrator then rejected it with `VALIDATION_FAILED` at `docs/hello.json:8770-8783`

That is the exact break in this run.

## Why The Run Failed

### Direct cause

The run failed because the recovered selector attempt ended normally from the provider's perspective, but never emitted the required terminal tool call `submit_candidates`.

That failure is enforced here:

- `parseInstrumentSelection()` only accepts a valid `submit_candidates` payload or parseable assistant JSON, otherwise it throws `Instrument selector must call submit_candidates with a valid instrument list.` in `electron/main/services/ai/ai-runtime/instrument-selection-parser.ts:6-41`
- `resolveInstruments()` calls `runInstrumentSelector()` and immediately validates the selector output before any downstream handoff in `electron/main/services/orchestration/agent-orchestrator.ts:1445-1452`

So the selector stage itself failed. The run did not reach analyst, reviewer, or decision stages.

### Contributing causes

### Prompt and tool payloads are large

The run started large and grew larger:

- selector start logs `promptTooLong=true` at `docs/hello.json:188-191` and `docs/hello.json:6404-6408`
- the recovered attempt still consumed `32292` input tokens in only 6 steps at `docs/hello.json:8744-8748`

The biggest contributors in this run were long fetched pages and very large OHLCV payloads:

- noisy Barchart fetch at `docs/hello.json:6531-6540`
- full NVDA OHLCV series at `docs/hello.json:7060-8673`

This makes it easier for the model to burn time/context on research and harder for it to converge quickly.

### The model spent effort on research quality, not terminal commitment

The selector kept gathering evidence, but there is no evidence in the recovered attempt that it ever crossed into a final commit action. It verified `NVDA`, but did not submit `NVDA`, `PLTR`, or any empty shortlist.

### The current runtime control is advisory, not binding

The key runtime gap is here:

- `runtime.ts` passes both `terminalToolNames: ["submit_candidates"]` and `prepareStep: buildSelectorPrepareStep(...)` into the model run at `electron/main/services/ai/ai-runtime/runtime.ts:235-249`
- `buildSelectorPrepareStep()` can force the next step to use `submit_candidates`, but only if the model is still taking another tool step, in `electron/main/services/ai/ai-runtime/selector-runtime-control.ts:61-85`
- `executeRunAgent()` still accepts a normal `finishReason: "stop"` completion and only validates after generation completes, in `electron/main/services/ai/adapters/run-agent-execute.ts:159-177` and `:296-312`

That means this control flow is possible today:

1. the model researches
2. the model decides to stop instead of taking another tool step
3. the provider returns `finishReason: "stop"`
4. Exva logs the run as complete
5. only afterward does the parser reject it for missing `submit_candidates`

That is exactly what happened in `docs/hello.json:8734-8783`.

## Why `instrument_selector` keeps not submitting candidates

This run shows three concrete reasons.

### 1. The terminal contract is too soft

`submit_candidates` is described as terminal, but the runtime does not require it before accepting a clean stop.

The current implementation is effectively:

- prefer or force `submit_candidates` on a future step
- but allow the model to stop before that future step exists

This is the main architectural reason the selector can end with `sawSubmitCandidates: false`.

### 2. The commit threshold is later than the model's natural stopping point

Selector phase control defaults are relatively loose:

- `maxDiscoverySteps = 8`
- `maxVerificationSteps = 6`
- `forceSubmitAfterStep = 14`

These defaults live in `electron/shared/ai/ai-role-profile.ts:9-14`.

But the recovered run stopped after only 6 steps at `docs/hello.json:8742-8745`, well before the hard force-submit threshold would ever have applied.

So even if force-submit were working as intended for a future step, this run never got that far.

### 3. Selector heuristics overcount "discovered symbols"

The recovered run summary says the selector found these unique symbols:

- `NVDA`
- `RSI`
- `PLTR`
- `CEO`
- `SOL`
- `BTC`

See `docs/hello.json:8710-8718`.

`RSI` and `CEO` are not real candidate instruments here. They were extracted from Reddit/news prose by the symbol-extraction heuristic in `electron/main/services/ai/ai-runtime/selector-runtime-control.ts:317-327`.

That matters because phase transition logic uses `uniqueSymbols.length >= minCandidatesBeforeVerification` in `selector-runtime-control.ts:180-199`.

So the selector can appear to have "enough candidates" earlier than it really does, even when some of those "symbols" are just uppercase finance terms from text.

That pushes the selector into verification logic earlier without guaranteeing a later terminal commit.

## Why It Seems To "Pass Over To The Other Models"

Two clarifications are important.

### In this run, it did not pass anything downstream

There are no analyst, reviewer, or decision runs in `docs/hello.json`. The selector failed first.

### In the product design, downstream handoff is intentional

When the selector succeeds, it is supposed to hand shortlisted instruments into the rest of the pipeline. That path is intentional, not a bug:

- after a successful selector result, `handleResolvedInstruments()` enqueues trade cycles in `electron/main/services/orchestration/agent-orchestrator.ts:1340-1355`
- each trade cycle then runs technical, fundamental, reviewer, and decision stages

So the intended architecture is:

1. selector discovers and submits candidates
2. orchestrator validates those candidates
3. downstream analyst/reviewer/decision models evaluate them

The bug is not that downstream handoff exists. The bug is that selector submission is not enforced strongly enough before the system considers the selector run complete.

## Most Likely Root Cause

The most likely root cause is a runtime contract mismatch:

- the parser requires `submit_candidates`
- the runtime merely encourages `submit_candidates`
- the provider is allowed to return a clean stop without it

Everything else in this run amplified that gap:

- large prompt
- expensive tool payloads
- long verification context
- false-positive candidate counting from symbol extraction
- a force-submit threshold that is later than the model's actual stopping behavior

## Recommended Fixes

### High priority

1. Make selector completion impossible without `submit_candidates`.
   Treat selector runs as incomplete unless the terminal tool fires. Do not accept a clean provider stop as a valid selector completion.

2. Add a retry-mode override for recovered selector attempts.
   On retry, disable broad rediscovery and force either:
   - `submit_candidates` with ranked instruments
   - or `submit_candidates` with `instruments: []`

3. Lower the practical commit threshold.
   `forceSubmitAfterStep = 14` is too late relative to observed model behavior in this run.

4. Tighten symbol extraction.
   Stop counting generic uppercase finance tokens like `RSI` and `CEO` as discovered instruments.

### Medium priority

1. Shrink or summarize large verification payloads before feeding them back to the model.
2. Prefer shorter OHLCV summaries over full bar dumps for selector-stage reasoning.
3. Track a dedicated selector-failed-to-commit diagnosis distinct from generic provider timeout and generic validation failure.

## Bottom Line

`docs/hello.json` is not a case where the selector successfully found a candidate and then mysteriously handed work away.

It is a case where:

- one selector attempt timed out while over-researching
- the next attempt recovered but still stopped without `submit_candidates`
- the parser rejected the run afterward

The deepest bug is that Exva currently validates selector terminal submission after generation, not during generation. That is why the model can end a run cleanly while still violating the selector contract.
