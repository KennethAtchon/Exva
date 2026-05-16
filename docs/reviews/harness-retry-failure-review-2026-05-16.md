# Harness Retry Failure Review - 2026-05-16

## Summary

`docs/hello.json` shows a selector run being treated as terminal even though the underlying failure was a retry case. The harness moved the session into `attention_required`, the UI showed an error state, and then the model/tool loop continued producing logs afterward. That combination made the run look both failed and successful at the same time.

This review traces the exact failure chain and documents the fix shipped in code.

## Observed Behavior

From `docs/hello.json`:

- The selector run was healthy through step 12.
- At lines `3917-3939`, `ai-runtime` logged `provider request attempt failed` with `providerErrorMessage: "AI request timed out"`.
- That same failure was marked `retryable: false` and `willRetry: false`.
- At lines `3963-3976`, the selector execution step was persisted as `retryable: false` with `errorCode: "PROVIDER_UNREACHABLE"`.
- After that, the run still emitted more agent activity starting at lines `3997+` (`step: 13`, tool `get_news` for `NVDA`).

Expected behavior:

- A timeout should be classified as retryable.
- The session should remain active while the harness retries.
- A timed-out provider attempt should be aborted so it cannot continue emitting stale post-timeout activity.

Actual behavior before the fix:

- The timeout was treated as terminal.
- The selector step was marked failed instead of retrying.
- The orchestrator escalated the session to `attention_required`.
- The timed-out provider request was never cancelled, so it kept running in the background.

## Root Cause

### 1. Timeout classification bug in `runtime-retry.ts`

File: `electron/main/services/ai/ai-runtime/runtime-retry.ts`

Before the fix, `shouldRetry()` checked for `"timeout"` but not `"timed out"`.

That meant a plain error message like `"AI request timed out"` did **not** match the retryable path, even though it is obviously transient.

Effect:

- `withProviderRetry()` logged the failure as non-retryable.
- It wrapped the error into `AppError("PROVIDER_UNREACHABLE")` with `details.retryable = false`.

### 2. Step runner trusted the bad retryability flag

File: `electron/main/services/orchestration/execution-step-runner.ts`

`classifyStepError()` already honors `AppError.details.retryable === true`, but because the wrapped provider error carried `retryable: false`, the selector step was written as terminal.

Effect:

- Step status became `failed` instead of `retrying`.
- No automatic retry was scheduled.

### 3. Orchestrator escalated the session because the selector step looked terminal

File: `electron/main/services/orchestration/agent-orchestrator.ts`

`handleStepFailure()` moves the session to `attention_required` when a non-retryable failure occurs on a stage like `selector`.

That logic is reasonable. The problem was upstream: the timeout had already been mislabeled as non-retryable.

Effect:

- Session status flipped to `attention_required`.
- The UI surfaced that as a broken/needs-attention run.

### 4. Timed-out provider calls were not aborted

Files:

- `electron/main/services/ai/ai-runtime/runtime-retry.ts`
- `electron/main/services/ai/ai-runtime/runtime.ts`
- `electron/main/services/ai/adapters/run-agent-execute.ts`

The retry wrapper used `Promise.race()` against a timeout, but it did not cancel the in-flight provider request. The adapter stack already supported `abortSignal`, but the retry wrapper was not creating or passing one.

Effect:

- The harness considered the attempt dead.
- The provider/tool loop could still complete later and continue logging steps.
- That is why `docs/hello.json` shows post-timeout tool activity after the selector step had already been recorded as failed.

## Fix Shipped

### Retry classification hardening

Updated `runtime-retry.ts` so provider retry classification now treats both `"timeout"` and `"timed out"` as transient.

### Abort timed-out provider attempts

Updated `withProviderRetry()` to create an `AbortController` per provider attempt and abort the in-flight call when the timeout fires.

Updated all `withProviderRetry()` call sites in `runtime.ts` to pass the attempt-scoped `abortSignal` into `adapter.runAgent(...)`.

This closes the gap where the harness timed out locally but the model call kept running remotely/in-process.

### Exponential retry policy with 4 retries

Shipped two aligned retry policies:

Provider-attempt retry in `runtime-retry.ts`:

- Timeout per attempt: `60s`
- Backoff: `1s`, `2s`, `4s`, `8s`
- Retries: `4`
- Total attempts: `5`

Persisted step retry in `execution-step-runner.ts`:

- Backoff: `30s`, `60s`, `120s`, `240s`
- Retries: `4`
- Total attempts per step/cycle: `5`

This makes the harness materially less fragile than the previous mixed policy:

- Provider layer: only `2` total attempts before
- Step layer: only `3` total attempts before

## Why this fixes the user-visible problem

After the patch:

- A selector timeout is classified as retryable.
- The selector step is persisted as `retrying`, not terminal.
- The orchestrator does not move the session into `attention_required` for that retry case.
- The timed-out provider request is aborted, so it cannot keep emitting stale step/tool logs after the harness has already decided to retry.

That removes the contradictory state where the session card says failure while the logs continue as if the run is still alive.

## Verification

Verified in code with:

- `bunx vitest run electron/main/services/ai/ai-runtime/__tests__/runtime-retry.test.ts electron/main/services/orchestration/__tests__/execution-step-runner.test.ts electron/main/services/orchestration/__tests__/agent-orchestrator.test.ts`
- `bun run typecheck`

Added/updated tests cover:

- timed-out provider messages are retryable
- timed-out provider attempts are aborted before retrying
- aborted run-agent requests ignore late step/completion logging after abort
- step runner now uses a 4-retry exponential backoff profile
- selector retryable provider failure keeps the session active

## Remaining Risk

The original correctness issue is fixed, and the two immediate follow-ups are now also implemented:

1. The session progress UI now distinguishes `retrying` from terminal `needs attention` states explicitly instead of collapsing them into a generic error impression.
2. `run-agent-execute` now ignores late step/completion logging after an abort, and regression coverage asserts that aborted requests do not emit stale post-timeout tool/response logs.

Residual risk is narrower now: a provider may still consume remote time/cost briefly before honoring an abort, but the local harness no longer treats that late activity as accepted runtime progress.
