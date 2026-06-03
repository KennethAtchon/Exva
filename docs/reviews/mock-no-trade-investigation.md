# Mock "rejecting trades" — root cause

**Log:** `~/.exva/logs/exva-2026-06-02.log` · **Session:** `57d152d0…` · **Date:** 2026-06-02

## TL;DR

Nothing is being _rejected_. No broker, no risk gate, no mock fill ever sees a trade.
Both cycles end at the **decision phase** with the AI workers voting `skip`, so the
orchestrator logs `No trade decision` and the cycle closes clean.

Root cause: **the research posture is decoupled from the enabled signal source.** The
session ran the `edgar_catalyst` posture (→ `processing: catalyst`), which _requires_ a
material SEC EDGAR 8-K catalyst and runs document-first EDGAR-hunting fundamental workers.
But the only enabled signal was **web_search**, and the instruments are **SPY/QQQ** — ETFs
that never file 8-Ks. The catalyst the posture demands can never arrive, so every cycle
skips.

**The signal toggle has no effect on which research phases run** (see "The actual decoupling"
below). Enabling only web_search did _not_ stop the EDGAR/document-first fundamental phase —
that phase is selected by the posture's processing mode, not by the subscribed signal. So the
flow you expected ("web search only") never existed at runtime.

## Evidence

Two cycles ran, both ended identically:

```
line 565  msg:"No trade decision for SPY; cycle complete."   (cycle 221b95a0)
line 429  msg:"No trade decision for QQQ; cycle complete."   (cycle 44f9bb10)
```

### Where it actually stops

The cycle reaches `risk_gate` but the gate runs in **1ms** and succeeds — because there's
no candidate trade to gate. There is no broker/mock execution stage in the log at all.

```
stageId:"decision"   -> step:succeeded
stageId:"risk_gate"  -> durationMs:1, step:succeeded   ← nothing to evaluate
cycle plan complete  -> orchestrator: "No trade decision"
```

### Why decision voted skip

Both decision workers (`signal-classifier`, `entry-timer`) returned `skip` with
`confidence: 0`. Their own reasoning (verbatim from `toolArgs`):

**signal-classifier (SPY):**

> "Although SPY shows a strong bullish technical breakout (trend 0.85, momentum 0.80,
> accumulation volume), the EDGAR catalyst strategy requires a material SEC filing catalyst
> which does not exist for this ETF. With no fundamental catalyst to support the entry and a
> confidence threshold of 0.8, the evidence is insufficient to act."

**entry-timer (SPY):**

> "No EDGAR catalyst identified for SPY; core prerequisite for catalyst_entry setup is absent,
> so entry is not justified despite bullish technicals."

**signal-classifier (QQQ):**

> "QQQ is an ETF that does not file 8-Ks; no EDGAR catalyst exists … confidence cannot reach
> the 0.8 threshold, so the trade is skipped."

## The conflicting inputs

The synthetic data is internally contradictory for this posture:

| Phase       | Output                                                                                                                 | Effect             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------ |
| technical   | `trendDirection: bullish`, `trendStrength: 0.85`, `momentum: 0.80`, `volume: accumulation`                             | strong BUY signal  |
| fundamental | `catalystType: "unknown"`, all catalyst fields `null`; summary: "SPY is an ETF that typically does not file Form 8-K…" | **no catalyst**    |
| review      | `tailRisks: ["required EDGAR catalyst absent — strategy prohibits entry without it"]`, `recommendation: "proceed"`     | mixed, leans block |
| decision    | both workers `skip`, `confidence: 0`                                                                                   | **no trade**       |

The `entryTimingHint` even nudges the model toward entry —
_"Sandbox clean_breakout scenario: if review approved and quote is fresh, prefer enter_now"_ —
but the hard catalyst-required rule wins over the hint.

## The actual decoupling (why the toggle did nothing)

Signal sources and research posture are **two independent session configs**:

- **Subscribed signal sources** (`web_search` only, here) — what _triggers_ a cycle and
  scopes instruments. Types: `edgar_8k | web_search | manual` (`electron/shared/domain/signals.ts`).
- **Research posture / global preset** (`edgar_catalyst` → `processing: catalyst`) — what the
  analysis phases _do_. Stored separately in `session_research_posture`
  (`electron/main/db/schema.ts:243`).

The fundamental phase picks its workers purely from the **processing mode**, never from the
enabled signal source:

```ts
// electron/main/services/pipeline/definitions/fundamental.phase.ts
function fundamentalWorkersForMode(processingMode) {
  if (processingMode === "contract") return EVENT_FUNDAMENTAL_WORKERS;
  if (processingMode === "catalyst" || processingMode === "manual")
    return CATALYST_FUNDAMENTAL_WORKERS; // ← document-first EDGAR hunters
  return STANDARD_FUNDAMENTAL_WORKERS;
}
```

`edgar_catalyst` preset → `processing: catalyst` → `CATALYST_FUNDAMENTAL_WORKERS`
(`document-extractor`, `market-reaction-checker`) run regardless of whether web_search was the
only toggled signal. That is why the log shows EDGAR 8-K searches
(`site:sec.gov "SPY" "8-K"`) on a web-search-only session.

