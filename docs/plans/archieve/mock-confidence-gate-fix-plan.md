# Implementation Plan: Mock Confidence Gate Fix

> **Ref:** `docs/reviews/mock-confidence-gate-failure-2026-05-24.md`  
> **Date:** 2026-05-24  
> **Author:** Kenneth Atchon

---

## Goal

Fix the root cause and close the defense-in-depth gaps exposed by the `clean_breakout` mock confidence gate failure. After this work:

1. Momentum-indicator (and any multi-timeframe worker) completes step 2 and calls `submit_result`.
2. Parse fallback in mock mode does not silently poison the signal bundle.
3. Signal classifier is guided to output confidence ≥ wait-for-open threshold on strong signals.
4. The mock integration test can catch confidence-gate regressions.
5. Confidence rejections surface as graceful no-trades, not cycle ERRORs (already coded, needs app restart).

---

## Phase 1 — P0: Fix loop guard signature for `get_ohlcv`

**Status:** Implemented 2026-05-24

**File:** `electron/main/services/llm/tool-loop-guard.ts`

**What:** Include `timeframe` (and `instrumentClass`) in the canonical signature for `get_ohlcv` so that multi-timeframe fetches in one step are not treated as a repeated-call loop.

**Change:**

```typescript
// BEFORE
if (
  toolName === "get_quote" ||
  toolName === "get_news" ||
  toolName === "get_ohlcv"
) {
  return (
    normalizeSymbol(readStringField(input, "symbol")) ?? JSON.stringify(input)
  );
}

// AFTER
if (toolName === "get_ohlcv") {
  const symbol = normalizeSymbol(readStringField(input, "symbol"));
  const timeframe = readStringField(input, "timeframe") ?? "";
  const instrumentClass = readStringField(input, "instrumentClass") ?? "";
  return `${symbol ?? "?"}:${instrumentClass}:${timeframe}`;
}

if (toolName === "get_quote" || toolName === "get_news") {
  return (
    normalizeSymbol(readStringField(input, "symbol")) ?? JSON.stringify(input)
  );
}
```

**Why this works:** For `get_quote(ETH) + get_ohlcv(ETH,1h) + get_ohlcv(ETH,4h) + get_ohlcv(ETH,1d)`, the `verifyCalls` signatures are now `{"ETH", "ETH:crypto:1h", "ETH:crypto:4h", "ETH:crypto:1d"}` — set size = 4, not 1 → guard doesn't fire.

**Unit tests to add** (`electron/main/services/llm/__tests__/tool-loop-guard.test.ts` or existing test file):

```typescript
describe("canonicalizeToolInput", () => {
  it("get_ohlcv includes timeframe and instrumentClass in signature", () => {
    const sig1h = canonicalizeToolInput("get_ohlcv", {
      symbol: "ETH",
      timeframe: "1h",
      instrumentClass: "crypto",
    });
    const sig4h = canonicalizeToolInput("get_ohlcv", {
      symbol: "ETH",
      timeframe: "4h",
      instrumentClass: "crypto",
    });
    expect(sig1h).not.toBe(sig4h);
    expect(sig1h).toBe("ETH:crypto:1h");
  });

  it("get_ohlcv same timeframe produces identical signatures (loop detection still works)", () => {
    const a = canonicalizeToolInput("get_ohlcv", {
      symbol: "ETH",
      timeframe: "1h",
      instrumentClass: "crypto",
    });
    const b = canonicalizeToolInput("get_ohlcv", {
      symbol: "ETH",
      timeframe: "1h",
      instrumentClass: "crypto",
    });
    expect(a).toBe(b);
  });

  it("get_quote still uses symbol-only signature", () => {
    const sig = canonicalizeToolInput("get_quote", {
      symbol: "ETH",
      instrumentClass: "crypto",
    });
    expect(sig).toBe("ETH");
  });
});
```

**Integration-level test** (run-agent-execute or loop guard integration test):

```typescript
it("loopFingerprintGuard: get_quote + 3x get_ohlcv different timeframes does NOT stop", () => {
  // Build a steps array simulating momentum-indicator step 1:
  // get_quote(ETH) + get_ohlcv(ETH,1h) + get_ohlcv(ETH,4h) + get_ohlcv(ETH,1d)
  // Assert guard() returns false
});

it("loopFingerprintGuard: 4x get_ohlcv same timeframe DOES stop (genuine loop)", () => {
  // Assert guard() returns true
});
```

