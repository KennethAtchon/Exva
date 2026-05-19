# Exva Codebase Review — 2026-05-18

## What This Is

Exva is an Electron desktop app for AI-driven automated trading. The architecture layers are:

1. **DB** — SQLite via Drizzle, with per-session strategy tables and full audit log (agent runs, trades, events, capital reservations)
2. **AI Pipeline** — multi-phase pipeline (selector → technical → fundamental → review → decision) with a dependency-graph worker scheduler, concurrent group runner, per-phase spend caps, and provider retry
3. **Session Runtime** — lifecycle state machine (draft → idle → active ↔ paused → stopped → archived) with a P-Queue-serialized `SessionRuntime`, an orchestrator, and a trade monitor
4. **Risk Engine** — preflight gate + decision gate (concurrent trade cap, size reduction, daily loss limit, confidence threshold)
5. **IPC** — Zod-validated Electron IPC with trusted-sender checks
6. **Renderer** — Zustand stores + React Query, shadcn/radix UI

**Intent**: let an operator configure trading sessions with strategy rules, risk limits, and AI phase configs; have the AI autonomously discover instruments, analyze them through the pipeline, gate decisions through risk, and submit orders to brokers — while logging everything for replay and autopsy.

---

## Summary

The architecture is sophisticated and mostly coherent. The state machine is clean, the retry/timeout logic is solid, and the IPC security hardening is better than most Electron apps I've seen. You're clearly thinking about invariants — the `LEGAL_TRANSITIONS` map, the P-Queue serialized lifecycle, the capital reservation two-phase commit, and the conservative crash-recovery rehydration policy are all evidence of thoughtful design.

The most serious issues are: an unbounded memory map in the pipeline that leaks in long sessions; capital allocation logic that doesn't scope to the current session (breaks multi-session); full AI prompts logged at INFO level; and an incomplete schema migration that left two sources of truth for risk config. None of these are crashes-on-startup bugs, but the first two will cause problems under load.

---

## Critical Issues

### 1. Unbounded `cycleSpendUsd` map — memory leak in long sessions

**File:** `electron/main/services/ai/pipeline-runtime/core/pipeline-runtime.ts:56`

**What:** `private readonly cycleSpendUsd = new Map<string, number>()` accumulates one entry per cycle and is never evicted.

**Why:** `PipelineRuntime` is instantiated per `AiRuntime`, which lives for the lifetime of the app. A session running 100 cycles/day for a week leaks 700+ entries. At scale (or in dev with many test runs) this will grow indefinitely.

**Fix:**
```ts
private recordCycleSpend(cycleKey: string, phaseSpentUsd: number): void {
  if (phaseSpentUsd <= 0) return;
  const next = (this.cycleSpendUsd.get(cycleKey) ?? 0) + phaseSpentUsd;
  this.cycleSpendUsd.set(cycleKey, next);
  // Evict oldest entries when map grows too large
  if (this.cycleSpendUsd.size > 500) {
    const oldest = this.cycleSpendUsd.keys().next().value;
    if (oldest) this.cycleSpendUsd.delete(oldest);
  }
}
```
Or evict after the phase run completes (cycle is done, spend is committed to DB, entry can be dropped).

---

### 2. `sumActiveReservedUsd()` is not session-scoped — multi-session capital allocation breaks

**File:** `electron/main/db/repositories/trades/capital-reservations-repo.ts:79`

**What:** `sumActiveReservedUsd()` sums ALL sessions' active reservations.

**Why:** If two sessions are running simultaneously and Session A has $800 reserved, Session B's capital check sees $800 pre-committed even though it's a separate allocation pool. Legitimate orders in Session B will be incorrectly blocked, or the total-exposure guard will misfire. The method name implies a global check but the call sites may expect per-session semantics.

**Fix:** Add a `sessionId` parameter (or a separate `sumActiveReservedUsdForSession(sessionId)` method) and decide: is capital reservation global or per-session? Enforce that consistently in all callers.

```ts
sumActiveReservedUsd(sessionId?: string): number {
  const cond = sessionId
    ? and(eq(capitalReservations.sessionId, sessionId), inArray(capitalReservations.status, ["reserved", "consumed"]))
    : inArray(capitalReservations.status, ["reserved", "consumed"]);
  // ...
}
```

