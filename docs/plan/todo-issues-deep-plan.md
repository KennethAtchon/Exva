# TODO Issues — Deep Plan

> **Date:** 2026-05-07
> **Status:** Implemented 2026-05-08
> **Owner:** Kenneth Atchon
> **Audience:** Engineers
> **Scope:** Five open issues from docs/TODO.md — strategy presets, session resume gate, agent feed schema errors, token usage tracking, and session cycling observability.
> **Implements:** docs/engineering/CODING_GUIDELINES.md

---

## 1. Executive Summary

This document covers five distinct but related issues in the Exva trading platform. Three are correctness bugs (schema errors, token tracking, cycling gaps), one is a safety/UX feature (resume gate), and one is a new capability (strategy presets). None require backwards compatibility.

The most critical bug is the `tradeDecisionSchema` structured-output failure. The AI SDK's `experimental_output` feature breaks when the provider (OpenRouter + non-OpenAI models) returns JSON as plain text rather than through the provider's structured-output protocol. The fallback path exists (`parseFallback` flag) but the runtime throws before using it. This causes visible ERROR entries in the agent feed even when the broader session is functioning.

Token cost tracking has two independent bugs: the model pricing table only covers OpenAI/Anthropic prefixes, so all OpenRouter models fall back to claude-sonnet rates; and `ai_cost_usd` on the `trades` table is set to 0 at creation and never updated, so `dashboardStats` always reports 0 spend regardless of actual cost.

The session cycling logs issue is low-risk but impairs observability. The orchestrator has no log emission between opening a trade and receiving `trade_closed`. A trader watching the agent feed cannot tell if the session is idle (waiting normally) or stuck.

The resume gate and strategy presets are new features with no existing code to break.

---

## 2. Problem Statement

### 2.1 Strategy Presets
The Strategy → Intent tab requires traders to manually configure five independent dropdowns (strategy type, side bias, entry style, exit style, scaling mode) from scratch. Common combinations like "Momentum Long", "Mean Reversion", "Event Driven" are not surfaced. New users stare at a blank form with no guidance on what combinations are coherent.

### 2.2 Resume Gate
When a user closes the Exva window and reopens it, `session-runtime-manager.ts:rehydrateFromDb()` reads all sessions with status `active` or `paused` from the database and immediately calls `startSession` on each one. Active sessions are restarted in `active` state — the orchestrator calls `runResearchBurst`, spawns AI pipelines, and begins trading without the user taking any action. This is a correctness and safety risk: the user may reopen the app hours later in a different market context and expect to review the state before trading restarts.

### 2.3 Agent Feed Schema Errors
The agent feed shows repeated `ERROR: Trade cycle failed: Provider unreachable: No object generated: response did not match schema` messages even when the session is otherwise healthy. The `docs/output.md` log trace confirms the session started, the instrument selector succeeded, and trade cycles ran. The error originates in `runDecisionRole` when `trace.structuredOutput` is `undefined`.