---

## Phase 2 — P0b: Bullish mock fallback for `clean_breakout` momentum (defense in depth)

**Status:** Implemented 2026-05-24

**File:** `electron/main/services/pipeline/execution/worker-executor.ts`

**What:** When `parseFallback: true` occurs on `momentum-indicator` during a mock `clean_breakout` session, substitute scenario-aligned defaults instead of the neutral Zod defaults.

**Where in file:** After `parseWorkerOutput` returns with `parseFallback: true` (the `resolution.parseFallback` branch in the logger block), override `output` if conditions are met.

**Change (inside `runAIWorker`, after the `parseFallback` warn log block):**

```typescript
if (resolution.parseFallback) {
  logger.warn(
    {
      ...logCtx(),
      terminalToolName,
      retried: resolution.retried,
      finishReason: trace.finishReason,
    },
    "worker terminal output substituted empty dimension after validation failure",
  );

  // P0b: In mock clean_breakout sessions, don't let neutral fallback poison the signal.
  // Real root cause is the loop guard bug (P0). This is belt-and-suspenders.
  if (
    deps.toolContext.isMockSession &&
    deps.toolContext.mockScenarioKind === "clean_breakout" &&
    worker.id === "momentum-indicator"
  ) {
    output = {
      ...resolution.output,
      trendDirection: "bullish",
      trendStrength: 0.85,
      momentumScore: 0.8,
      rawSummary:
        "[mock clean_breakout fallback: bullish substituted after parse failure]",
    } as TOutput;
    logger.warn(
      {
        ...logCtx(),
        worker: worker.id,
        scenario: deps.toolContext.mockScenarioKind,
      },
      "mock clean_breakout: substituted bullish momentum fallback after parse failure",
    );
    parseFallback = true; // still mark as fallback for scorecard tracking
  }
}
```

**Notes:**

- This couples `worker-executor.ts` to a specific worker ID (`"momentum-indicator"`). Accept this as intentional mock-mode scaffolding.
- If other technical workers (chart-pattern, volume-profile) also parse-fallback in mock mode, they can be added here with their own scenario-aligned defaults.
- The `parseFallback: true` flag is preserved so the mock scorecard can still detect and report the issue.
- This entire block is dead code in production (only reachable when `isMockSession === true`).

**Tests:** Add a unit test in `worker-executor` or mock-trade-rehearsal tests verifying that `momentum-indicator` fallback output is bullish when scenario is `clean_breakout`.

---

## Phase 3 — P1: Signal classifier prompt confidence guidance

**Status:** Implemented 2026-05-24

**File:** `electron/main/services/pipeline/worker-prompts.ts`

**What:** Add explicit guidance that `confidence` must be ≥ the `waitForOpenThreshold` for a buy/sell to survive the risk gate. The classifier already receives `waitForOpenThreshold` in its strategy context facts; it just isn't told to comply.

**Change:**

```typescript
// BEFORE
export const DECISION_WORKERS_SIGNAL_CLASSIFIER_PROMPT = `# Signal classifier

Given compact technical, fundamental, and review signals for {instrumentSymbol}, choose direction and execution strategy.

No tools. Do not output size, stop loss, or take profit.

- Use \`skip\` when review recommends skip or evidence is insufficient.
- Match \`executionStrategy\` to the dominant setup (catalyst → event_driven, trend → trend_momentum, etc.).

When finished, call the \`submit_result\` tool; its schema defines every field.`;

