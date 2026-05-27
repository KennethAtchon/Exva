# Prompt: Period Autopsy — Product Spec Redesign

> **Purpose:** Run this prompt in a fresh agent session to produce a **replacement product specification** for Exva’s Autopsy system. The output is **not** implementation code — it is developer-facing product + migration documentation.
>
> **Author intent (founder, 2026-05-26):** The shipped v1 autopsy (per closed trade) was built from a spec the founder did not fully align with. The **real** autopsy is a **time-window review** across many trades — session-scoped or global — with lessons and Andon Cord tied to **learning over periods**, not one-off tickets.

---

## Your mission

You are a senior product + systems designer for Exva (Electron + React trading ops app).

**Deliver two Markdown documents** in this repo:

| #   | Output path                                   | Skill to follow                                                                                  |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `docs/design/period-autopsy-product-spec.md`  | **`pm`** — full feature specification (screens, states, data, edge cases, IPC at contract level) |
| 2   | `docs/plans/period-autopsy-migration-plan.md` | **`plan`** — phased migration from current trade autopsy, rollback, deprecation                  |

Before writing, **read the codebase and existing docs** (listed below). Do not invent APIs that contradict existing patterns without calling out the delta explicitly.

Optionally apply **`doc-researcher`** to tighten prose on both outputs, and **`system-designer`** for a short architecture section inside the spec (data model + service boundaries). Do **not** write implementation code in this session unless explicitly asked later.

---

## Product truth (binding — from founder)

### What autopsy is _for_

Autopsy answers: **“Over this period, how did we trade, what patterns failed, are we fixing past lessons, and when do we need human intervention?”**

- **Primary surface:** Top-level nav item **“Autopsy”** — same tier as Dashboard, Trades, Sessions (not buried on trade rows).
- **Primary scope:** A **time window** (date range) over **many closed trades**, not a single trade.
- **Workspace context:** Autopsy works in **global mode** and **focused session mode**, but the Autopsy page itself is **not owned by** session focus — user explicitly chooses scope:
  - **Global:** all closed trades in range (respecting environment: paper vs live as today).
  - **Session:** closed trades for one selected session in range.
- **Default window:** “Since last autopsy” for the chosen scope (global or session). User can override start/end.
- **Outcome:** Scholarly mentor-style review — patterns, process, risk, behavioral drift, recurring mistakes — grounded in DB queries (trades, agent messages, runs, costs, prior autopsy records, prior lessons).

### What autopsy is _not_ (for the main system)

- **Not** “forensics on one ticket” as the main value prop. One-off trades happen; isolated trade review has limited strategic value.
- **Not** tied to opening a trade drawer or hunting a row action as the primary path.

### Secondary: Trade drill-down autopsy (keep, scope down)

Keep a **narrow** “Trade review” (rename in UX spec — avoid calling it the main “Autopsy”):

- Entry: Trades row / Trade detail — optional deep-dive on **one closed trade**.
- **Same or simplified** multi-phase LLM pipeline is acceptable.
- **Explicitly out of scope for this mode:**
  - Andon Cord
  - Cross-trade lesson validation
  - “Since last autopsy” session/global memory
  - Recurrence tracking that escalates to operator alert
- Purpose: “What went wrong on _this_ trade?” — debugging and curiosity, not continuous improvement.

### Andon Cord (only on period autopsy)

Andon Cord is **only** for **period autopsy** (session or global):

- On a new period autopsy run, load **prior lessons** for that scope (session lessons vs global lessons — spec must define storage and keys).
- Compare new findings against open/pending/implement lessons from **previous period autopsies**.
- If the same class of problem recurs without resolution past a threshold → emit `andon_cord_fired` (existing event bus + toast pattern).
- User-facing copy: systemic failure to learn, needs operator input beyond another AI summary.

**Remove or disable** Andon Cord triggers from **trade-level** autopsy generation in the migration plan (today `TradeAutopsyService.validateLessons` runs after every trade autopsy).

### Lessons

- **Period autopsy** creates and manages the canonical lesson ledger for a scope.
- **Trade drill-down** may suggest lessons locally but must **not** feed Andon Cord or global/session lesson validation unless user explicitly promotes (spec decides: auto-promote vs manual — prefer explicit promotion to avoid noise).

### Model & filters (from original `docs/TODO.md`)

Period autopsy UI must support:

- Model picker from configured AI providers (workspace defaults + override per run).
- Filters for what data enters the prompt (e.g. instrument class, broker, outcome, min size, tags, include/exclude agent phases).
- History of past period autopsies (list, open, compare, export).
- Manage lesson statuses: pending → implemented → validated | recurring | dismissed.