---

### 3. Full system and user prompts logged at INFO level — log pollution + strategy exposure

**File:** `electron/main/services/ai/adapters/run-agent-execute.ts:140-157`

**What:**
```ts
logger.info({
  systemPrompt: system ?? null,
  userPrompt: prompt,
  ...
}, "execute run agent start");
```
Full prompt text — potentially thousands of characters — is logged at INFO on every agent invocation.

**Why two problems:**
1. **Signal-to-noise**: logs become unusable for ops monitoring. A single pipeline run with 5 phases × 3 workers × 10 steps = 150 INFO entries each with multi-KB prompt blobs.
2. **Data exposure**: strategy-specific instructions, instrument names, API response content embedded in prompts all land in log files. If logs are shared for debugging, strategy IP leaks.

**Fix:** Move `systemPrompt`/`userPrompt` to DEBUG level, or strip them entirely and use `systemChars`/`promptChars` (already logged) for sizing context:
```ts
logger.debug({ role: params.role, modelId: params.modelId, systemPrompt: system, userPrompt: prompt }, "agent prompt");
logger.info({ ...<metadata without prompts>... }, "execute run agent start");
```

---

### 4. `stopSession` marks DB status "stopped" before `runtime.stop()` confirms

**File:** `electron/main/services/session/session-runtime-manager.ts:104-113`

**What:**
```ts
this.deps.sessionRepo.setStatus("stopped", sessionId); // ← written to DB first
await runtime.stop();                                   // ← confirmed second
this.runtimes.delete(sessionId);
```

**Why:** If `runtime.stop()` throws (orchestrator or trade monitor cleanup fails), the DB says "stopped" but the runtime may be in an indeterminate state. On next startup, `rehydrateFromDb` won't see this session (status is "stopped", not "active"/"paused"), so open positions may go unmonitored.

Contrast with `pauseSession`: status is set before `await runtime.pause()` there too, but pause failure is less dangerous than stop failure. Stop is the point where the trade monitor is shut down — that's the critical boundary.

**Fix:** Either set the DB status *after* `runtime.stop()` resolves, or wrap in try/catch and revert status on failure:
```ts
try {
  await runtime.stop();
  this.deps.sessionRepo.setStatus("stopped", sessionId);
} catch (error) {
  this.deps.sessionRepo.setStatus("attention_required", sessionId);
  throw error;
}
```

---

## Improvements

### 5. `sessionStrategies` table is a divergence bomb

**Files:** `electron/main/db/schema.ts:91-110`, `electron/main/db/repositories/sessions/session-strategies-repo.ts`, `electron/main/ipc/config.ts`

**What:** `sessionStrategies` duplicates fields that now live in `sessionRiskConfig` and `sessionTimeframeConfig`. The old `updateConfig` path wrote to both tables in a transaction. The new `ipc/config.ts` path calls `strategyContext.saveRiskConfig()` which writes only to `sessionRiskConfig`. `SessionStrategiesRepo.getConfig()` reads from `sessionStrategies`.

**Why:** Any code path that reads risk config via `sessionStrategiesRepo.getConfig()` (used in `OrchestratorDeps`) will see stale data if the config was last updated via the new strategy UI. The two tables will silently diverge.

The orchestrator has access to both `sessionStrategiesRepo` AND `strategyContextService` in its deps. Which one wins for live risk decisions?

**Fix:** Pick one source of truth. `sessionStrategies` should either be deleted (with a migration to remove the columns that are now in `sessionRiskConfig`/`sessionTimeframeConfig`) or the `sessionStrategiesRepo` update methods need to always write-through to the new tables transactionally — which `updateConfig` already does but `saveRiskConfig` in `strategyContextService` does not.

Intermediate fix: in `SessionStrategyContextService.saveRiskConfig()`, also fire `sessionStrategiesRepo.updateConfig()` to keep them in sync until the old table is removed.

---

### 6. `aggregatePhaseOutput` silently overwrites with `Object.assign`

**File:** `electron/main/services/ai/pipeline-runtime/core/pipeline-runtime.ts:201-210`

