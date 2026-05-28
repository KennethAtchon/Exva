# Exva QA Guide

This guide defines how to run quality assurance for Exva end-to-end, before merge and before release.

Implements: `docs/CODING_GUIDELINES.md`

---

## 1) QA Goals

- Catch regressions in core trading/session flows.
- Validate AI harness behavior (runs, messages, cost telemetry, cycle restart).
- Validate DB schema and migration behavior in the greenfield rebuild flow.
- Ensure renderer/main/preload contracts stay aligned.

---

## 2) QA Levels

Use all four levels for high confidence:

- **Static checks**: TypeScript + lint.
- **Automated tests**: unit/integration suites via Vitest.
- **Manual scenario QA**: run through critical product journeys in the app.
- **Release sanity**: final smoke checks with fresh DB and rebuilt app.

---

## 3) Environment Setup

From repo root:

```bash
bun install
```

Recommended QA baseline:

- Use `paper_only` execution mode.
- Use test API credentials only.
- Use a fresh local DB at least once per QA cycle:

```bash
bun run db:reset
```

This runs with `EXVA_DB_REBUILD_FROM_SCRATCH=true`.

---

## 4) Required Pre-Merge Checks

Run all of these before marking QA complete:

```bash
bun run typecheck
bun run lint
bun run test
```

Expected result: all commands pass with no errors.

Automated coverage for this repo should specifically include:

- Unit coverage for broker/account helpers and session write validation.
- Service integration coverage for the onboarding path:
  - session creation,
  - AI provider/API-key configuration gate,
  - broker assignment + routing,
  - successful runtime start in both `paper_only` and `live_allowed` session modes.

Note: automated integration coverage should use mock brokers and fake provider setup. Real live-broker order submission stays a manual QA scenario only.

Recommended automated priority matrix beyond onboarding:

- Broker routing:
  - session override vs workspace default,
  - single-compatible fallback,
  - ambiguous multi-broker failure,
  - unreachable broker preflight failure.
- Risk and capital:
  - shared global pool ceiling checks,
  - approval reservation lifecycle,
  - max position capping,
  - prediction-market max exposure capping,
  - low-confidence / max-concurrency rejection.
- Templates and persistence:
  - template apply clears stale provider/broker references,
  - template build captures strategy + broker routing snapshot,
  - session edit/save round-trips preserve broker assignments and overrides.
- Workspace/session state:
  - session list filters,
  - focus vs global mode behavior,
  - runtime uptime reporting,
  - draft/active/paused/stopped transition rules.
- Instrument selection cache:
  - definition hash match vs mismatch,
  - cache clear path,
  - selector definition changes invalidate reuse.

---

## 5) Manual QA Checklist (Core)

## Session & Runtime

- Create a new session.
- Verify the user can connect the required AI provider/API key before starting.
- Verify the user can connect a broker account and assign it to the session.
- Start, pause, resume, stop session.
- Verify session status and runtime events update correctly.
- Verify no crashes when switching between session/global workspace views.
- Test both execution modes:
  - `paper_only` with a paper broker account.
  - `live_allowed` with a live broker account.

## Strategy & Risk Config

- Edit strategy profile, risk config, timeframe config.
- Save and reload; verify persistence.
- Confirm max AI/data spend values are retained after save.

## Instrument Selection & Research Cycle

- Start session with AI selector enabled.
- Verify selector runs and instruments are chosen.
- Confirm research phase events are emitted:
  - `research_phase_started`
  - `research_phase_step`
  - `research_phase_complete`
  - `research_phase_failed` (only on failure path)
- Verify cached instrument list is reused when definition hash matches.

## AI Harness Traceability

- Open a trade detail and verify:
  - agent runs visible with provider + finish reason,
  - harness message trace visible,
  - tool-call/message JSON renders.
- In Dev panel, verify:
  - event stream updates live,
  - selected event loads related runs/messages.

## Monitoring & Restart

- Ensure TradeMonitor cadence behaves by holding style.
- Close a trade (force close or broker close path).
- Verify `trade_closed` triggers orchestrator restart behavior and new cycle activity.

## Approvals & Execution