// AFTER
export const DECISION_WORKERS_SIGNAL_CLASSIFIER_PROMPT = `# Signal classifier

Given compact technical, fundamental, and review signals for {instrumentSymbol}, choose direction and execution strategy.

No tools. Do not output size, stop loss, or take profit.

- Use \`skip\` when review recommends skip or evidence is insufficient.
- Match \`executionStrategy\` to the dominant setup (catalyst → event_driven, trend → trend_momentum, etc.).
- If action is \`buy\` or \`sell\`, \`confidence\` must be ≥ the wait-for-open threshold in the risk limits. If evidence does not support that level of confidence, use \`skip\` instead.

When finished, call the \`submit_result\` tool; its schema defines every field.`;
```

**Notes:**

- This is a soft fix — the model can still return confidence < threshold. The hard enforcement is in `aggregateTradeSignal` (already implemented) and the risk gate.
- The prompt already receives `waitForOpenThreshold` via `strategy-prompt-context.ts` / `riskLimits`, so the model has access to the value.
- Don't hardcode a number in the prompt — reference the threshold from context.

**Tests:** Snapshot tests for `buildWorkerPrompt` output for the signal-classifier worker should be updated.

---

## Phase 4 — P2: Mock confidence relaxation in aggregator

**Status:** Implemented 2026-05-24

**File:** `electron/main/services/pipeline/engines/finalizer/trade-signal-aggregator.ts`

**What:** For `clean_breakout` mock sessions, pass a lower effective threshold to `aggregateTradeSignal` so mock cycles exercise the trade execution path rather than getting blocked on production conservatism.

**Change:**

```typescript
// trade-signal-aggregator.ts (finalizer engine)
const mockRelaxedEntryTiming =
  ctx.toolContext.isMockSession === true &&
  ctx.toolContext.mockScenarioKind === "clean_breakout";

// P2: Relax confidence threshold for mock happy-path sessions
const effectiveWaitForOpenThreshold = mockRelaxedEntryTiming
  ? Math.min(0.6, ctx.strategyContext.riskConfig.waitForOpenThreshold)
  : ctx.strategyContext.riskConfig.waitForOpenThreshold;