**What:**
```ts
return outputs.reduce<Record<string, unknown>>((acc, output) => {
  if (output && typeof output === "object") Object.assign(acc, output);
  return acc;
}, {});
```

**Why:** If two workers in the same phase return an object with the same key, the later worker silently wins. No warning, no detection. In a multi-worker technical or fundamental phase, a second worker could zero out a field the first worker set — invisible to the caller.

**Fix:** At minimum, log when a key collision is detected:
```ts
if (key in acc) logger.warn({ phase, key }, "worker output key collision");
```
Better: require phase definitions to declare output schemas that make collisions structurally impossible.

---

### 7. Per-step latency is evenly distributed — tool performance data is wrong

**File:** `electron/main/services/ai/adapters/run-agent-execute.ts:98-124`

**What:**
```ts
const per = sdkSteps.length ? Math.max(0, Math.round(durationMs / sdkSteps.length)) : 0;
return sdkSteps.map((st, i) => ({
  ...
  latencyMs: per,  // same for every step
}));
```

**Why:** The `latencyMs` field on `StepTrace` and every `ToolCallRecord` will be identical for all steps in a run. A slow `search_web` call and a fast `get_quote` call will both show the same averaged latency. Any latency-based analysis (which tools are bottlenecks, which providers are slow) is completely misleading.

The AI SDK's `onStepFinish` is already called per step with access to `Date.now()`. Track step start times there.

**Fix:**
```ts
const stepStartTimes: number[] = [];
const wrappedBaseArgs = {
  ...baseArgs,
  onStepFinish: (step: StepResult<ToolSet>) => {
    stepStartTimes.push(Date.now());
    onStepFinish(step, stepIndex++);
  },
};
// Then in buildStepTraces, compute per[i] = stepStartTimes[i+1] - stepStartTimes[i]
```

---

### 8. "Today" uses UTC date — stats shift at UTC midnight, not local midnight

**File:** `electron/main/db/repositories/system/stats-repo.ts:16`

**What:**
```ts
const today = new Date().toISOString().slice(0, 10);
```

**Why:** An operator in UTC-5 will see their day reset at 7 PM local time. Trades made at 8 PM (after UTC midnight) appear as "today" while trades from 6 PM may drop off. Daily PnL and trade counts will jump unexpectedly, and the daily loss limit check in the risk engine uses these stats.

**Fix:** Store a local-date offset in workspace preferences, or at minimum document that all "daily" limits are UTC-based.

---

### 9. `loadFixture` does no schema validation — crashes on corrupted data

**File:** `electron/main/services/orchestration/cycle-replay-service.ts:428-431`

**What:**
```ts
loadFixture(filePath: string): CycleFixture {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as CycleFixture;
}
```

**Why:** A hand-edited, corrupted, or version-mismatched fixture will pass through as `CycleFixture` and then throw deep inside `CycleReplayRunner.replay()` with a confusing error. The `buildFixture` path already validates each phase output via Zod schemas — `loadFixture` should do the same at the top level.

**Fix:** Add a Zod schema for `CycleFixture` and parse through it, or at minimum validate `fixture.version === 1` and that the required nested shapes are present before returning.

---

### 10. `PipelineRuntime.deps.strategyContextService` is mutable — can change mid-run

**File:** `electron/main/services/ai/pipeline-runtime/core/pipeline-runtime.ts:60`

**What:** `deps.strategyContextService` starts nullable and is set later via `setStrategyContextService()`. The `PipelineRuntimeDeps` interface has it typed as mutable.

**Why:** If `setStrategyContextService` is called while a phase is running (unlikely but possible during session startup race), the strategy context seen by the running phase changes mid-flight. More practically: the null check means every `run()` call defensively calls `requireStrategyContextService()` which throws with `"UNKNOWN"` error code — not very actionable.

**Fix:** Require the service at construction time. If it's not available at construction, defer creating `PipelineRuntime` until it is. This eliminates the nullable field entirely.

---

## Suggestions

### 11. `normalizeToolCalls` discriminates array type by first element only

**File:** `electron/main/services/orchestration/cycle-replay-service.ts:462`

