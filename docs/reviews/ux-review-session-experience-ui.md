# UX Review: Session creation, experiences, and instrument scope

**Date:** 2026-06-14  
**Scope:** Session create/edit modal, session list cards, session detail drawer, signal sources admin, help glossary entries tied to session onboarding  
**Trigger:** Operator assumption that manual tickers define the trading universe for experience-driven sessions — which is false for listener-style experiences (EDGAR, timer, prediction event).

---

### Overview

The product has moved to an **experience-first, signal-driven** model where most packaged experiences supply their own instruments (filings, timer ticks, prediction events). The UI still speaks in the language of **manual tickers, manual selection mode, and web-search scoping** from an earlier architecture. The result is a split brain: backend behavior follows the experience's signal source, while several surfaces still imply the operator is curating a ticker list.

The highest-impact theme is **controls and labels that remain enabled and visible when they do not apply**, instead of being hidden, disabled, or replaced with experience-specific copy.

---

### Broken Flows

#### 1. Active listener sessions show "Waiting — no live inputs"

**What the user wants to do:** Start an EDGAR (or timer/prediction) experience session and see it actively listening for signals.

**What the app does instead:** `SessionTable.tsx` sets `runningButWaiting = session.status === "active" && manualTickerCount === 0`. Any running session with an empty `instrumentScope` gets a yellow **Waiting** badge and the activity line **"Waiting — no live inputs"**, even when a listener source is subscribed and firing signals.

**Why it's wrong:** The operator's mental model is "I picked EDGAR catalyst; it's listening for filings." Empty manual tickers are **expected and correct** for listener sessions. Showing Waiting implies the session is misconfigured or idle when it may be healthy.

**Severity:** `Flow-breaking` — directly contradicts successful operation; erodes trust in status indicators.

**Fix direction:** Derive "waiting for inputs" from **session readiness** (subscribed + enabled source, or manual scope required), not from `instrumentScope` emptiness. Listener sessions with an enabled subscribed source should never show this state. Reuse `sessionRequiresInstrumentScope()` / `getSessionReadiness` semantics as the single source of truth.

---

#### 2. Manual tickers flash on screen during create-session load

**What the user wants to do:** Create an EDGAR catalyst session (the default experience).

**What the app does instead:** On modal open, `defaultInput()` sets `experienceId: "edgar-catalyst"` and `instrumentScope: "SPY,QQQ"`, but `subscribedSourceIds` starts empty until `listSignalSources()` resolves. While `subscribedSourceIds.length === 0`, `showInstrumentFilter` is true, so the **Manual tickers** textarea and **Search provider override** appear pre-filled with SPY/QQQ. After sources load, the section collapses to "Automatic listener — nothing to configure" and tickers are cleared on submit.

**Why it's wrong:** For ~200–500ms (or longer on slow IPC), the default path shows controls that **do not apply** to the selected experience. Operators reasonably conclude they must pick tickers for EDGAR.

**Severity:** `Confusing` — high frequency on every new session; primes the exact misconception reported.

**Fix direction:** Gate `showInstrumentFilter` on `signalSourcesLoaded` **and** derive visibility from experience + subscription, not subscription alone. Initialize `subscribedSourceIds` synchronously from the selected experience when sources are already cached, or show a skeleton until the coupled experience/source state is known. Remove `SPY,QQQ` from `defaultInput()` when default experience is listener-based.

---

#### 3. Manual tickers appear for timer/prediction experiences when no matching source exists

**What the user wants to do:** Create a rules or prediction-market experience from the Experience picker.

**What the app does instead:** Experience change auto-subscribes to sources matching `experience.signalSourceType`. If no timer/prediction source exists in the DB (the Signal Sources admin page only allows creating EDGAR 8-K and Web Search), `subscribedSourceIds` becomes `[]`, `showInstrumentFilter` becomes true, and the operator sees **Manual tickers** — including a default of `"SPY"` when switching to a timer experience. Submitting clears scope for listener-only paths, but validation may still require scope when no source is subscribed.

**Why it's wrong:** Timer experiences trade a **fixed symbol from the signal source config** (SPY, QQQ, BTC-USD, GC). Manual tickers are not the control surface. Showing them suggests the operator chooses the symbol, which is false.

**Severity:** `Flow-breaking` for non-EDGAR experiences on a fresh install — operator cannot complete onboarding without guessing that timer sources must exist out-of-band.

**Fix direction:** When an experience requires a source type the workspace lacks, **disable Create** with an explicit call-to-action ("This experience needs a timer signal source — not yet provisioned") rather than falling back to manual ticker UI. Long term: auto-provision experience-bound sources on first use (as tests do via `ensureExperienceSignalSource`).

---

#### 4. Readiness banner still foregrounds manual ticker count for listener sessions

**What the user wants to do:** Understand whether the session is ready to start.