**Design question for you to settle:** is posture _supposed_ to be independent of the signal
source, or should a web_search-only session force a web-search-compatible posture (non-catalyst
processing mode)? Right now nothing reconciles the two, so a catalyst posture + web_search
signal is a silently-incompatible combo that can never open a trade.

## Strategy facts in play (from the prompt)

```
Posture preset:       edgar_catalyst
Rules preset:         catalyst_entry
Catalyst:             required          ← the blocker
Evidence:             document_first
Wait-for-open thresh: 0.8               ← confidence must clear this for buy/sell
Instruments:          SPY, QQQ          ← ETFs, no 8-Ks
Scenario:             clean_breakout (→ open trade)   ← only supplies technicals
```

`signal-classifier` system prompt: _"If action is buy or sell, confidence must be ≥ the
wait-for-open threshold. If evidence does not support that level, use skip instead."_
No catalyst → confidence 0 → forced skip.

## Fix options

Given that you only meant to run web_search, the mismatch is the real issue:

1. **Match posture to signal (immediate, no code).** For a web_search-only session, use a
   non-catalyst posture (technical/trend) so a clean breakout alone can open a trade. Avoids
   the catalyst-required dead end entirely.
2. **Reconcile posture with subscribed signals (code).** When no `edgar_8k` source is
   subscribed, block or warn against catalyst-required postures at session creation — or
   auto-downgrade `processing: catalyst` → a web-search-compatible mode. Closes the
   silently-incompatible combo for good.
3. **Make `clean_breakout` self-consistent (sandbox code).** If the scenario keeps the
   catalyst posture, it must also inject a synthetic EDGAR catalyst; otherwise its
   "→ open trade" promise is impossible under its own posture.
4. **Use a stock that files 8-Ks** instead of SPY/QQQ, if you actually want to exercise the
   catalyst path.

Recommended: **#2** is the durable fix (the toggle and the posture should not be able to
contradict each other); **#1** unblocks your current test now.

## Resolution (2026-06-02)

Design philosophy changed: **a session runs on exactly one active signal at a time** (one
active signal per broker, since the broker hosts the session). This removes the silently-
incompatible "catalyst posture + web_search signal" combo by making the signal a single,
deliberate choice rather than a multi-select set.

Enforced at validation + UI (no schema migration; `sessionSignalSources` table and
broker→session cardinality unchanged):

- `electron/shared/validation/schemas.ts` — `subscribedSourceIds` capped at `.max(1)`.
- `electron/main/services/session/write-service.ts` — `validate()` rejects >1 source with a
  clear `VALIDATION_FAILED` error.
- `src/components/sessions/CreateEditSessionModal.tsx` — selecting a source now replaces the
  prior pick (radio semantics); caption updated.
- Test: `write-service.test.ts` — "rejects subscribing a session to more than one signal source".

### Follow-up fixes (same day) — posture↔signal reconciliation + mock self-consistency

Both remaining items from "Fix options" are now implemented; no backwards compatibility was
kept (DB was cleared).

**#2 — reconcile posture with the subscribed signal (block the bad combo).**
A catalyst-required posture (`catalystMode: required`, or `processingMode: catalyst |
contract`) now requires the session's signal to be `edgar_8k`. Saving such a posture on a
web_search (or no-signal) session is rejected with a clear `VALIDATION_FAILED` error.

- `electron/main/services/session/session-strategy-context-service.ts` — `saveResearchPosture`
  calls `assertPostureSignalCompatible`; pure predicates `postureRequiresEdgarCatalyst` /
  `postureSignalCompatible` are exported.
- Wired `signalSourceTypes: signalSourcesRepo` dep in `app-services.ts`.
- Default postures (`manual` / `preferred`) are unaffected, so session creation is not blocked.
- Tests: `posture-signal-compatibility.test.ts`.

**#3 — make `clean_breakout` self-consistent (mock delivers a catalyst).**
The happy-path scenario now carries a synthetic EDGAR 8-K (Item 1.01 material agreement) in its
web-search + URL-content fixtures, so a document-first / catalyst posture finds a real,
tradeable catalyst and can open a trade instead of skipping.

- `electron/main/services/broker/mock/mock-discovery-fixtures.ts` — `CLEAN_BREAKOUT_EDGAR_8K`
  search item + matching `edgar/clean_breakout/8k` page body; `clean_breakout` web search uses
  `CLEAN_BREAKOUT_SEARCH` (kept separate so other scenarios don't inherit the catalyst).
- Tests: `mock-discovery-fixtures.test.ts` — "surfaces a synthetic EDGAR 8-K catalyst".

Net effect: a web_search session can no longer be configured into a catalyst posture that can
never trade (#2), and a mock catalyst session on the happy path now has a catalyst to act on
(#3). Full suite green (397 tests).

## What this is NOT

- Not a broker/mock fill rejection — no execution stage was reached.
- Not a risk-gate block — gate passed in 1ms with nothing to gate.
- Not a worker/parse failure — every phase reported `rejectedCount: 0`, `failedWorkers: []`,
  `terminalToolSubmitted: true`. The skip is a _correct_ decision given the inputs.
