# Finish Line — Master Index & Completion Contract

> **Date:** 2026-07-12
> **Status:** Code complete across docs 01–09 (2026-07-13); **folder not fully closed** — acceptance pending Ken litmus, 7-day soak, and real-broker keys where noted.
> **Owner:** Ken (sole operator, sole user)
> **Audience:** Implementing AI agents + Ken
> **Scope:** Everything left. This folder supersedes the "deferred" markers in `exva-50-to-100-deep-plan.md`, `phase-6-config-diet.md`, `polymarket-paper-mode.md`, and `legacy-ipc-inventory.md`. When every doc in this folder is done **and** Ken's acceptance gates pass, Exva is done.

---

## THE COMPLETION CONTRACT (read first, non-negotiable)

This project has exactly one user: Ken, on this machine. It will never be published, hosted, or handed to another team. Therefore:

1. **"Done" means DONE.** Every task in every doc in this folder must be fully implemented, tested, and verified live before the doc is marked complete. There is no "phase 2", no "deferred", no "follow-up PR", no "out of scope for now". If you finish a doc and anything in it is not implemented, the doc is NOT done — say so explicitly and keep working.
2. **No compatibility theater.** There are no external consumers. No deprecation windows, no dual-write periods longer than the single session that performs the cutover, no legacy shims "kept just in case". When a doc says delete, delete in the same session. The only back-compat that matters is: **the daily SQLite DB must never brick** (run `scripts/db-backup.sh` — created in doc 04 — before every schema migration).
3. **No stubs, no placeholders.** A function that throws `not implemented` is a bug, not a milestone. `TODO`, `TBD`, "handle appropriately", and empty catch blocks are forbidden in landed diffs.
4. **Every doc leaves `bun run check` green** and the app launchable on the real daily DB. Run it; don't assume it.
5. **Verify with your own eyes.** Every UI change: screenshot it and look at it. Every runtime change: drive the real flow (start session → signal → decision → order → close) and read the actual DB rows. "The tests pass" is necessary, not sufficient.
6. **Fail loud.** If a task turns out to be impossible as specified (external API gone, assumption wrong), stop and report exactly what blocks it and what you propose instead. Do not silently narrow scope.
7. **In-app docs + glossary updated in the same session** as any operator-visible change (invariant I9 from the 50→100 plan, still binding).
8. **Standing invariants remain binding:** renderer never touches SQLite/brokers/secrets directly (IPC only); deterministic gates own money decisions, LLMs never choose size; every live order passes RiskEngine → allocation gate → order-policy gate; paper by default, live requires per-session readiness ack; every decision writes a `signal_observation`; secrets stay in Keychain as `secretRef`s; Bun only; TypeScript strict; Zod on every IPC payload; Vitest.

## Execution order

Docs are ordered by dependency. Within a doc, tasks are ordered. Docs marked ∥ can run in parallel with the previous one.