```ts
if ("toolCalls" in parsed[0]!) {
```

Checks only `parsed[0]` to decide if the whole array is step-wrapped. A mixed array or an edge case where the first element is malformed returns the wrong normalization. Not likely to bite in practice but the `!` assertion and the fragile discriminant together are a maintenance trap. Consider a stricter check or validate against a schema.

---

### 12. `useSessionStore` encodes single-session assumption

**File:** `src/store/sessionStore.ts`

Zustand store holds one `status` and one `stats`. The app clearly supports multiple sessions. The "focused session" concept makes this work for now, but any UI feature that needs to show status for a non-focused session (e.g., a multi-session status column in the session list) has no store to read from and will fall back to polling via React Query. Consider whether the store needs a `Map<sessionId, status>` or whether it's intentionally focused-session-only (if so, document that).

---

### 13. `getPageData` calls `workspacePrefsRepo.get()` three times

**File:** `electron/main/services/session/session-strategy-context-service.ts:92-94`

```ts
workspaceDefaultSearchProviderId: this.deps.workspacePrefsRepo.get().defaultSearchProviderId,
workspaceDefaultModelProviderKey: this.deps.workspacePrefsRepo.get().defaultModelProviderKey,
workspaceDefaultModelModelId: this.deps.workspacePrefsRepo.get().defaultModelModelId,
```

Three separate DB reads for the same singleton row. Minor, but:
```ts
const prefs = this.deps.workspacePrefsRepo.get();
// use prefs.X
```

---

### 14. `saveAiPhase` throws NOT_FOUND if phase not pre-seeded

**File:** `electron/main/services/session/session-strategy-context-service.ts:141-144`

```ts
const current = this.deps.sessionAiPhasesRepo.getByPhase(sessionId, patch.phase);
if (!current) {
  throw new AppError(`AI phase ${patch.phase} is not configured for this session.`, "NOT_FOUND", ...);
}
```

Requires every pipeline phase to be pre-seeded in `session_ai_phases` at session creation. If any phase is missing (e.g., a new phase is added to the pipeline after the session was created), saving its config throws. An upsert here would be more robust, or at least a more informative error message telling the user to re-create the session.

---

## What's Done Well

**IPC security is solid.** `handle.ts:16-23` — the frame-parent check + BrowserWindow ownership check is the correct Electron hardening pattern. Most Electron apps skip this.

**Session lifecycle state machine.** `LEGAL_TRANSITIONS` map with `canTransition()` enforces valid transitions at the type and runtime level. Easy to reason about, easy to extend.

**`SessionRuntime` lifecycle serialization.** Using `PQueue(concurrency: 1)` to serialize pause/resume/stop operations prevents race conditions if lifecycle calls arrive faster than they resolve. The design correctly keeps the trade monitor running during pause.

**Retry logic.** `withProviderRetry` in `runtime-retry.ts` — error chain traversal, proper 429/5xx retry discrimination, schema validation errors excluded from retry, backoff array, per-attempt timeout via `AbortController`. This is careful work.

**Loop fingerprint guard.** `loopFingerprintGuard()` detecting repeated step signatures AND tool-specific patterns (search loops, verify loops) — not something you see in most agent wrappers.

**Capital reservation two-phase pattern.** reserve-on-approval → consume-on-order → release-on-close/failure with explicit status values is the right way to prevent over-commitment. The `convertApprovalToOpenOrder` transition is correctly atomic.

**Crash-recovery rehydration policy.** Demoting active→paused on startup (monitor stays live, orchestrator doesn't open new cycles) is the right call. Documented in code with the rationale.

**Zod validation at every IPC boundary.** Every handler parses `payload` through a named schema before use. No handlers trust raw IPC payloads.

**`SpendTracker` multi-cap design.** Phase cap + pipeline cap + session cap with graceful abort and log message on budget hit is well-layered. The `canContinue()` check threaded through the concurrent group runner is the right place for it.

**Domain enum constants alongside types.** `TRADING_TIMEFRAMES` as `readonly string[]` paired with `TradingTimeframe` type, plus `isTradingTimeframe()` guard — clean pattern for runtime validation without duplicating type logic.