---

## What exists today (you must reconcile)

Read these before writing:

### Product / plans

- `docs/design/autopsy-product-spec.md` — **v1 trade-centric spec** (explicitly out of scope: session/global autopsy). Treat as **historical**; new spec supersedes for navigation and primary flows.
- `docs/plans/autopsy-impl-plan.md` and `docs/plans/archieve/autopsy-impl-plan.md` — implementation assumptions (overlay per trade, `selectedAutopsyTradeId`).
- `docs/TODO.md` — founder’s original bullet list (period window, since last autopsy, lessons DB, Andon).

### Backend

- `electron/main/services/analytics/trade-autopsy-service.ts` — 5-phase pipeline per `tradeId`; calls `validateLessons` → Andon.
- `electron/main/db/schema.ts` — `trade_autopsies`, `autopsy_lessons` (lessons keyed by `autopsy_id`, `trade_id`, `session_id`).
- `electron/main/ipc/trading/autopsy.ts` — IPC handlers.
- `electron/shared/domain/autopsy.ts` — types: `TradeAutopsyRecord`, `AutopsyLesson`, `AndonCordPayload`, etc.
- `electron/preload/exva-api.ts` — `window.exva.autopsy.*`

### Frontend

- `src/pages/AutopsyPage.tsx` — full-screen overlay per trade.
- `src/App.tsx` — `autopsyTradeId` state; no TopNav page key.
- `src/pages/TradesPage.tsx`, `src/pages/TradeDetail.tsx` — ⚕ Autopsy entry points.
- `src/components/autopsy/*` — LessonsPanel, ChatHistoryModal.
- `src/components/RuntimeEventToast.tsx` — Andon toast listener.

### Tests

- `electron/main/services/analytics/__tests__/trade-autopsy-service.test.ts` — lesson validation + Andon behavior.

---

## Required content in `period-autopsy-product-spec.md`

Follow the **`pm`** skill structure completely. Additionally **require** these sections:

### A. Naming & information architecture

- TopNav: new `PageKey` / label (recommend **“Autopsy”**).
- Clear naming split:
  - **Period Autopsy** (main)
  - **Trade Review** or **Trade Autopsy** (secondary, scoped)
- Where each lives; no user confusion that row-level ⚕ is “the” autopsy.

### B. Period Autopsy page (primary)

Wireframe-level layout (ASCII or bullet tree):

- Scope toggle: Global | Session (session picker when Session).
- Date range: preset “Since last autopsy” + custom range; show last run timestamp.
- Filters panel (persist per scope or per user — decide and document).
- Model picker.
- Primary CTA: **Run autopsy** / **Regenerate**; loading and cost estimate if feasible.
- Results areas (minimum):
  - Executive summary for the window
  - Performance & process patterns (win rate, sizing, timing, regime notes)
  - Recurring failure modes
  - Lessons (new + updated statuses)
  - Andon status / history for this scope
  - Drill-down list of trades included (link opens Trade Review, not replace Period page)
- Past autopsies list with version/history semantics.

### C. Data model (new + migrated)

Specify new tables/types, e.g. (names are suggestions — you decide):

- `period_autopsies` (or `autopsy_runs`) with: `id`, `scope` (`global` | `session`), `session_id` nullable, `window_start`, `window_end`, `model_id`, `filters_json`, `summary_structured_json`, `phase_traces_json`, `trade_ids_json` or join table, `created_at`, etc.
- `period_autopsy_lessons` vs reuse `autopsy_lessons` with nullable `trade_id` and `period_autopsy_id` — **compare options in spec**; pick one with rationale.
- How **global** lessons relate to **session** lessons (inheritance, separate namespaces, or tags).

### D. LLM pipeline (period)

- Phases appropriate for **many trades** (not copy-paste of 5 single-trade phases unless adapted).
- Input assembly: query closed trades in window; cap/count strategy when N is large (sampling, aggregation first pass + drill-down — **must** specify).
- Token/cost guardrails.
- Fallback behavior when LLM unavailable.

### E. Andon Cord rules (period only)

- Thresholds, severity, recurrence definition across windows.
- Payload shape (reuse `AndonCordPayload` or extend with `periodAutopsyId`).
- UI: toast + persistent banner on Autopsy page + optional Sessions attention hook.

### F. Trade Review (secondary)

- Minimal screen/overlay changes from today.
- Explicit “Promote to session/global lesson?” if any bridge exists — default **no** auto-promote.

### G. User stories & scope

Include founder stories plus operators reviewing paper vs live.

**In scope / out of scope** tables must explicitly list:

| In scope (v2 primary)         | Out of scope (defer)                                         |
| ----------------------------- | ------------------------------------------------------------ |
| Period autopsy nav page       | Real-time autopsy on open trades                             |
| Global + session windows      | Auto-apply strategy changes                                  |
| Lesson + Andon on period runs | Behavioral heatmaps dashboard (unless minimal table in-page) |
| Trade Review without Andon    | Cross-workspace autopsy                                      |

### H. IPC / API contract (names only)

List new channels, e.g. `autopsy:period:run`, `autopsy:period:list`, `autopsy:period:get`, `autopsy:period:lessons:*`, and which **trade** channels remain (`trades:autopsy:*`).

### I. Acceptance criteria

Testable bullets for QA (map to `docs/engineering/project-qa-guide.md` updates).

---

## Required content in `period-autopsy-migration-plan.md`

Follow the **`plan`** skill structure. Additionally **require**:

### 1. Problem statement

Why v1 trade-as-primary autopsy underserves the product goal (use founder framing: one-off trades vs learning over time).

### 2. Migration principles

- **No big-bang:** ship Period Autopsy page behind nav while Trade Review still works.
- **Data preservation:** existing `trade_autopsies` and `autopsy_lessons` rows remain readable; define mapping or legacy UI.
- **Andon cutover:** disable trade-level `validateLessons` / Andon emit; enable only on period runs (feature flag name suggested).
- **Rename UX** without breaking IPC in phase 1 if needed.

### 3. Phased rollout (minimum 3 phases)

Example structure (you refine):

| Phase | Deliverable                                                                | Risk   |
| ----- | -------------------------------------------------------------------------- | ------ |
| 1     | Schema + PeriodAutopsyService + read-only history UI shell                 | Low    |
| 2     | Full period pipeline + lessons + Andon on period only                      | Medium |
| 3     | Demote trade autopsy UI; migrate lesson links; deprecate trade-level Andon | Medium |

Each phase: goals, tasks, files touched (directory-level), done criteria, rollback.

### 4. Code touch list (checklist)

Directories/files likely changed — use as migration checklist:

- `electron/main/db/schema.ts` + migration SQL
- `electron/main/services/analytics/`
- `electron/main/ipc/trading/autopsy.ts` → possibly split `period-autopsy.ts`
- `electron/shared/domain/autopsy.ts`
- `electron/shared/ipc/channels.ts`
- `src/components/TopNav.tsx` — add page key
- `src/App.tsx` — route period page; keep `autopsyTradeId` for Trade Review overlay
- `src/pages/` — new `PeriodAutopsyPage.tsx`; rename/narrow `AutopsyPage.tsx`
- `src/lib/exva.ts`
- Tests under `electron/main/services/analytics/__tests__/`

### 5. Lesson & Andon data migration

- What happens to lessons created under trade autopsies today?
- Options: (a) archive as `source=trade`, (b) import into period ledger, (c) read-only legacy — **pick one** with steps.

### 6. Documentation updates

List docs to supersede or annotate:

- `docs/design/autopsy-product-spec.md` → banner pointing to period spec
- `docs/engineering/project-qa-guide.md` — Autopsy section rewrite
- `docs/TODO.md` — mark period autopsy designed; link new spec

### 7. Open questions

End with numbered questions **only** if codebase research cannot resolve; otherwise decide in-spec.

---

## Anti-patterns (do not do these in the spec)

- Do not make trade-level autopsy the primary nav experience.
- Do not attach Andon Cord to single-trade runs.
- Do not assume the user is always in a focused session when using Autopsy.
- Do not spec “autopsy tab inside trade detail” as the main home (overlay OK for Trade Review).
- Do not ignore token limits when window includes 200+ trades — spec must address scale.

---

## Quality bar

A developer reading **only** the two output docs should be able to:

1. Implement Period Autopsy without asking “where does this live in the nav?”
2. Know exactly what to remove from trade autopsy (Andon, validation).
3. Run migrations without losing historical trade autopsies.
4. Write QA steps and IPC contracts.

If the current v1 spec conflicts with this prompt, **this prompt wins**.

---

## Session kickoff (copy below the line for the agent)

---

You are executing `docs/prompts/autopsy-period-review-spec-redesign-prompt.md`.

1. Read the **Product truth**, **What exists today**, and all referenced files.
2. Use the **`pm`** skill to write `docs/design/period-autopsy-product-spec.md`.
3. Use the **`plan`** skill to write `docs/plans/period-autopsy-migration-plan.md`.
4. Add a short supersession note at the top of `docs/design/autopsy-product-spec.md` linking to the new spec (2–3 lines only).
5. Reply with a summary of decisions made and any open questions left in the migration plan.

Do not implement code in this session.