| #   | Doc                                                                                                                          | What it finishes                                                                                                                                                                      | Depends on                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 01  | [`01-residual-debt-teardown.md`](./01-residual-debt-teardown.md) ✅ 2026-07-12 (code; live-DB eye verify pending)            | Kills every remaining compat bridge: `SessionConfig`/`toLegacySessionConfig`, `signal-bridge.ts`, timer-typed schedule identity rows, preload orphans, autopsy-table merge            | nothing                                        |
| 02  | [`02-config-diet.md`](./02-config-diet.md) ✅ 2026-07-13 (code; live-DB eye verify pending)                                  | Phase 6, fully executed: 9 session-config tables + 5 preset tables → one versioned `session_strategy_config` document                                                                 | 01 (SessionConfig gone first)                  |
| 03  | [`03-broker-completion.md`](./03-broker-completion.md) ⏳ 2026-07-13 (code+mock cert; real-broker certs pending Ken keys)    | Kalshi, Tradier, Kraken adapters made real (order placement, cancel, event feeds, data); Alpaca websocket order feed; adapter certification suite                                     | nothing ∥                                      |
| 04  | [`04-proof-and-ops-hardening.md`](./04-proof-and-ops-hardening.md) ✅ 2026-07-13 (code; T3/T7/Alpaca G1 pending Ken)         | Automated G1 proof harness, `db-backup.sh`, headless/launchd mode, supervisor completeness, Telegram sink                                                                             | nothing ∥                                      |
| 05  | [`05-polymarket-paper-mode.md`](./05-polymarket-paper-mode.md) ⏳ 2026-07-13 (code+prove mode 3; multi-day soak pending Ken) | Executes the ghost-trade paper-mode draft in full                                                                                                                                     | 03 helpful, not required                       |
| 06  | [`06-alpha-sources.md`](./06-alpha-sources.md) ⏳ 2026-07-13 (code+check green; live evidence pending Ken)                   | All §9.7 sources implemented: Form-4 insider clusters, volume scanner, calendar events, options-flow v2 (Tradier verticals), crypto funding/basis, news wire, cross-venue dislocation | 03 (Tradier/Kalshi/Kraken), 02 (input catalog) |
| 07  | [`07-ui-consolidation.md`](./07-ui-consolidation.md) ✅ 2026-07-13 (code; Electron eye/screenshots pending Ken)              | 17 pages → 5 hubs, done as a real redesign                                                                                                                                            | 02 (config UI), 06 (new source UI)             |
| 08  | [`08-new-features.md`](./08-new-features.md) ⏳ 2026-07-13 (code+check/prove; eye/phone pending Ken)                         | Novel operator features: command palette, Backtest Lab, Data Doctor, morning briefing, what-if replay, portfolio equity curve, kill-switch panel                                      | 07 (hubs exist)                                |
| 09  | [`09-smoothness-pass.md`](./09-smoothness-pass.md) ⏳ 2026-07-13 (code complete; acceptance pending Ken)                     | Everything-actually-works sweep: error surfacing, empty states, startup, seed data, final live soak                                                                                   | all                                            |

## How an agent should work a doc

1. Read this index, then the doc, end to end, before writing code.
2. Re-verify the doc's "Current state" claims against the code (things drift); if a claim is stale, update the doc in place and proceed.
3. Work tasks in order. After each task: `bun run check`, then the doc's verification step.
4. When the doc's **Done criteria** checklist is fully checked (by actual verification, not optimism), update this index's table with ✅ and the date.
5. Never mark partial. If interrupted, leave a dated `> PROGRESS:` note at the top of the doc stating exactly which tasks are done/verified.

### User journey

The journey this whole folder buys: Ken's Mac runs Exva headless from login. Each morning his phone gets one briefing — P&L, trades, ladder moves, anything needing him. When he opens the app, five hubs answer everything: am I making money, what's running, what did the research find, what needs a tap. Every broker works, every source is real, every "deferred" note in the repo is gone. When something degrades, the phone buzzes before he'd have noticed. Per-doc journeys live in each doc.

### TLDR: shortcuts taken

- Execution-order dependencies are judgment calls from one recon pass (2026-07-12); an agent may discover a tighter coupling (e.g., 06 needing 02's input-catalog seeds in a specific shape) and should update the table rather than suffer.
- Effort is not estimated per doc — deliberately. Estimates were wrong in every prior plan and invite scope-trimming; the contract above replaces them.
- I did not re-run the app before writing this folder; "phases 0–5 landed" is from code inspection (directories, adapters, supervisor exist) and the 50→100 doc header, not a live run. Doc 04 makes the live run mandatory and automated.

### Core decisions (sign-off required)

| #   | Decision                                                                                           | Recommendation                   | Why Ken must sign                                                                      |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | No-deferral contract: every doc fully lands, no compat shims survive their session                 | Yes — Ken explicitly demanded it | It forbids the "safe partial merge" style; riskier per-session, cleaner forever        |
| 2   | Config diet executes now (doc 02), not "when pain warrants"                                        | Yes                              | Contradicts the previous deferral note; it's churn-heavy and user-visible              |
| 3   | IBKR and Schwab adapters are **dropped permanently** (not deferred — deleted from ambition)        | Yes                              | 50→100 left IBKR as a "spike-gated maybe"; this folder closes it: no strategy needs it |
| 4   | Social-sentiment sources stay banned; §9.7 list is the complete alpha-source roster                | Yes                              | Keeps "everything implemented" finite                                                  |
| 5   | UI consolidation is a rebuild per the redesign rules (new spatial structure), not a nav re-shuffle | Yes                              | Doc 07 is the largest UI change ever made to Exva                                      |