- Trigger approval-required flow.
- Approve and reject scenarios both tested.
- Verify reservation lifecycle and final trade state transitions.

## Autopsy

- Verify `Autopsy` appears in TopNav between `Trades` and `Strategy`.
- Open `Autopsy` and confirm the Period Autopsy page renders as a full page, not an overlay.
- In global scope, verify the default window uses `Since last autopsy` or falls back to the last 30 days.
- Switch to session scope, pick a session, and verify the page loads that session's latest period autopsy or empty state.
- Confirm `Run Autopsy` stays disabled when zero trades match the current window/filters.
- Run a period autopsy and verify:
  - a new `period_autopsies` row is created,
  - executive summary/performance/failure/lesson sections render,
  - the current scope shows version chips when multiple runs exist,
  - period lessons appear in the period ledger, not in Trade Review.
- Trigger a high-severity recurring lesson scenario and verify:
  - `andon_cord_fired` only comes from the period run,
  - the toast includes `View Autopsy`,
  - the Autopsy page shows the persistent Andon banner,
  - dismissing from the Andon card clears the active banner once no active Andon lessons remain.
- From Included Trades, click `Review →` and verify Trade Review opens as an overlay without leaving the Period Autopsy page.
- In Trade Review, verify the row action/title copy is `Review Trade` / `Trade Review`, not `Autopsy`.
- Promote a trade lesson into the session or global period ledger and verify the source trade lesson remains unchanged.
- Export the period autopsy as Markdown, JSON, and PDF and verify the file names use `period-autopsy-[scope]-[date]`.

---

## 6) Data & Telemetry QA

Validate DB-level observability after scenario runs:

- `agent_runs` rows created for each AI role execution.
- `agent_messages` rows created with expected `cycle_id` values.
- `api_call_log` rows created for search/tool calls:
  - provider, endpoint, call_type, credits/cost, latency, status, cache flag.
- `trade_autopsies` row created after trade review generation.
- `period_autopsies` row created after period autopsy generation.
- `autopsy_lessons` rows reflect the correct `source`, `scope`, and `period_autopsy_id` values.
- Andon rows persist in `events` with `agent_type = period_autopsy`.

Tip: use SQLite tooling and read-only queries for spot checks.

---

## 7) Regression Matrix (Minimum)

For each PR touching orchestration/AI/runtime, run at least:

- **Onboarding path**: create session -> configure AI provider/API key -> connect broker -> start runtime.
- **Happy path**: start session -> select instruments -> run cycle -> open trade.
- **Trade close path**: close trade -> restart cycle.
- **No-provider path**: missing search provider should fail with clear error.
- **Paused runtime path**: pause during in-flight cycle should abort safely.
- **Fresh DB path**: run once with `bun run db:reset`.
- **Execution-mode matrix**:
  - `paper_only` session with paper broker account.
  - `live_allowed` session with live broker account.

---

## 8) Release Candidate QA

Before tagging a release:

- Run full checks from section 4.
- Run manual checklist from section 5 on a fresh DB.
- Confirm no unexpected console errors in renderer/main logs.
- Confirm critical IPC endpoints still function:
  - trades detail,
  - events/traces,
  - strategy saves,
  - session lifecycle,
  - autopsy actions.

---

## 9) QA Sign-Off Template

Use this in PR/release notes:

```md
## QA Sign-off

- Typecheck: PASS/FAIL
- Lint: PASS/FAIL
- Tests: PASS/FAIL
- Fresh DB reset run: PASS/FAIL
- Manual core checklist: PASS/FAIL
- AI harness traces validated: PASS/FAIL
- Telemetry tables validated (`agent_runs`, `agent_messages`, `api_call_log`, `trade_autopsies`, `period_autopsies`, `autopsy_lessons`, `events`): PASS/FAIL
- Notes/Risks:
```

---

## 10) Known QA Pitfalls

- Native module ABI mismatch for `better-sqlite3` after Node upgrades:
  - fix with `npm rebuild better-sqlite3`.
- Passing tests can still hide UX regressions; always run manual checklist.
- Do not mark QA complete solely from markdown checklist state; verify behavior in app.
