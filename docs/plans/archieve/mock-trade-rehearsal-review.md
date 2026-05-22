# Mock Trade Rehearsal — Implementation Review

> **Date:** 2026-05-21  
> **Reviewer:** Claude  
> **Commit reviewed:** `42e2c60`  
> **Against:** `docs/plans/mock-trade-rehearsal-design.md`

---

## Verdict

Plan was correct. Core diagnosis (live discovery ↔ synthetic market data conflict) was right. Phases A–D shipped and work. Phase E (integration test + coherence automation) is missing. Two functional bugs will prevent the happy-path acceptance criterion from passing.

---

## What Shipped Correctly

| Phase      | Description                                                                      | Status |
| ---------- | -------------------------------------------------------------------------------- | ------ |
| A          | `BrokerRegistry` uses `MockMarketSimulator.createAdapter(kind)`                  | ✅     |
| A          | `mockScenarioKind` DB field, migration, UI picker                                | ✅     |
| B          | `createMockSearchTool` wired via `tool-factory-registry.ts` when `isMockSession` | ✅     |
| B          | `fetch-url-tool` blocks live fetches in mock sessions; returns fixture body      | ✅     |
| B          | `resolveMockToolContext` exposes `mockWebSearchData`, `mockUrlContent`           | ✅     |
| C          | Sandbox block injected into system prompt in `envelopeToMessages`                | ✅     |
| C          | Selector task hint via `augmentMockTask`                                         | ✅     |
| D          | `shapeCleanBreakoutBars` — last bar closes near range high, late volume pumped   | ✅     |
| Unit tests | All scenario edge cases (stale/wide/partial/reject/rate-limit)                   | ✅     |

---

## Bugs (Acceptance Criteria at Risk)

### 🔴 Bug 1 — `{symbol}` not substituted in `fetch_url` page bodies

**File:** `fetch-url-tool.ts:163-187`

`filterMockWebSearch` substitutes `{symbol}` in title/snippet. `createFetchUrlTool` returns `deps.mockUrlContent?.[url]` raw — the body text the AI reads still contains literal `{symbol}` strings.

```
// mock-discovery-fixtures.ts body for clean_breakout/1:
"{symbol} has broken above a well-defined resistance zone on volume..."
```

AI reads `{symbol}` not `NVDA`. Breaks narrative coherence. Degrades review/decision quality on `fetch_url` calls.

**Fix:** Apply `substituteMockSymbol` to the content string before returning it. Extract the symbol from the URL path or accept a `symbol` hint. Minimal:

```ts
// in createFetchUrlTool execute():
const symbol =
  url.match(/mock\.local\/[^/]+\/[^/]+\/[^/]+\/([A-Z]{1,5})/)?.[1] ?? "TICKER";
const content = substituteMockSymbol(
  mockContent.slice(0, MAX_CONTENT_CHARS),
  symbol,
);
```

Or pass `primarySymbols` from the session context and infer the active symbol — either way the substitution must happen.

---

### 🔴 Bug 2 — Phase 5.6 not implemented: entry timer still blocks `clean_breakout`

**File:** `trade-signal-aggregator.ts:67-69`

```ts
const timingBlocksEntry = timing === "skip" || timing === "wait";
const action = timingBlocksEntry ? "skip" : classifier.action;
```

The plan (§5.6) requires the entry timer worker prompt to prefer `enter_now` in `clean_breakout` when review approves, and/or an optional `mockRelaxedEntryTiming` flag. Neither is implemented. If the timer returns `wait` (common with `waitForOpenThreshold: 0.8`), the trade is skipped regardless of scenario.

This directly threatens **Acceptance Criterion 1**: _"Mock broker + `clean_breakout` + trend/breakout strategy completes one cycle with ≥1 `open` trade within 15 minutes."_

**Fix (minimal):** Inject sandbox guidance into the entry-timer worker prompt when `sandboxMode && mockScenarioKind === "clean_breakout"`. The `augmentMockTask` in `prompt-envelope-builder.ts:76-90` already does this for `selector` phase — extend to cover `decision` phase / `entry-timer` worker:

```ts
function augmentMockTask(
  task: Record<string, unknown>,
  phase: PipelinePhase,
  sandboxMode: boolean,
  mockScenarioKind?: MockScenarioKind | null,
): Record<string, unknown> {
  if (!sandboxMode) return task;
  if (phase === "selector") {
    // existing selector augment...
  }
  if (phase === "decision" && mockScenarioKind === "clean_breakout") {
    return {
      ...task,
      entryTimingHint:
        "Sandbox clean_breakout scenario: if review approved and quote is fresh, prefer enter_now unless a clear technical reason warrants waiting.",
    };
  }
  return task;
}
```