**What the app does instead:** In the **armed** state, copy reads: `Live inputs: {N} manual ticker(s), {M} enabled source(s)`. For EDGAR with zero manual tickers this shows **"0 manual ticker(s), 1 enabled source(s)"** — grammatically correct but semantically odd: it implies manual tickers are a expected input category when they are irrelevant.

**Why it's wrong:** Listing zero manual tickers alongside a listener source suggests something is missing. The **`manual_only`** and footer copy ("This session runs from manual tickers only") are correct for true manual-only setups but the **armed** variant conflates two orthogonal input models.

**Severity:** `Confusing` — reinforces the misconception on every create/edit.

**Fix direction:** Branch readiness copy by input model:

- **Listener-only:** "Live input: {source name} ({type})" — no manual ticker mention.
- **Search + scope:** "Live inputs: search source + {N} scoped symbols."
- **Manual-only:** keep current manual-only copy.

---

#### 5. Session cards always show "Manual" selection mode

**What the user wants to do:** Glance at a session card and understand how instruments are chosen.

**What the app does instead:** `CreateEditSessionModal` always submits `selectionMode: "manual_shortlist"` regardless of experience or signal source. `SessionTable` renders a chip: **Manual** with tooltip "Manual mode works from the tickers you provide."

**Why it's wrong:** Signal-driven EDGAR sessions do **not** work from operator-provided tickers. The chip mislabels every experience session created through the modal.

**Severity:** `Confusing` — systematic mislabel on all session cards.

**Fix direction:** Persist and display `signal_driven` (or derive display mode from experience + subscribed source type). Hide the selection-mode chip entirely for experiences where instrument selection is source-owned. Tooltip text should describe the actual path: "Instruments come from EDGAR filings" vs "Scoped manual list."

---

#### 6. Session card "Scope" meta shows empty or stale instrumentScope

**What the user wants to do:** See what the session will trade.

**What the app does instead:** `MetaBlock label="Scope" value={session.instrumentScope}` always renders. Listener sessions saved with cleared scope show a **blank Scope field**, which reads as incomplete configuration.

**Why it's wrong:** Empty scope is the **correct** persisted state for listener sessions. Displaying the field without context implies data loss or a required field left empty.

**Severity:** `Confusing` — visible on every listener session card.

**Fix direction:** Replace "Scope" with experience-aware labels:

- Listener: **"Instruments" → "From signal source (EDGAR 8-K)"** or show the experience's fixed symbol for timer types.
- Search/manual: show `instrumentScope` or "Full universe" for search-everything scopes.
- Hide the row when it would be empty and meaningless.

---

#### 7. Session detail drawer omits Experience and Signal source; over-emphasizes Manual tickers

**What the user wants to do:** Open a session and understand its configuration.

**What the app does instead:** `SessionDetailDrawer` **Task Definition** section shows:

- **Manual tickers** (always, even when empty)
- **Search provider**
- **Last AI universe selection** (when `aiPickerEnabled`)

It does **not** show `session.experienceId`, subscribed signal source, or source type — despite `SessionSummary` carrying `experienceId` and tooltip coverage checklist marking Experience/Signal source as covered.

**Why it's wrong:** The drawer foregrounds the three fields least relevant to experience sessions and hides the two fields that explain behavior. Empty Manual tickers look like a bug. "Last AI universe selection / No cached selection yet (selector runs when you start with AI picker on)" is misleading because experience sessions use signal-seeded or rules pipelines, not AI universe discovery.

**Severity:** `Confusing` — primary inspection surface contradicts runtime model.

**Fix direction:** Reorder Task Definition:

1. **Experience** (display name, linked help)
2. **Signal source** (name, type, enabled/disabled)
3. **Instrument origin** (dynamic: "From filings" / "Timer: SPY @ 15m" / scoped tickers)
4. Hide Manual tickers, Search provider, and AI universe cache when the experience + source combo does not use them (disabled/read-only with explanation, not absent-without-comment).

---

#### 8. Signal Scope section caption wrong for manual-only (no web search)

**What the user wants to do:** Configure a session with only manual tickers and no automated source.

**What the app does instead:** When `showInstrumentFilter` is true, section caption is always **"Tell the web search what to look at."** That applies only when a web_search source is subscribed. Pure manual-only sessions (no sources) get the web-search caption anyway.

**Why it's wrong:** Caption describes a subsystem that is not involved.

**Severity:** `Friction` — wrong instruction for manual-only path.

**Fix direction:** Three captions keyed to mode: web search scoped, manual-only seed list, full-universe discovery. Disable Search provider override when no web_search source is subscribed.

---

#### 9. Experience and Signal source pickers are decoupled

**What the user wants to do:** Pick an experience and trust the session is configured coherently.