Root cause: `executeRunAgent` uses `generateText` with `experimental_output: Output.object({ schema: tradeDecisionSchema })`. When using OpenRouter with Gemma (or any model that does not implement the provider's native structured-output protocol), the AI SDK cannot extract a structured object. `parseFallback` is set to `true`. But `runDecisionRole` throws `AppError("Decision maker returned no structured trade decision.", "VALIDATION_FAILED")` before attempting to parse `trace.assistantText`, which in the `output.md` logs contains valid JSON like `{"action": "no_trade", ...}`.

### 2.4 Token Usage Tracking
The `CostBreakdown` page queries `agent_runs.cost_usd` which is computed locally by `estimateCostUsd(modelId, inputTokens, outputTokens)`. The `model-pricing.ts` table only contains entries for `claude-opus`, `claude-sonnet`, `claude-haiku`, `gpt-4o-mini`, and `gpt-4o`. Any OpenRouter model (e.g. `google/gemma-4-31b-it`, `meta-llama/...`, `mistralai/...`) does not match any prefix, so it falls to `DEFAULT_RATE` which is hardcoded to claude-sonnet pricing ($3/$15 per 1M). For cheap OpenRouter models this wildly inflates local estimates.

Secondary bug: `createTradeFromDecision` and `buildTradeFromDecision` in `agent-orchestrator.ts` hard-code `ai_cost_usd: 0`. The `dashboardStats` daily spend calculation is `tradeRows.reduce((sum, row) => sum + Number(row.ai_cost_usd ?? 0), 0)` which will always return 0. The dashboard "daily API spend" metric is always zero regardless of how many AI calls were made.

### 2.5 Session Cycling Logs
`agent-orchestrator.ts:runTradeCycle` opens a trade and emits `trade_opened`, but never logs "now waiting for this trade to close before cycling again." The `attachTradeClosedListener` callback fires when `trade_closed` is emitted, but the only log is `"Trade closed; restarting research cycle for N instruments."` emitted from the callback — which runs inside a queued async task, after `runResearchBurst` completes. So the log appears after the new research burst, not immediately when the trade closes. Operators cannot distinguish "session waiting normally for trade to close" from "session is stuck" or "session exited cycling loop."

---

## 3. Goals, Non-Goals, and Invariants

### Goals

| # | Goal | Success Looks Like |
|---|------|--------------------|
| 1 | Strategy presets: add a preset picker above the intent form that pre-fills all five fields | Clicking a preset fills all dropdowns; user can still override individual fields; preset is saved as part of the session strategy |
| 2 | Resume gate: sessions in `active` state at app startup must not auto-resume; require explicit user action | On app reopen, previously-active sessions show a "Resume" button; no orchestrator starts until clicked |
| 3 | Schema error fix: decision maker succeeds when model returns JSON as plain text | Zero `VALIDATION_FAILED` errors for well-formed JSON responses; `no_trade` decisions do not surface as errors in the feed |
| 4 | Token tracking: pricing table covers OpenRouter model families; `ai_cost_usd` on trades is correct | Dashboard daily spend matches (within ~5%) what OpenRouter dashboard reports; `CostBreakdown` by-trade figures are non-zero |
| 5 | Cycling logs: emit INFO events at "waiting for trade to close" and "restarting cycle after closure" | Agent feed shows both transitions; operator can distinguish waiting from stuck |

### Non-Goals

| # | Non-Goal | Why It Is Out Of Scope |
|---|----------|------------------------|
| 1 | Real-time OpenRouter cost syncing via API | Would require a new external API integration and secrets; local estimation is sufficient for MVP |
| 2 | User-editable preset definitions | Presets are static developer-defined configurations |
| 3 | Session auto-recovery if machine lost power mid-trade | Separate incident recovery concern |
| 4 | Changing the AI SDK structured-output strategy globally | Only the decision maker role uses structured output; targeted fix is less risky |

### Invariants

| # | Invariant | Why It Must Hold |
|---|-----------|------------------|
| 1 | A session in `active` DB state must have a running orchestrator OR must have been explicitly set to `paused` during rehydration | Any gap creates trades with no monitoring |
| 2 | `agent_runs.cost_usd` must be the authoritative cost source for the `CostBreakdown` page | `trades.ai_cost_usd` is a convenience denormalization, not the source of truth |
| 3 | The decision maker must always return a `TradeDecision` or throw a non-schema error with enough context to debug | Silent swallowing of parse failures produces phantom no-trade cycles with no audit trail |
| 4 | Session `canTransition` rules must not be bypassed | Resuming from an unauthorized state breaks status accounting |

---

## 4. Current State

### 4.1 Architecture and Components

Exva is an Electron app with three process boundaries:
- **Main** (`electron/main/**`): all business logic, DB (SQLite via Drizzle), AI/broker/risk services, IPC handlers.
- **Renderer** (`src/**`): React UI with Zustand stores. No direct DB access.
- **Preload** (`electron/preload/**`): typed bridge between renderer and main.

**Session lifecycle:**
- `SessionRuntimeManager` holds a `Map<sessionId, SessionRuntime>` in memory.
- `SessionRuntime` owns a `PQueue` (concurrency=1 lifecycle queue) and delegates to `AgentOrchestrator` and a `RuntimeTradeMonitor`.
- `AgentOrchestrator` owns the trade cycle queue (`PQueue` concurrency = `max_concurrent_trades`), the instrument selection burst, and the `trade_closed` listener that re-triggers cycling.
- On app start, `rehydrateFromDb()` restarts all `active`/`paused` sessions immediately.

**AI runtime flow:**
- `AiRuntime` dispatches to role-specific methods: `runAnalyst`, `runReviewer`, `runDecisionMaker`, `runInstrumentSelector`.
- All roles funnel through `executeRunAgent` in `run-agent-execute.ts` which wraps `generateText` from the Vercel AI SDK.
- Decision maker uses `experimental_output: Output.object(...)` for structured output.
- Cost is estimated locally via `estimateCostUsd`, stored in `agent_runs.cost_usd`.

**Strategy config:**
- `StrategyConfig.tsx` renders four section tabs: Strategy, Risk, Timeframe, AI Roles.
- The "Strategy" section shows five dropdowns and a custom instructions textarea.
- No preset UI exists anywhere in the codebase.

### 4.2 Data/State Model

```
session_strategy_profile  — strategyType, sideBias, entryStyle, exitStyle, scalingMode, customInstructions
session_risk_config       — maxPositionUsd, stopLossType, stopLossPct, takeProfitPct, ...
session_timeframe_config  — primaryTradingTimeframe, holdingStyle, targetHoldDays, maxHoldDays
session_ai_roles          — per-role model/provider/prompt config
agent_runs                — per-run: inputTokens, outputTokens, costUsd, durationMs, agentType
trades                    — ai_cost_usd (always 0; never updated post-creation)
```

### 4.3 Critical Runtime Flows

**Cycling flow:**
1. `startSession` → `orchestrator.start()` → `runResearchBurst` → `enqueueTradeCycles(instruments)`
2. Each instrument: `runTradeCycle` → `runAiPipeline` (technical + fundamental + reviewer + decision) → risk check → place order → `trade_opened`
3. `trade_closed` event (from TradeMonitor polling broker) → `attachTradeClosedListener` callback → `runResearchBurst` again → new cycles enqueued

**Decision maker flow:**
1. `runDecisionMaker` → `runDecisionRole` → `executeRunAgent` with `schema: tradeDecisionSchema`
2. `generateText` with `experimental_output: Output.object({ schema })`
3. If provider supports structured output: `result.experimental_output` is populated → stored in `trace.structuredOutput`
4. If provider does NOT support structured output: `result.experimental_output` is `undefined`, `parseFallback = true`
5. `runDecisionRole` reads `trace.structuredOutput`, finds `undefined`, throws `AppError("Decision maker returned no structured trade decision.")`
6. Error propagates up to `runTradeCycle` → caught in `enqueueTradeCycles` catch → emitted as `ERROR` to agent feed

### 4.4 Pain Points and Root Causes

| Issue | Root Cause Location | Root Cause |
|-------|---------------------|------------|
| Schema errors | `runtime.ts:358-361` | `obj` check throws when `structuredOutput` is undefined; no fallback JSON parse from `assistantText` |
| Token tracking (model mismatch) | `model-pricing.ts:15` | Pricing table has no OpenRouter entries; `resolveModelPricingRates` prefix-matches nothing and falls back to claude-sonnet rates |
| Token tracking (trade cost = 0) | `agent-orchestrator.ts:544,576` | `ai_cost_usd: 0` hardcoded in `createTradeFromDecision`; never rolled up from `agent_runs` |
| Auto-resume on reopen | `session-runtime-manager.ts:111-118` | `rehydrateFromDb` calls `startSession` with runtimeStatus derived from DB status; active sessions re-enter `active` state |
| Cycling gap logs | `agent-orchestrator.ts:325-338, 592-618` | No `emitEvent` call after `trade_opened`; listener log fires after burst, not at trade-close point |

---

## 5. Desired End State

### 5.1 Strategy Presets

A `STRATEGY_PRESETS` constant in `electron/shared/domain.ts` defines ~6 named preset objects. Each preset specifies all five profile fields and optional risk/timeframe suggestions. In `StrategyConfig.tsx`, above the intent form, a horizontally-scrollable preset chip row appears. Clicking a preset calls `updateProfile` with all five fields. The individual dropdowns remain editable after selection. No new DB schema is needed — presets are purely a UI composition tool.

### 5.2 Resume Gate

`rehydrateFromDb()` transitions all previously-`active` sessions to `paused` (both in DB and in the runtime), not `active`. The runtime starts but the orchestrator is paused and the trade monitor is stopped. Sessions that were already `paused` in the DB remain paused. The UI detects paused status and shows a "Resume" CTA. The user must explicitly click Resume to move back to `active`. Sessions remain safe (all pending-approval callbacks are preserved in memory via the existing `stop` path on app close).

### 5.3 Decision Maker Fallback Parser

`runDecisionRole` gets a `tryParseDecisionFromText(text: string): TradeDecision | null` helper that:
1. Attempts `JSON.parse` on the raw text
2. If that fails, extracts the first `{...}` block using a regex
3. Validates the result against `tradeDecisionSchema` with `.safeParse`
4. Returns the parsed object or `null`

If `trace.structuredOutput` is `undefined` AND the fallback succeeds, the run proceeds normally with a log at WARN level noting the fallback was used. If both fail, throw with the original text included in the error for debugging.

### 5.4 Token Tracking

`model-pricing.ts` is expanded with OpenRouter model family prefixes. Pricing is sourced from the OpenRouter pricing page (public). Prefixes are matched longest-first (existing behavior). A wildcard `openrouter/` prefix catches any un-priced OpenRouter model and defaults to a conservative known-cheap rate.

`agent-orchestrator.ts` computes total AI cost for a trade from all four agent run results and sets `ai_cost_usd` on the trade row before insertion (for new trades) and via `patchPendingExecution` when the recheck path runs. The `dashboardStats` spend figure then reflects actual costs.

### 5.5 Cycling Logs

Two `emitEvent` calls are added:
1. In `runTradeCycle`, immediately after `this.deps.bus.emit("trade_opened", opened)`: emit `INFO` → "Trade opened; session now waiting for position to close before next cycle."
2. In `attachTradeClosedListener` callback, immediately when the callback fires (before `runResearchBurst`): emit `INFO` → "Trade closed; session restarting research cycle."

The existing `"Trade closed; restarting research cycle for N instruments."` message moves to after `runResearchBurst` completes (i.e., it keeps its current position but is now the third of three messages in the sequence).

---

## 6. Gap Analysis

| Area | Current State | Target State | Required Change |
|------|---------------|--------------|-----------------|
| Strategy presets | No presets, raw dropdowns only | Preset chips above intent form | New constant in `domain.ts`, UI chip row in `StrategyConfig.tsx` |
| Session rehydration | Active sessions auto-resume as active | Active sessions rehydrate as paused, require Resume | Change `runtimeStatus` assignment in `rehydrateFromDb`; update UI to show Resume CTA when `paused` |
| Decision maker parse | Throws on missing `structuredOutput` with no fallback | Falls back to JSON-from-text parse; only throws if text is also unparseable | Add `tryParseDecisionFromText` helper; update `runDecisionRole` |
| Model pricing | 5 hardcoded prefixes; OpenRouter models hit default claude-sonnet rates | Cover all major OpenRouter model families + wildcard | Expand `MODEL_PRICING_USD_PER_1M` array |
| Trade AI cost | `ai_cost_usd: 0` on creation, never updated | Set to sum of all four pipeline run costs before insertion | Compute total cost in `runTradeCycle` and `runApprovalRecheck` |
| Cycling logs | No log at trade-opened-waiting or trade-closed-restart | Two new INFO events bracketing the wait period | Add two `emitEvent` calls in `agent-orchestrator.ts` |

**Hard gaps:**

- **Resume gate + paused state semantics**: The existing `paused` status means "session was running and user hit pause." Reusing it for "session was active at shutdown" is semantically ambiguous. An alternative is a new `suspended` status but that requires a DB migration and changes to all status guards. Reusing `paused` is acceptable because the user action to exit it (Resume) is the same and `canTransition(paused, active)` already passes.

- **OpenRouter actual billing vs local estimate**: OpenRouter bills based on the provider's native token counts, which may differ from what the AI SDK reports via `result.totalUsage`. The local estimate will be directionally correct but not auditor-accurate. This is a known limitation to document.

- **`ai_cost_usd` rollup**: The cost is known only after the full pipeline completes. The trade row is created mid-pipeline (after `decision.output` is available but before placement). We need to either (a) insert the trade row after all four runs complete with the correct cost, or (b) insert at current point with `ai_cost_usd: 0` and update it after pipeline completes. Option (b) requires a new `updateAiCost(tradeId, cost)` method on `TradesRepo`. Option (a) means the trade row isn't visible in the UI until after the pipeline, which is current behavior anyway.

---

## 7. Options Considered

### Issue 3 — Schema Error Fix

**Option A: Text-fallback JSON parse (recommended)**

When `structuredOutput` is undefined, attempt to parse `assistantText` as JSON. Validate against `tradeDecisionSchema`. If valid, use it. If not, throw with both the parse error and a preview of the raw text.

| Dimension | Assessment |
|-----------|------------|
| Build complexity | Low — ~30 lines, one new helper function |
| Migration risk | None — no DB or API changes |
| Runtime risk | Low — fallback only activates when structured output fails |
| Reversibility | Trivially reversible |
| Team fit | Straightforward TypeScript |
| Testability | Unit-testable in isolation |
| Maintainability | Very high — self-contained |

**Option B: Force JSON mode via provider config**

Pass `response_format: { type: "json_object" }` as model settings for OpenRouter models. Some OpenRouter models support this.

| Dimension | Assessment |
|-----------|------------|
| Build complexity | Medium — needs per-provider logic in adapter layer |
| Migration risk | Low but breaks models that don't support json_object mode |
| Runtime risk | Medium — provider returns 400 for unsupported models |
| Reversibility | Medium |
| Team fit | Requires understanding of provider-specific parameters |
| Testability | Requires live provider integration tests |
| Maintainability | Adds provider-specific branches |

**Option C: Prompt-engineer the decision maker to always return parseable JSON**

Add a strict instruction block to the decision_maker prompt: "You MUST return ONLY a valid JSON object, no prose, no code fences."

| Dimension | Assessment |
|-----------|------------|
| Build complexity | Minimal |
| Migration risk | None |
| Runtime risk | High — models do not reliably obey this; does not fix the underlying parse gap |
| Reversibility | Trivial |
| Team fit | Easy |
| Testability | Hard — non-deterministic model behavior |
| Maintainability | Low — prompts drift |

**Recommendation: Option A**, with Option C added as defense-in-depth (the instruction block already exists partially). Option B is not viable as a primary fix because it would break OpenRouter models that don't support JSON mode.

---

### Issue 4 — Token Tracking

**Option A: Expand local pricing table + fix `ai_cost_usd` rollup (recommended)**

| Dimension | Assessment |
|-----------|------------|
| Build complexity | Low — add ~20 pricing rows, one cost rollup in orchestrator |
| Migration risk | DB: add `updateAiCost` to trades repo (additive, no schema change needed since column exists) |
| Runtime risk | None |
| Reversibility | Trivial |
| Maintainability | Pricing table requires periodic updates when OpenRouter changes prices |

**Option B: Fetch pricing from OpenRouter API at runtime**

| Dimension | Assessment |
|-----------|------------|
| Build complexity | High — new HTTP client, caching layer, error handling |
| Runtime risk | Medium — external HTTP at trade cycle time |
| Reversibility | Medium |
| Maintainability | High operational risk if OpenRouter API changes |

**Recommendation: Option A**. Document that prices are approximate estimates, not billing records.

---

## 8. Recommendation

All five issues should be addressed in the order of impact:

1. **Issue 3 (Schema errors)** — highest user-facing pain, straightforward fix
2. **Issue 4 (Token tracking)** — two independent bugs, both small
3. **Issue 5 (Cycling logs)** — two-line change, immediate observability win
4. **Issue 2 (Resume gate)** — behavioral feature with safety implications
5. **Issue 1 (Strategy presets)** — pure UX improvement, lowest urgency

Rejected approaches: adding a new `suspended` DB status for the resume gate is rejected because it forces a DB migration and changes to `canTransition`, `isSessionEditable`, all status UI branches, and tests — for equivalent behavior to reusing `paused`. OpenRouter price API fetching is rejected because it introduces a new external runtime dependency.

---

## 9. Detailed Design

### 9.1 Issue 1 — Strategy Presets

**`electron/shared/domain.ts`** — add:

```ts
export type StrategyPresetId =
  | "momentum_long"
  | "momentum_short"
  | "mean_reversion"
  | "trend_following"
  | "event_driven"
  | "prediction_market";

export interface StrategyPreset {
  id: StrategyPresetId;
  label: string;
  description: string;
  profile: {
    strategyType: StrategyType;
    sideBias: StrategySideBias;
    entryStyle: StrategyEntryStyle;
    exitStyle: StrategyExitStyle;
    scalingMode: StrategyScalingMode;
  };
}

export const STRATEGY_PRESETS: readonly StrategyPreset[] = [
  {
    id: "momentum_long",
    label: "Momentum Long",
    description: "Breakout entries on upward momentum. Long-only.",
    profile: { strategyType: "momentum", sideBias: "long_only", entryStyle: "breakout", exitStyle: "trailing_atr", scalingMode: "single_entry" },
  },
  {
    id: "momentum_short",
    label: "Momentum Short",
    description: "Short breakdowns with short bias.",
    profile: { strategyType: "short_bias", sideBias: "short_only", entryStyle: "breakout", exitStyle: "fixed_pct", scalingMode: "single_entry" },
  },
  {
    id: "mean_reversion",
    label: "Mean Reversion",
    description: "Fade overextended moves back to mean.",
    profile: { strategyType: "mean_reversion", sideBias: "both", entryStyle: "reversal", exitStyle: "fixed_pct", scalingMode: "scale_in_2" },
  },
  {
    id: "trend_following",
    label: "Trend Following",
    description: "Ride established trends with pullback entries.",
    profile: { strategyType: "trend_following", sideBias: "both", entryStyle: "pullback", exitStyle: "trailing_atr", scalingMode: "scale_in_2" },
  },
  {
    id: "event_driven",
    label: "Event Driven",
    description: "Trade catalysts: earnings, macro, announcements.",
    profile: { strategyType: "event_driven", sideBias: "both", entryStyle: "event", exitStyle: "time_based", scalingMode: "single_entry" },
  },
  {
    id: "prediction_market",
    label: "Prediction Market",
    description: "Probability-edge bets on binary outcomes.",
    profile: { strategyType: "prediction_market", sideBias: "both", entryStyle: "probability_edge", exitStyle: "market_resolution", scalingMode: "single_entry" },
  },
];
```

**`src/pages/StrategyConfig.tsx`** — add a `PresetRow` component above the Strategy Intent card, rendered only when `activeSection === "strategy"` and `!isLocked`:

```tsx
const PresetRow = ({
  onSelect,
}: {
  onSelect: (preset: StrategyPreset) => void;
}) => (
  <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 4 }}>
    {STRATEGY_PRESETS.map((preset) => (
      <button
        key={preset.id}
        type="button"
        title={preset.description}
        onClick={() => onSelect(preset)}
        style={presetChipStyle}
      >
        {preset.label}
      </button>
    ))}
  </div>
);
```

`onSelect` calls `updateProfile(preset.profile)`. No save is triggered — the user still must click "Save Changes."

No IPC changes, no DB changes.

---

### 9.2 Issue 2 — Resume Gate

**`electron/main/services/session/session-runtime-manager.ts`**

Change `rehydrateFromDb` to force all previously-active sessions into `paused`:

```ts
async rehydrateFromDb(): Promise<void> {
  const sessions = this.deps.sessionRepo.listByStatuses(["active", "paused"]);
  this.deps.logger.info({ sessionCount: sessions.length }, "rehydrating runtimes from db");
  for (const session of sessions) {
    // Force active sessions to paused — require explicit Resume from UI.
    if (session.status === "active") {
      this.deps.sessionRepo.setStatus("paused", session.id);
    }
    await this.startSession(session.id);
  }
  this.deps.logger.info({ sessionCount: sessions.length }, "runtime rehydration complete");
}
```

`startSession` already handles `paused` DB status correctly (line 56): it reads `session.status` from the repo and derives `runtimeStatus`. After the `setStatus` call above, `session.status` will be `paused`, so `runtimeStatus` will be `paused`, and `runtime.initialize("paused")` will be called — orchestrator starts paused, trade monitor stopped.

**UI: `src/pages/Dashboard.tsx` or wherever the session control bar lives**

The session status is already polled and exposed via `useSessionStore`. When status is `paused` and the session was previously running (not user-initiated pause), the UI should show a "Resume" button. This is indistinguishable from a user-paused session at the data level — which is fine, the UX goal is simply that the user must click Resume. The existing Resume flow (`api.resumeSession()`) is unchanged.

No new IPC channels. No DB schema changes. The existing `canTransition("paused", "active")` passes.

---

### 9.3 Issue 3 — Decision Maker Fallback Parser

**New file: `electron/main/services/ai/ai-runtime/decision-parse.ts`**

```ts
import { tradeDecisionSchema } from "@/lib/schemas";
import type { TradeDecision } from "./ai-runtime-types";

export function tryParseDecisionFromText(text: string): TradeDecision | null {
  // Try raw parse first
  let candidate: unknown;
  try {
    candidate = JSON.parse(text.trim());
  } catch {
    // Try to extract first {...} block
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      candidate = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  const result = tradeDecisionSchema.safeParse(candidate);
  return result.success ? result.data : null;
}
```

**`electron/main/services/ai/ai-runtime/runtime.ts`** — update `runDecisionRole`:

```ts
const obj = trace.structuredOutput;
if (!obj) {
  const fallback = tryParseDecisionFromText(trace.assistantText);
  if (fallback) {
    logger.warn(
      { sessionId, role, cycleId: cycleId ?? null, textLength: trace.assistantText.length },
      "decision maker structured output missing; parsed from assistant text (fallback)",
    );
    // use fallback as obj — continue as normal
    return buildDecisionResult(fallback, /* ... */);
  }
  throw new AppError(
    `Decision maker returned no parseable trade decision. textPreview=${trace.assistantText.slice(0, 200)}`,
    "VALIDATION_FAILED",
  );
}
```

The refactor extracts a `buildDecisionResult(obj, run, ...)` helper to avoid duplicating the return block. The existing `parseFallback` flag on `RunTrace` is already set to `true` in the fallback path — log it for observability.

---

### 9.4 Issue 4 — Token Tracking

#### Part A: Expand Model Pricing Table

**`electron/main/services/ai/model-pricing.ts`**

```ts
export const MODEL_PRICING_USD_PER_1M: Array<{ prefix: string; inputPer1M: number; outputPer1M: number }> = [
  // Anthropic (direct)
  { prefix: "claude-opus", inputPer1M: 15, outputPer1M: 75 },
  { prefix: "claude-sonnet", inputPer1M: 3, outputPer1M: 15 },
  { prefix: "claude-haiku", inputPer1M: 0.8, outputPer1M: 4 },
  // OpenAI (direct)
  { prefix: "gpt-4o-mini", inputPer1M: 0.15, outputPer1M: 0.6 },
  { prefix: "gpt-4o", inputPer1M: 2.5, outputPer1M: 10 },
  { prefix: "o3-mini", inputPer1M: 1.1, outputPer1M: 4.4 },
  { prefix: "o3", inputPer1M: 10, outputPer1M: 40 },
  // OpenRouter — Anthropic
  { prefix: "anthropic/claude-3-5-sonnet", inputPer1M: 3, outputPer1M: 15 },
  { prefix: "anthropic/claude-3-opus", inputPer1M: 15, outputPer1M: 75 },
  { prefix: "anthropic/claude-3-haiku", inputPer1M: 0.25, outputPer1M: 1.25 },
  // OpenRouter — OpenAI
  { prefix: "openai/gpt-4o-mini", inputPer1M: 0.15, outputPer1M: 0.6 },
  { prefix: "openai/gpt-4o", inputPer1M: 2.5, outputPer1M: 10 },
  // OpenRouter — Google Gemma / Gemini
  { prefix: "google/gemma-4", inputPer1M: 0.10, outputPer1M: 0.30 },
  { prefix: "google/gemma-3", inputPer1M: 0.10, outputPer1M: 0.30 },
  { prefix: "google/gemini-2.5-flash", inputPer1M: 0.15, outputPer1M: 0.60 },
  { prefix: "google/gemini-2.5-pro", inputPer1M: 1.25, outputPer1M: 10 },
  { prefix: "google/gemini-2.0-flash", inputPer1M: 0.10, outputPer1M: 0.40 },
  // OpenRouter — Meta Llama
  { prefix: "meta-llama/llama-4", inputPer1M: 0.20, outputPer1M: 0.60 },
  { prefix: "meta-llama/llama-3.3", inputPer1M: 0.20, outputPer1M: 0.60 },
  { prefix: "meta-llama/llama-3.1", inputPer1M: 0.15, outputPer1M: 0.15 },
  // OpenRouter — Mistral
  { prefix: "mistralai/mistral-large", inputPer1M: 2, outputPer1M: 6 },
  { prefix: "mistralai/mistral-small", inputPer1M: 0.10, outputPer1M: 0.30 },
  { prefix: "mistralai/mixtral", inputPer1M: 0.24, outputPer1M: 0.24 },
  // OpenRouter — DeepSeek
  { prefix: "deepseek/deepseek-r1", inputPer1M: 0.55, outputPer1M: 2.19 },
  { prefix: "deepseek/deepseek-chat", inputPer1M: 0.27, outputPer1M: 1.10 },
  // OpenRouter — Qwen
  { prefix: "qwen/qwen-2.5", inputPer1M: 0.07, outputPer1M: 0.20 },
  // Wildcard: unknown OpenRouter model — use conservative cheap rate
  { prefix: "", inputPer1M: 1.0, outputPer1M: 1.0 },
];
```

The empty-string prefix `""` becomes the universal fallback since every string starts with `""`. The `resolveModelPricingRates` loop iterates in reverse (longest to shortest), so the empty-string entry is checked last — it replaces the hardcoded `DEFAULT_RATE`. This is semantically equivalent to the existing default.

#### Part B: Fix `ai_cost_usd` Rollup

**`electron/main/services/orchestration/agent-orchestrator.ts`** — update `runTradeCycle`:

```ts
// After runAiPipeline returns:
const { technical, fundamental, review, decision } = pipeline;
const totalAiCostUsd =
  technical.run.cost_usd + fundamental.run.cost_usd + review.run.cost_usd + decision.run.cost_usd;

const trade = this.createTradeFromDecision(instrument, config, decision.output, totalAiCostUsd);
```

Update `createTradeFromDecision` signature to accept `aiCostUsd: number` and set `ai_cost_usd: aiCostUsd`.

Similarly in `runApprovalRecheck`: sum the four pipeline costs and call `this.deps.tradesRepo.patchAiCost(trade.id, totalAiCostUsd)` — add `patchAiCost` to `TradesRepo`.

---

### 9.5 Issue 5 — Cycling Logs

**`electron/main/services/orchestration/agent-orchestrator.ts`**

In `runTradeCycle`, after `this.deps.bus.emit("trade_opened", opened)`:

```ts
this.emitEvent(
  "INFO",
  trade.id,
  `Trade opened ${trade.side} ${trade.instrumentSymbol}; session waiting for position to close before next cycle.`,
  "orchestrator",
);
```

In `attachTradeClosedListener`, immediately when the callback fires (before the `queue.add`):

```ts
this.unsubscribeTradeClosed = this.deps.bus.on("trade_closed", (trade) => {
  if (trade.sessionId !== this.sessionId || trade.status !== "closed") return;
  if (this.deps.bus.runtimeStatus(this.sessionId) !== "active") return;
  if (this.cycleRestartInFlight) return;
  this.cycleRestartInFlight = true;
  
  // Emit immediately when trade closes — before research burst
  this.emitEvent("INFO", trade.id, "Trade closed; session restarting research cycle.", "orchestrator");
  
  this.queue
    .add(async () => {
      // ... existing runResearchBurst + enqueueTradeCycles
      this.emitEvent("INFO", null, `Research cycle complete; ${instruments.length} new cycles enqueued.`, "orchestrator");
    })
    // ...
});
```

The existing message `"Trade closed; restarting research cycle for N instruments."` changes to `"Research cycle complete; N new cycles enqueued."` to avoid duplication.

For trades that result in `no_trade` (decision.action !== "trade"), add a log at the end of `runTradeCycle`:

```ts
if (decision.output.action !== "trade") {
  this.emitEvent("INFO", trade.id, `No trade decision for ${instrument.symbol}; cycle complete, session will cycle again on next trade_closed event or queue slot.`, "orchestrator");
  return;
}
```

---

## 10. Migration / Implementation Plan

### Phase 1 — Schema Error Fix (Issue 3)

**Objective:** Eliminate false ERROR events in agent feed for well-formed decision responses.

**Files:**
- Create `electron/main/services/ai/ai-runtime/decision-parse.ts`
- Modify `electron/main/services/ai/ai-runtime/runtime.ts`

**Steps:**
1. Create `decision-parse.ts` with `tryParseDecisionFromText`.
2. In `runDecisionRole`, after `const obj = trace.structuredOutput;`, add fallback logic.
3. Ensure the WARN log includes `sessionId`, `role`, `cycleId`, `textLength`.
4. Throw with text preview if both structured and fallback parse fail.

**Done criteria:**
- Session runs 5+ cycles with gemma-4-31b-it or equivalent OpenRouter model.
- Zero `VALIDATION_FAILED` errors in agent feed when model returns valid JSON text.
- Error still thrown (with text preview) when model returns unparseable garbage.

**Rollback:** Revert the two changed files. No DB or config impact.

---

### Phase 2 — Token Tracking (Issue 4)

**Objective:** Dashboard daily spend and CostBreakdown are accurate for all provider models.

**Part A — pricing table:**
- Modify `electron/main/services/ai/model-pricing.ts`
- No DB migration, no IPC changes

**Part B — `ai_cost_usd` rollup:**
- Modify `agent-orchestrator.ts:createTradeFromDecision` signature
- Add `patchAiCost(tradeId: string, costUsd: number)` to `electron/main/db/repositories/trades-repo.ts`
- Update `runApprovalRecheck` to call `patchAiCost`

**Done criteria:**
- `CostBreakdown` by-trade entries show non-zero costs for sessions using any OpenRouter model.
- Dashboard daily API spend matches total of `agent_runs.cost_usd` for the day.
- `gemma-4-31b-it` run log shows `costUsd` ~0.10-0.15 (not ~3-15 like claude-sonnet).

---

### Phase 3 — Cycling Logs (Issue 5)

**Objective:** Agent feed shows wait/restart transitions.

**Files:** `electron/main/services/orchestration/agent-orchestrator.ts`

**Steps:**
1. Add `emitEvent` after `trade_opened` in `runTradeCycle`.
2. Add `emitEvent` at top of `trade_closed` listener before `queue.add`.
3. Change existing "Trade closed; restarting..." message to "Research cycle complete; N new cycles enqueued."
4. Add `emitEvent` for `no_trade` path.

**Done criteria:**
- Agent feed shows three sequential messages per trade: opened-waiting, closed-restarting, research-complete.
- No duplicate messages.

---

### Phase 4 — Resume Gate (Issue 2)

**Objective:** Require user action to restart sessions after app reopen.

**Files:**
- `electron/main/services/session/session-runtime-manager.ts` — `rehydrateFromDb`
- `src/pages/Dashboard.tsx` (or wherever session control is rendered) — Resume CTA visibility

**Steps:**
1. In `rehydrateFromDb`, add the `setStatus("paused", session.id)` call for active sessions before `startSession`.
2. Verify UI already shows Resume button when status is `paused`.
3. Verify `canTransition("paused", "active")` passes (it does).
4. Confirm preflight check does NOT re-run on resume (it doesn't — `resumeSession` → `runtime.resume()` → `orchestrator.resume()` → `queue.start()`).

**Done criteria:**
- Close app with active session. Reopen. Session shows as `paused` in UI.
- Clicking Resume starts trading again.
- Session that was already paused before close remains paused and has no behavior change.

---

### Phase 5 — Strategy Presets (Issue 1)

**Objective:** Add preset chips to Strategy Intent tab.

**Files:**
- `electron/shared/domain.ts` — add `STRATEGY_PRESETS`
- `src/pages/StrategyConfig.tsx` — add `PresetRow` component

**Steps:**
1. Add `StrategyPreset`, `StrategyPresetId`, and `STRATEGY_PRESETS` to `domain.ts`.
2. Add `PresetRow` to `StrategyConfig.tsx` above the Strategy Intent card.
3. Wire `onSelect` to call `updateProfile(preset.profile)`.
4. Style chip row as horizontally scrollable.

**Done criteria:**
- Six preset chips visible on Strategy tab when session is not locked.
- Clicking a preset fills all five dropdowns.
- Individual dropdowns still editable after selection.
- No preset chips visible when session is locked.

---

## 11. Testing and Verification Strategy

### Issue 3 (Schema errors)

**Unit tests** (`electron/main/services/ai/ai-runtime/__tests__/decision-parse.test.ts`):
- Input: valid JSON string → returns parsed `TradeDecision`
- Input: JSON embedded in prose with code fences → extracts and parses
- Input: JSON with `{...}` inside a text blob → extracts first block
- Input: garbage text → returns `null`
- Input: JSON missing required `action` field → returns `null` (schema validation failure)

**Integration:** Run a session with a model known to return plain-text JSON (e.g. `google/gemma-4-31b-it`). Confirm no ERROR events in agent feed for `no_trade` decisions.

### Issue 4 (Token tracking)

**Unit tests** (`electron/main/services/ai/__tests__/model-pricing.test.ts`):
- `resolveModelPricingRates("google/gemma-4-31b-it")` → returns `{ inputPer1M: 0.10, outputPer1M: 0.30 }`
- `resolveModelPricingRates("meta-llama/llama-3.3-70b-instruct")` → returns llama-3.3 rates
- `resolveModelPricingRates("unknown-provider/model")` → returns the wildcard fallback rate (not claude-sonnet)
- `resolveModelPricingRates("claude-sonnet-4")` → still returns claude-sonnet rates

**`ai_cost_usd` rollup:** After a session cycle completes, query the trade row directly and confirm `ai_cost_usd > 0`.

### Issue 5 (Cycling logs)

**Behavior test:** Start a mock session, allow a trade to open and close. Confirm the agent feed contains all three messages in order: opened-waiting, closed-restarting, research-complete.

### Issue 2 (Resume gate)

**`session-runtime-manager.test.ts`** — add:
- Mock repo returns one session with status `active`
- `rehydrateFromDb()` should call `setStatus("paused", sessionId)` before `startSession`
- Resulting runtime status should be `paused`, not `active`

### Issue 1 (Presets)

Manual browser test only (no business logic). Verify chips appear, fill fields, don't appear when locked.

---

## 12. Risks and Failure Modes

| # | Risk | Likelihood | Impact | Detection | Mitigation | Rollback |
|---|------|------------|--------|-----------|------------|----------|
| 1 | Fallback JSON parse succeeds but produces wrong `TradeDecision` (model output is stale/malformed JSON that passes the schema) | Low | Medium — bad trade decision | WARN log with text preview; human review | Schema is strict; malformed decisions would fail field validation | Remove fallback, revert to throw-only |
| 2 | `rehydrateFromDb` `setStatus` call fails mid-loop leaving some sessions in wrong state | Very Low | Medium — session partially active | Log `"runtime start failed"` for each session | Wrap per-session in try/catch already; add explicit log on transition failure | Sessions can be manually stopped via UI |
| 3 | OpenRouter pricing row mismatch — new model appears, hits wrong prefix | Medium | Low — cost estimate off | Local vs dashboard cost divergence | Review pricing table quarterly | No impact on functionality |
| 4 | `trade_closed` listener emitting event before `queue.add` causes event ordering surprise | Very Low | Low — visual only in feed | Inspect feed order in test | The immediate emit is before `queue.add`, so it appears before the research-burst log | Revert the two-line change |
| 5 | Strategy preset applies over a locked session | Low | Low — UI prevents save but dropdowns update in memory | UI test | Only render `PresetRow` when `!isLocked` | CSS display:none on chip row |

---

## 13. Operational Rollout

All five changes are main-process and renderer changes only. No server, no migration, no remote infrastructure.

Deploy order:
1. Phase 1 first (schema errors) — most visible user-facing fix.
2. Phase 2 + 3 together (token tracking + cycling logs) — no dependencies between them, small diffs.
3. Phase 4 (resume gate) — test by closing/reopening the app locally first.
4. Phase 5 (presets) — last, pure UI.

Monitor after Phase 1:
- Agent feed ERROR count should drop to zero for no_trade decisions.
- Confirm `parseFallback=true` WARN logs appear for affected models.

Monitor after Phase 2:
- Check `CostBreakdown` page shows non-zero by-trade entries.
- Compare dashboard daily spend to OpenRouter dashboard within ~20%.

---

## 14. Open Questions

| # | Question | Why It Matters | Owner | Resolution Needed By |
|---|----------|----------------|-------|----------------------|
| 1 | Should the resume gate apply to `paused` sessions too (require confirm on reopen), or only sessions that were `active`? | Affects rehydration behavior for user-paused sessions | Ken | Before Phase 4 |
| 2 | Is there a case where `trade_closed` fires for a trade that was never in `runTradeCycle` (e.g. approval-recheck path)? If so, does the new log emit correctly? | Cycling log accuracy for non-standard trade paths | Ken | Before Phase 3 |
| 3 | OpenRouter's `totalUsage` — does it report accurate token counts for all models, or does it sometimes return 0? | Affects whether the local estimate is even possible or always wrong | Ken | Verify by comparing output.md `inputTokens` to OpenRouter dashboard |
| 4 | Should preset selection persist somewhere (last-used preset ID) or is ephemeral OK? | UX only — does not affect functionality | Ken | Before Phase 5 |

---

## 15. Appendix

### Implementation Status — 2026-05-08

All five issues in this plan are implemented.

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Schema Error Fix | Implemented | Added `decision-parse.ts`, fallback validation, WARN telemetry, and unit coverage. |
| Phase 2 — Token Tracking | Implemented | Expanded OpenRouter pricing coverage, added wildcard fallback, and rolled up AI pipeline cost into `trades.ai_cost_usd`. |
| Phase 3 — Cycling Logs | Implemented | Added opened-waiting, closed-restarting, research-complete, and no-trade feed events. |
| Phase 4 — Resume Gate | Implemented | Startup rehydration now converts active DB sessions to paused; paused runtime initialization does not start the orchestrator until explicit resume. |
| Phase 5 — Strategy Presets | Implemented | Added static strategy presets in shared domain and editable preset chips on the Strategy tab when unlocked. |

Deviation: the resume gate required a stricter runtime change than the original snippet. `SessionRuntime.initialize("paused")` now avoids calling `orchestrator.start()` because starting then immediately pausing still triggers a research burst. `AgentOrchestrator.resume()` starts an unstarted paused orchestrator on explicit resume, preserving the user-visible behavior.

### A. Decision Maker Structured Output Failure Evidence

From `docs/output.md` line 70:
```json
{"scope":"run-agent-execute","step":1,"textPreview":"{\"action\": \"no_trade\", \"side\": \"BUY\", \"instrumentSymbol\": \"AAPL\", \"sizeUsd\": 0, \"confidence\": 0.0, \"reasoning\": \"...\"}","msg":"agent step text"}
```

The model returns valid JSON as plain text. The AI SDK's `experimental_output` does not detect it because it is not delivered via the provider's structured-output channel (e.g. OpenAI's `response_format.json_schema`). `parseFallback = true` is set but `runDecisionRole` throws before using it.

### B. Token Tracking Evidence

From `docs/output.md` line 29:
```json
{"modelId":"google/gemma-4-31b-it","inputTokens":30514,"outputTokens":729,"totalCostUsd":0.102477}
```

Local estimate: $0.102477. At correct gemma-4-31b-it rates (~$0.10/$0.30 per 1M): `(30514/1e6)*0.10 + (729/1e6)*0.30 = $0.00305 + $0.000219 = ~$0.003`. The `totalCostUsd` in the log is ~34x too high — it hit the claude-sonnet fallback rate.

### C. Session Status State Machine

```
draft → idle → active ⇄ paused → stopped → archived
```

`canTransition("paused", "active")` = true — resume gate uses this correctly.

### D. Relevant File Map

| File | Relevance |
|------|-----------|
| `electron/main/services/ai/ai-runtime/runtime.ts` | Decision maker structured output + fallback |
| `electron/main/services/ai/adapters/run-agent-execute.ts` | `executeRunAgent`, `parseFallback` flag |
| `electron/main/services/ai/model-pricing.ts` | Pricing table expansion |
| `electron/main/services/orchestration/agent-orchestrator.ts` | `ai_cost_usd` rollup, cycling logs |
| `electron/main/services/session/session-runtime-manager.ts` | Resume gate in `rehydrateFromDb` |
| `electron/main/db/repositories/trades-repo.ts` | New `patchAiCost` method |
| `electron/shared/domain.ts` | `STRATEGY_PRESETS` constant |
| `src/pages/StrategyConfig.tsx` | Preset chip row UI |