Or implement the `mockRelaxedEntryTiming` session flag the plan described.

---

## Risks

### 🟡 Risk 1 — `MockScenarioKind` type defined in two places

`mock-scenario-fixtures.ts:1-11` has a local copy. `@electron/shared/domain/mock-scenario.ts:1-14` has the canonical version. `mock-adapter.ts` imports from `mock-scenario-fixtures`, not the shared domain.

If a new kind is added to one but not the other, the compiler won't catch it because both are type aliases — not a union checked against the same source.

`mock-adapter.ts:12`: change import to `@electron/shared/domain/mock-scenario`. Delete `MockScenarioKind` from `mock-scenario-fixtures.ts`.

---

### 🟡 Risk 2 — `mockScenarioKind` stored as unvalidated `text()` in DB

`schema.ts:40`: `text("mock_scenario_kind")` — no constraint. An invalid value is silently defaulted to `clean_breakout` at runtime (`broker-registry.ts:resolveMockScenarioKind`). The UI picker is typed, but direct DB writes or future migrations won't be caught. Low priority for now since it degrades gracefully.

---

### 🟡 Risk 3 — `extractQuerySymbol` grabs first uppercase token, not necessarily the ticker

`mock-discovery-fixtures.ts:228-231`:

```ts
const match = query.match(/\b[A-Z]{1,5}\b/);
```

Query `"I want NVDA momentum data"` → `match[0] = "I"`. Query `"US tech sector NVDA"` → `match[0] = "US"`. Substitution fills wrong symbol into fixture titles.

Fix: prefer token that appears in `SCENARIO_PRIMARY_SYMBOLS[kind]` if available, or filter out common single-char tokens (`I`, `A`, `S`).

---

## Missing (Not Implemented)

### Phase E — Integration test

Plan §8 Phase E: _"Integration test: mock broker + `clean_breakout` + minimal strategy → expects one open trade."_

Nothing ships for this. Only unit tests exist. The happy-path AC requires a cycle-level test that proves selector → decision → broker fill → `trade.status = open`. Without it, Bug 2 above will go undetected until a live run.

---

### Coherence automation (AC §11.4)

Plan §11 AC 4: _"For primary symbol in `clean_breakout`, automated check confirms news + search snippets + OHLCV trend direction all match `bullish`."_

Not implemented. `SCENARIO_EXPECTED_OUTCOME` is defined but unused in any assertion. A simple test that calls `MockMarketSimulator.fixturesFor("clean_breakout")` and checks directional tone of news/search text would satisfy this.

---

### Session debug panel (§9)

Low priority. No surface in the UI showing which tools used mock vs live path, or evidence coherence checklist. Not a correctness issue, but valuable for diagnosing future regressions. Track as a follow-up.

---

### Deterministic CI mode (§10)

`EXVA_MOCK_DETERMINISTIC` env flag not implemented. Marked optional in the plan — this is fine to skip. Only needed if CI flakiness from LLM variance becomes a problem.

---

## Plan Quality Notes

The plan was the right diagnosis and the right fix. A few places where the plan underspecified:

1. **§5.6 was too vague** — "entry timer worker prompt (mock only)" didn't specify WHERE to inject it. The implementation did `augmentMockTask` for selector only, leaving decision phase un-addressed. Plan should have named the affected worker ID (`entry-timer`) and shown the injection point explicitly.

2. **`{symbol}` substitution scope not stated for URL content** — The plan said fixtures should use `{symbol}` substitution but only showed it in `search_web` results. `fetch_url` page bodies were not explicitly called out. Easy to overlook during implementation.

3. **`SCENARIO_EXPECTED_OUTCOME` semantics ambiguous** — Plan §7 mixes "AI outcome" (skip/BUY) with "policy outcome" (risk gate allow/reject). The implemented map uses "allowed"/"rejected" but `sideways_chop: "allowed"` means the risk gate passes IF the AI returns BUY — which it won't. The map is technically about gate behavior, not full cycle outcome. Rename or document the distinction.

4. **Plan correctly excluded `wait-for-open` from production** but didn't specify the mock injection point clearly enough to prevent it from being skipped in implementation.

---

## Summary

Two functional bugs must be fixed before Acceptance Criterion 1 can pass:

- `{symbol}` left raw in `fetch_url` body content (coherence failure)
- Entry timer not nudged toward `enter_now` in `clean_breakout` mock mode (AI will skip)

Everything else is either shipped correctly, a low-risk tech debt item, or a deliberately deferred nice-to-have.