return runEngineForWorker<TradeSignal>({
  // ...
  task: {
    // ...
    mockRelaxedEntryTiming,
    waitForOpenThreshold: effectiveWaitForOpenThreshold, // <-- was: ctx.strategyContext.riskConfig.waitForOpenThreshold
  },
});
```

**Notes:**

- Capped at `Math.min(0.6, ...)` — doesn't raise the threshold if production is already lower.
- Only applies when BOTH `isMockSession` and `mockScenarioKind === "clean_breakout"` are true.
- `mockRelaxedEntryTiming` is still gated on `review.recommendation === "proceed"` in `aggregateTradeSignal` (unchanged). This is intentional — confidence relaxation and timing relaxation are independent.
- This is a separate concern from P0b. P0 removes the root cause; P0b adds resilience for momentum fallback; P2 ensures confidence clears the gate even if other workers produce sub-threshold signals.

**Defer:** P2 can be deferred until P0 and P0b are verified end-to-end. It adds complexity for a case that P0 should eliminate. Ship P2 only if mock cycles still land below 0.8 confidence after P0+P0b.

---

## Phase 5 — P3: Review aggregator mock override (optional)

**Status:** Implemented 2026-05-24

When `mockOverride === "clean_breakout"` and review would be `reduce_size` due to a momentum parse-fallback artifact (detected via `technical.rawSummary` marker), recommendation is capped at `proceed`. Wired through `engines/finalizer/review-aggregator.ts` and `register-trade-signal-engines.ts`.

---

## Phase 6 — P4: Restart Electron main process

No code change required. The resilience handlers already in place:

1. `aggregateTradeSignal`: confidence < threshold → forces `action: "skip"` before risk gate runs.
2. `riskGateInputBuilder.applyOutput`: wait-for-open rejection → `applyRiskGateNoTrade` (skip, no throw).

These are live in current code. The log failure (`risk_gate` ERROR) was from a stale process. After deploying P0–P3 changes, restart Electron main to pick up all handlers.

**Verification:** Run a mock `clean_breakout` cycle. Confidence rejection (if it occurs) should appear as `no_trade` WARN, not a cycle ERROR.

---

## Phase 7 — Testing gaps to close

**Status:** Implemented 2026-05-24 (7a, 7b, 7c)

### 7a — `tool-loop-guard.ts` unit tests

Add to existing test file or create `__tests__/tool-loop-guard.test.ts`:

| Test case                                                                  | Expected                           |
| -------------------------------------------------------------------------- | ---------------------------------- |
| `get_ohlcv` with 3 different timeframes → 3 distinct signatures            | `size === 3` (no loop)             |
| `get_ohlcv` same timeframe × 4 → identical signatures                      | `size === 1` (loop detected)       |
| `get_quote` + 3× `get_ohlcv` different timeframes → 4 calls, 4 signatures  | Guard does not fire                |
| `get_quote` + 3× `get_ohlcv` same timeframe → 4 calls, 2 unique signatures | Guard does not fire (not size===1) |

### 7b — `mock-trade-rehearsal.integration.test.ts` fix

**File:** `electron/main/services/orchestration/__tests__/mock-trade-rehearsal.integration.test.ts`

Current: `waitForOpenThreshold: 0` — any confidence passes.
Fix: Set `waitForOpenThreshold: 0.8` to match the moderate preset.

Current: `runTradePipeline` is fully mocked via `vi.spyOn`, so the pipeline doesn't run.
Consider: Add a second test that does NOT mock `runTradePipeline` and instead provides mock LLM outputs, so the aggregation and risk gate code is exercised end-to-end.

```typescript
// Minimal addition to existing test
it("mock broker clean_breakout: confidence gate does not ERROR when confidence is below threshold", async () => {
  // Set waitForOpenThreshold: 0.8
  // Provide classifier output with confidence: 0.65
  // Expect: cycle completes as no_trade (skip), not ERROR
});
```

### 7c — `trade-signal-aggregator.test.ts`

Verify:

- `aggregateTradeSignal` with `waitForOpenThreshold: 0.8` and `confidence: 0.65` → `action: "skip"`
- `aggregateTradeSignal` with `mockRelaxedEntryTiming: true`, `review.recommendation: "reduce_size"` → timing relaxation NOT applied (already correct, just confirm)

---

## Execution order

```
Phase 1 (P0)   → tool-loop-guard.ts fix + unit tests          ← ship first, root cause
Phase 2 (P0b)  → worker-executor.ts mock fallback override     ← ship with P0, defense in depth
Phase 3 (P1)   → signal classifier prompt guidance             ← small, ship with P0
Phase 6 (P4)   → restart Electron main                         ← immediate after deploy
Phase 5 (P2)   → mock confidence relaxation                    ← implemented
Phase 7 (tests)→ loop guard tests + integration test fixes     ← ship with P0
Phase 4 (P3)   → review aggregator mock override               ← implemented
```

---

## Success criteria

After Phase 1–3 and Phase 6 land:

- [ ] Momentum-indicator completes step 2 and calls `submit_result` on a `clean_breakout` cycle with ETH or any crypto (verify via log: `terminalToolSubmitted: true`) — requires manual/E2E verification after Electron restart
- [x] `loopFingerprintGuard` unit tests pass for multi-timeframe fetch pattern
- [ ] Mock rehearsal cycle produces `review.recommendation: proceed` and `confidence ≥ 0.8` (or clean `no_trade` WARN if signals are genuinely mixed) — requires manual/E2E verification
- [ ] No cycle ERROR from confidence rejection — only `no_trade` + WARN — requires manual/E2E verification after Electron restart
- [x] `mock-trade-rehearsal.integration.test.ts` uses `waitForOpenThreshold: 0.8`
- [ ] CI green

---

## Files touched

| File                                                                                      | Change                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `electron/main/services/llm/tool-loop-guard.ts`                                           | P0: include `timeframe`+`instrumentClass` in `get_ohlcv` signature       |
| `electron/main/services/pipeline/execution/worker-executor.ts`                            | P0b: mock clean_breakout bullish fallback for momentum-indicator         |
| `electron/main/services/pipeline/worker-prompts.ts`                                       | P1: confidence ≥ threshold guidance in signal-classifier prompt          |
| `electron/main/services/pipeline/engines/finalizer/trade-signal-aggregator.ts`            | P2: effective threshold relaxation for mock clean_breakout                 |
| `electron/main/services/pipeline/engines/finalizer/review-aggregator.ts`                  | P3: pass mockOverride + momentum fallback artifact to review aggregator    |
| `electron/main/services/signal/aggregators/review-aggregator.ts`                          | P3: cap reduce_size → proceed for clean_breakout mock fallback artifact    |
| `electron/shared/domain/mock-scenario.ts`                                                 | Shared momentum fallback marker constant                                   |
| `electron/main/services/llm/__tests__/tool-loop-guard.test.ts`                            | New or updated: multi-timeframe guard tests                              |
| `electron/main/services/orchestration/__tests__/mock-trade-rehearsal.integration.test.ts` | Fix `waitForOpenThreshold: 0` → `0.8`; add confidence-gate no-trade test |
| `electron/main/services/signal/aggregators/__tests__/trade-signal-aggregator.test.ts`     | Verify confidence→skip with threshold                                    |