**What the app does instead:** Changing Experience auto-selects matching source types, but the **Signal Sources** toggles remain independently editable. An operator can select **EDGAR catalyst** experience then toggle **Web Search**, or deselect all sources. Backend dead-letters incompatible signals at runtime; write path does not validate source type ⊆ `experience.capabilities.signalSourceTypes`.

**Why it's wrong:** Two top-level controls fight for authority. Experience implies a packaged pipeline; unconstrained source toggles break that contract silently until runtime.

**Severity:** `Confusing` — misconfiguration discovered late via dead letters.

**Fix direction:** When an experience is selected, **filter** signal source toggles to compatible types only, or replace the picker with a read-only "Included source" row. If override is intentional (EDGAR supports mock), label it "Advanced override" with validation on save.

---

#### 10. Signal source list mislabels non-EDGAR/non-web types

**What the user wants to do:** Identify which source a session will use.

**What the app does instead:** In `CreateEditSessionModal`, secondary label logic is binary:

```tsx
{
  source.type === "edgar_8k" ? "EDGAR 8-K" : "Web Search";
}
```

Timer, prediction_event, and mock sources (used by rules/prediction experiences in tests) display as **"Web Search"**.

**Why it's wrong:** Wrong type label → wrong mental model → wrong debugging when signals don't arrive.

**Severity:** `Confusing` — any workspace with timer/prediction sources.

**Fix direction:** Map all `SignalSourceType` values to labels (reuse help glossary `signal-type-*` entries). Disable toggles for incompatible types rather than mislabeling them.

---

#### 11. Signal Sources admin cannot provision timer or prediction sources

**What the user wants to do:** Set up the infrastructure their chosen experience requires.

**What the app does instead:** `SignalSourcesPage` Add Source dialog offers only **EDGAR 8-K** and **Web Search**. Six registered experiences include four timer-driven and one prediction_event-driven, but there is no admin path to create those source types (they are not in `runSeed()` either).

**Why it's wrong:** Experiences are advertised in Create Session, but half of them cannot be fully provisioned through the UI. The create flow silently degrades to manual ticker entry (see flow #3).

**Severity:** `Flow-breaking` for timer/prediction experiences without manual DB seeding.

**Fix direction:** Either auto-create experience-bound sources when an experience is first selected/installed, or extend Add Source with timer/prediction templates pre-filled from `experience.signalSource.defaultConfig`. Until then, hide unavailable experiences from the picker or mark them "Requires setup."

---

#### 12. Help glossary and tooltips encode the old model

**What the user wants to do:** Hover for authoritative explanations.

**What the app does instead:** Examples:

- `manual-tickers`: "Symbols entered here can seed or constrain research…" — does not say they are **ignored** for listener experiences.
- `experience-rules-mean-reversion`: "manual or timer-driven stock universe" — implies manual entry is a peer path when UI hides tickers for timer sessions.
- `source-readiness-armed`: generic "at least one live input" — doesn't distinguish listener vs manual models.

**Why it's wrong:** Tooltips are the corrective layer operators reach for when confused; they currently validate the confusion.

**Severity:** `Confusing` — undermines the rest of the UI fixes.

**Fix direction:** Context-aware glossary entries or experience-scoped tooltip variants. Explicit line: "Not used for listener experiences — instruments come from the signal feed."

---

#### 13. AI picker settings implied but not operator-controlled

**What the user wants to do:** Choose between manual ticker list and AI universe discovery (legacy capability).

**What the app does instead:** Modal hardcodes `selectorSettings: { aiPickerEnabled: true }` on every submit. No UI exposes the toggle. Detail drawer shows AI universe cache UI based on that flag, suggesting AI discovery is active, while runtime always hits `manual-shortlist` entry engine because `selectionMode: "manual_shortlist"` is also hardcoded.

**Why it's wrong:** Surfaces imply a capability the operator cannot configure and the runtime does not use for experience sessions.

**Severity:** `Confusing` — ghost feature in drawer; false promise of AI universe selection.

**Fix direction:** Remove AI picker / universe cache from UI unless `selectionMode === "ai_selected_universe"` and source setup supports it. If deprecated, strip from drawer and template payload display.

---

#### 14. Edit session re-exposes manual tickers for listener sessions that had scope stripped

**What the user wants to do:** Refine an existing EDGAR session.

**What the app does instead:** Edit loads `instrumentScope` from persisted session (empty for listener sessions). If the operator deselects and re-selects sources, or sources load in a order that temporarily clears subscriptions, manual ticker fields can appear for a session that never used them. Saved listener sessions correctly clear scope on submit — but edit form may still momentarily show inherited template scope from duplication.

**Why it's wrong:** Edit should reflect **actual runtime model**, not resurrect deprecated fields.

**Severity:** `Friction` — mostly on edit/duplicate flows.

**Fix direction:** Same gating as create, keyed off persisted subscription + experience. When opening edit, fetch subscriptions first before rendering Signal Scope section.

---

### Rules the App Should Enforce (But Doesn't)

| Rule                                                                                                | Why it matters                                  | Current enforcement                                                      | Should enforce                                               |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| **If experience uses a listener/timer/prediction source, manual tickers are not an operator input** | Prevents false belief that scope limits trading | Submit clears scope in code; UI still shows/edits tickers in many states | Hide + disable Manual tickers; never count them in readiness |
| **Subscribed source type must be compatible with selected experience**                              | Experience is a packaged contract               | Runtime dead-letter only                                                 | Save-time validation + filtered source picker                |
| **"Waiting" status requires absent live inputs, not absent manual tickers**                         | Status must reflect signal pipeline state       | `manualTickerCount === 0` heuristic                                      | Readiness API / subscription + enabled check                 |
| **Selection mode displayed to operator must match instrument origin**                               | Card/detail labels are trusted                  | Always `manual_shortlist` from modal                                     | Persist `signal_driven` or derive label from experience      |
| **Signal source types must be provisionable before experience is offered**                          | Don't advertise broken packages                 | None — experiences always listed                                         | Gating on source availability or auto-provision              |
| **UI controls disabled when `sessionRequiresInstrumentScope()` is false**                           | One rule for create, edit, card, drawer         | Partial — create submit only                                             | All surfaces                                                 |

---

### What's Working

- **Experience picker with capability hints** — instrument classes and signal source types in the inline hint are useful; experience-specific help tooltips exist.
- **Auto-subscribe on experience change** — selecting an experience attempts to wire the matching source type without making the operator hunt IDs.
- **Listener collapse of Signal Scope** — when subscriptions are loaded and listener-only, the "No manual instrument picker is needed" message is accurate (when stable, not during flash).
- **Launchability and broker coverage warnings** — clear feedback when brokers don't cover experience classes; dead-letter tooltips in the drawer are well structured.
- **One active signal per session** — toggle replaces prior selection; aligns with backend constraint.
- **Submit-time scope stripping** — backend receives empty `instrumentScope` for listener sessions even if form state was dirty (correct persistence even when UI misleads).

---

### Priority Order

#### 1. Fix first (flow-breaking or state-corrupting)

1. **Session card "Waiting" badge driven by manual ticker count** (#1) — active listener sessions look broken.
2. **Timer/prediction experiences without provisioned sources fall back to manual ticker UI** (#3, #11) — onboarding path incomplete.
3. **Signal source type mislabeling** (#10) — blocks debugging.

#### 2. Fix next (confusing or high-frequency friction)

4. **Manual ticker flash on modal load with EDGAR default** (#2).
5. **Readiness banner manual ticker count for listener sessions** (#4).
6. **Session card "Manual" chip and empty Scope meta** (#5, #6).
7. **Session detail drawer missing Experience/Source; misleading Manual tickers + AI cache** (#7).
8. **Decoupled Experience vs Signal source pickers** (#9).
9. **Help glossary entries** (#12).

#### 3. Fix when you get to it (lower frequency)

10. **Signal Scope caption for manual-only** (#8).
11. **AI picker ghost UI** (#13).
12. **Edit session scope flicker** (#14).

---

### Recommended structural pattern (for implementers)

Introduce a single **session input model** derived from `(experienceId, subscribedSourceTypes, instrumentScope)`:

| Model             | Manual tickers UI       | Search provider UI | Readiness copy      | Card scope label     |
| ----------------- | ----------------------- | ------------------ | ------------------- | -------------------- |
| `listener`        | Hidden                  | Hidden             | Source name only    | "From {source type}" |
| `search_scoped`   | Required                | Optional           | Source + scope      | Scope string         |
| `manual_only`     | Required                | Hidden             | Manual tickers only | Scope string         |
| `search_universe` | Hidden (sentinel scope) | Optional           | Full universe       | "Full universe"      |

Every surface (`CreateEditSessionModal`, `SessionTable`, `SessionDetailDrawer`, start footer) should consume this model to decide **visibility, disabled state, and copy** — not re-derive from partial heuristics.

---

### Out of scope (not UX-misleading, but noted)

- Runtime behavior when timer signals arrive with empty persisted scope (selector entry-engine path) — backend concern, but operators hit it only after UI lets them create ambiguous sessions.
- Start-time confirmation modals for `no_inputs` / `waiting_for_source_enable` described in architecture spec — create modal blocks `no_inputs`, but start path does not re-confirm; lower priority than create-surface fixes.

---

_Review method: UX flow review skill — expectation vs. runtime tracing across `CreateEditSessionModal.tsx`, `SessionTable.tsx`, `SessionDetailDrawer.tsx`, `SignalSourcesPage.tsx`, `help-glossary.ts`, and experience/signal domain helpers._
