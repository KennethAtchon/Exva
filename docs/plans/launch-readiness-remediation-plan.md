# Exva Launch Readiness Remediation - Plan

> **Date:** 2026-05-16
> **Status:** Draft
> **Deciders:** Kenneth Atchon

## 1. Problem Statement

Exva's current architecture is strong enough to support a real launch-readiness push, but the application is not yet safe or coherent enough to be treated as a trustworthy autonomous trading desktop app. The biggest problems are not cosmetic. Several system boundaries that matter most for a trading product are still incomplete or internally inconsistent: broker adapters do not uniformly support real position and close semantics, session stop and restart behavior is still development-oriented rather than autonomy-safe, live-readiness is materially thinner than the intended hard gate, critical renderer/preload/main contracts have already drifted, operator telemetry still contains synthetic values, approval rechecks can bypass the final policy gate, and the verification surface is red across typecheck, lint, and parts of the test suite. If nothing changes, the most likely outcome is not just launch delay but false operator confidence: the UI and docs suggest a more trustworthy system than the code actually enforces.

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
|---|------|--------------------|
| 1 | Make trade lifecycle behavior truthful and enforceable | Every supported broker path can open, monitor, reconcile, and close positions with real semantics or is explicitly blocked from launch scope |
| 2 | Make runtime lifecycle safe for autonomous operation | Pause, stop, restart, and monitoring modes have explicit semantics and no longer silently drop critical responsibilities |
| 3 | Turn live-readiness into a real hard gate | Starting a `live_allowed` session is impossible unless all required checks pass and acknowledgement is current |
| 4 | Restore end-to-end contract integrity | Renderer, preload, IPC, and main-process shapes match for critical launch paths |
| 5 | Replace fake operator telemetry with real or explicitly mock-scoped data | Dashboard and monitor values reflect broker-backed balances / exposures or clearly labeled mock-only values |
| 6 | Close high-severity execution and security gaps | Approval rechecks re-run final enforcement, fetch tooling is SSRF-hardened, and privileged IPC is sender-validated |
| 7 | Rebuild verification trust | `bun run typecheck`, `bun run lint`, and the intended test suite baseline are green, with added Electron E2E coverage for high-risk flows |

**Non-Goals**

| # | Non-Goal | Reason |
|---|----------|--------|
| 1 | Rewrite the system design / usage / architecture docs now | Per product direction, that is a later launch-near documentation track |
| 2 | Add new major broker integrations beyond current in-repo scope | Launch readiness depends on finishing existing surfaces first |
| 3 | Expand product scope with new strategies, UI redesigns, or new agent roles | This plan is about trustworthiness and readiness, not feature growth |
| 4 | Solve self-adaptation as a launch blocker unless product explicitly keeps it in v1 scope | The current launch-critical path is execution safety and correctness, not adaptive optimization |

## 3. Background & Context

The current system already has the right macro shape for a local-first trading desktop app. Electron main owns privileged work, the preload API is narrow, SQLite and keychain are local, and session runtimes are explicit. Relevant code paths include:

- Main / renderer boundary: `electron/main/window.ts`, `electron/preload/index.ts`, `electron/main/ipc/handle.ts`
- Runtime ownership: `electron/main/services/session/session-runtime.ts`, `electron/main/services/session/session-runtime-manager.ts`
- Lifecycle control: `electron/main/services/session/session-service.ts`
- Trade execution and approval flow: `electron/main/services/orchestration/agent-orchestrator.ts`, `electron/main/services/orchestration/order-policy-gate.ts`
- Live gate: `electron/main/services/risk/live-readiness-service.ts`, `electron/main/ipc/session.ts`, `src/components/sessions/LiveReadinessModal.tsx`
- Broker execution: `electron/main/services/broker/adapters/*.ts`
- Telemetry and traces: `electron/main/services/ai/adapters/run-agent-execute.ts`, `electron/main/db/schema.ts`, `electron/main/ipc/events.ts`, `electron/main/ipc/trades.ts`

Current constraints:

- The app is local-only and intentionally uses OS keychain + local SQLite.
- Breaking changes are acceptable during development.
- Existing phase docs under `docs/plans/archieve/phase-specs/` already describe parts of the intended target state, especially policy gate, capital reservation, exit policy, and live readiness.
- The repo currently has active verification drift: typecheck fails, lint fails, some logic tests fail, and several DB-backed tests are blocked by native-module ABI mismatch.

There is also a product-process constraint from the current request: documentation drift is real, but the new canonical docs are intentionally a later TODO when the product is closer to launch. This plan therefore excludes the documentation rewrite while still acknowledging that implementation and documentation need to converge later.

## 4. Research Summary

**Electron security hardening**

- Electron's security guidance strongly recommends validating IPC senders, defining a CSP, limiting navigation/new-window creation, and avoiding broad API exposure to renderer content. Exva already does some of the right things (`contextIsolation`, `sandbox`, `nodeIntegration: false`), but it is missing two of the most relevant launch hardening items for this review: sender validation on privileged IPC handlers and a real CSP on the renderer shell.
- The key insight is that Exva's current risk is not "Electron is insecure by default"; it is that the app has already done the basic isolation work but has left the last-mile hardening unfinished at the exact points where a compromised renderer would matter most.
- Sources:
  - https://www.electronjs.org/docs/latest/tutorial/security

**SSRF and URL-fetch defense**

- OWASP's SSRF guidance is clear that simple deny-lists are not enough when an application fetches user- or model-controlled URLs. Defensive measures need to include redirect handling, IP and domain validation, private-address blocking for both IPv4 and IPv6, and ideally allowlisting when practical.
- The key insight is that Exva's current `fetch_url` policy is only a first-pass deny-list. That is acceptable for an internal prototype, but not for a launch-track desktop app that intentionally feeds fetched content back into model prompts and persists traces locally.
- Sources:
  - https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

**Electron end-to-end testing**

- Electron's own testing guide recommends Playwright or WebDriver-based end-to-end automation for desktop validation. Playwright's Electron support can launch the real app, access the first window, and run assertions against both renderer and Electron app state.
- The key insight is that Exva's current service-level tests are useful but insufficient for launch readiness. The gaps in lifecycle, approval flow, and preload/IPC contract drift are precisely the kinds of issues that E2E desktop tests are meant to catch.
- Sources:
  - https://www.electronjs.org/docs/latest/tutorial/automated-testing
  - https://playwright.dev/docs/api/class-electron

**Paper-vs-live brokerage behavior**

- Alpaca's paper-trading docs explicitly warn that simulation diverges from live trading around slippage, queue position, price improvement, market impact, liquidity assumptions, and other execution realities. Paper is useful, but not a substitute for real execution validation.
- The key insight is that Exva should not let mock or paper semantics quietly bleed into launch claims. If a broker path or monitor path is still simulated, it needs to be isolated as such rather than treated as a launch-capable implementation.
- Sources:
  - https://docs.alpaca.markets/docs/paper-trading

## 5. Options Considered

**Option A: Status quo plus selective bug fixes**

This approach would keep the current system shape and patch only the most visible issues as they appear, without a coordinated readiness program.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low immediate effort, high long-term confusion |
| Performance | No meaningful improvement |
| Reliability | Weak; trust gaps remain scattered across runtime, brokers, and IPC |
| Cost | Cheap now, expensive later through rework and hidden regressions |
| Reversibility | High, because little structural change happens |
| Stack fit | Fits by doing almost nothing |
| Team readiness | Easy to start, poor at producing a launch-ready result |

Risks:

- High impact, high likelihood: launch remains blocked because trust-critical gaps remain open.
- High impact, medium likelihood: more "looks implemented but isn't actually enforced" behavior accumulates.

Open questions:

- None of consequence. The main problem with this option is that it dodges the actual work.

**Option B: Minimal launch gate only**

This approach would focus only on live-readiness checks, a few bridge mismatches, and a small number of red-team issues, while leaving broker completeness, runtime semantics, and verification quality mostly as-is.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Moderate |
| Performance | Neutral |
| Reliability | Better than status quo, but still structurally misleading |
| Cost | Medium engineering time |
| Reversibility | High |
| Stack fit | Good short-term fit |
| Team readiness | Readily executable |

Risks:

- High impact, high likelihood: the live gate becomes a paper shield if underlying broker / lifecycle semantics remain incomplete.
- Medium impact, medium likelihood: test failures and telemetry drift continue undermining confidence.

Open questions:

- Can we honestly call the app launch-ready if the gate is strong but trade lifecycle support is still partial? My view is no.

**Option C: Structured launch-readiness remediation program**

This approach treats readiness as a coordinated reliability initiative: finish trade substrate truthfulness, fix runtime lifecycle semantics, upgrade the live gate, close execution/security gaps, and restore verification discipline before claiming launch readiness.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Highest of the three, but still bounded to existing surfaces |
| Performance | Slightly negative during implementation, positive in operations due to fewer surprises |
| Reliability | Strongest option; tackles root causes rather than symptoms |
| Cost | Highest engineering time upfront |
| Reversibility | Moderate; some changes tighten contracts and remove fake behavior |
| Stack fit | Strong fit with current architecture and existing phase docs |
| Team readiness | Good, because the codebase already has the right service boundaries |

Risks:

- Medium impact, medium likelihood: the work spans multiple subsystems and can uncover more hidden coupling.
- Medium impact, medium likelihood: some adapters may need launch-scope reduction rather than full implementation.

Open questions:

- Which broker paths truly need to be in launch scope?
- Is self-adaptation in or out for v1 launch?
- Do we want a conservative first-launch posture that limits live scope to one broker + one asset class + one session mode?

## 6. Recommendation

**We recommend Option C: Structured launch-readiness remediation program.**

This is the only option that aligns the codebase with the claims Exva wants to make. The status quo leaves too many false-positive signals. The minimal launch-gate option improves optics but not the underlying truthfulness of trade execution, lifecycle safety, or verification. Option C wins because it addresses the launch blockers in the right dependency order: first make the system honest about what it can do, then make the safety gates real, then make the verification surface trustworthy enough to prove that the fixes hold.

Why not Option A: because it is functionally a delay tactic.

Why not Option B: because a stricter UI gate does not solve incomplete broker semantics, restart/monitoring ambiguity, or red verification.

Key assumptions:

- It is acceptable to de-scope incomplete broker paths from launch if finishing them fully is too expensive.
- Breaking changes are acceptable before launch.
- The product can defer the canonical docs rewrite until these runtime truths settle.

Conditions that would change the recommendation:

- If product insists that all current broker adapters must be launch-capable, schedule and scope may expand materially.
- If self-adaptation remains a non-negotiable v1 requirement, a separate implementation track must be added.

## 7. Implementation Plan

**Phase 0: Scope Lock and Launch Truth Table**

Goal: define exactly what Exva will and will not claim at launch before changing code.

Done criteria:

- Launch matrix exists for each broker path: supported now, mock-only, paper-only, or out of launch scope.
- First-live constraints are agreed: broker count, asset classes, session count, approval requirements.
- Documentation rewrite remains deferred, but implementation truth table is explicit for engineers.

Deliverables:

- Checklist of launch-capable broker / instrument combinations
- Checklist of out-of-scope or mock-only paths
- Decision on self-adaptation: de-scope for launch or create separate plan

Dependencies:

- None

Risks and detection:

- Risk: hidden disagreement about launch claims. Detect by unresolved scope decisions after phase review.

Rollback plan:

- No code change rollback needed; this is a decision checkpoint.

**Phase 1: Verification Baseline Recovery**

Goal: restore trust in local signals before larger refactors continue.

Done criteria:

- `bun run typecheck` passes
- `bun run lint` passes
- logical test regressions currently failing are fixed
- native DB test setup is reproducible again in the local toolchain

Deliverables:

- Fix current typecheck regression in execution-step runner test typing
- Fix orchestrator test dependency assumptions around `capitalReservation`
- Fix prompt-pack test / implementation drift
- Resolve ESLint configuration breakage, including `react-hooks/exhaustive-deps`
- Rebuild or standardize `better-sqlite3` test environment so DB-backed suites run consistently

Dependencies:

- Phase 0 decisions on what remains in launch scope can proceed in parallel, but this phase should start immediately

Risks and detection:

- Risk: greening current tests masks deeper correctness issues. Detect by adding focused regression tests as each fix lands.

Rollback plan:

- Revert individual failing-fix slices if they introduce broader regressions; no schema rollback expected.

**Phase 2: Contract Integrity and Telemetry Truthfulness**

Goal: remove false or drifting data at critical operator boundaries.

Done criteria:

- Live-readiness response shapes are consistent across service, IPC, preload, renderer, and UI
- hardcoded portfolio values are replaced by broker-backed or explicitly mock-scoped providers
- runtime-facing operator data clearly distinguishes real vs simulated data paths

Deliverables:

- Unify `detail` vs `message` shape for readiness checks
- Unify acknowledgement response contract
- Replace `100000` portfolio callbacks in `SessionService` / `TradeMonitor` wiring with account-balance services
- Add explicit mock/paper labels where telemetry cannot be real

Dependencies:

- Phase 1 verification recovery

Risks and detection:

- Risk: replacing fake telemetry reveals deeper gaps in broker balance access. Detect by adapter-level tests and dashboard assertions.

Rollback plan:

- Keep fallback behavior behind explicit mock-only code path if broker-backed balance access cannot be completed immediately.

**Phase 3: Runtime Lifecycle Semantics Hardening**

Goal: make pause, stop, resume, restart, and monitoring behavior safe and explicit.

Done criteria:

- "pause new work" and "monitor open positions" responsibilities are separated correctly
- restart behavior follows an intentional policy with user-visible semantics
- stop behavior no longer silently violates the product's safety expectations

Deliverables:

- Split runtime lifecycle into at least: intake active, intake paused / monitoring active, fully stopped
- Keep monitoring alive for open positions when the product intent is "stop new entries"
- Decide startup rehydration policy and encode it explicitly, rather than forcing previous active sessions to paused without broader runtime semantics
- Add UI-visible labels and events for lifecycle modes

Dependencies:

- Phase 2 contract cleanup

Risks and detection:

- Risk: lifecycle changes create unexpected concurrent behavior. Detect with runtime-manager and monitor integration tests, plus E2E restart scenarios.

Rollback plan:

- Retain current conservative startup resume gate behind a feature flag if the new resume policy proves unstable.

**Phase 4: Broker Substrate Completion or Launch De-Scoping**

Goal: ensure every in-scope broker path has truthful lifecycle semantics.

Done criteria:

- Each in-scope broker adapter supports balance, positions, order status, and close/flatten behavior needed by monitoring and force-close
- Out-of-scope adapters are blocked from launch claims and UI paths where necessary

Deliverables:

- Implement real close / flatten semantics where the broker API supports them
- Implement `getPositions()` and meaningful order-status reconciliation for in-scope adapters
- Normalize realized/unrealized P&L expectations across adapters
- Mark simulated adapters or unsupported modes as non-launch-capable

Dependencies:

- Phase 0 launch matrix
- Phase 2 telemetry truthfulness

Risks and detection:

- Risk: some adapters are too incomplete to finish quickly. Detect by adapter-by-adapter readiness checklist and promote de-scope instead of pretending support.

Rollback plan:

- Remove incomplete adapters from launch scope rather than shipping partial semantics.

**Phase 5: Execution Control Integrity**

Goal: ensure the final order path cannot bypass the controls users think they are getting.

Done criteria:

- Approval recheck path re-runs final policy enforcement
- Approval state is bound to the reviewed routing / broker / config context
- Policy gate inputs are real and complete for launch paths

Deliverables:

- Re-run `OrderPolicyGate` in `runApprovalRecheck()`
- Bind approvals to a routing/config snapshot or hash and fail closed on material change
- Finish policy-gate inputs currently stubbed or weakened: price collar, idempotency, broker capability, market-open semantics, freshness inputs

Dependencies:

- Phase 3 lifecycle hardening
- Phase 4 broker substrate work

Risks and detection:

- Risk: stricter policy gate reduces trade throughput in paper/mock modes. Detect with before/after rejection telemetry and scenario tests.

Rollback plan:

- Allow feature-flagged telemetry-only evaluation for non-launch modes, but keep launch path fail-closed.

**Phase 6: Live-Readiness Hard Gate Completion**

Goal: make live session start impossible unless all required operational preconditions are actually true.

Done criteria:

- `live_allowed` sessions cannot start unless all non-ack checks pass and acknowledgement is current
- acknowledgement is invalidated on material config changes
- all assigned live brokers are validated, not just the first one
- readiness implementation matches the intended reduced launch scope truthfully

Deliverables:

- Expand `LiveReadinessService` to include the intended checks that are truly launch blockers
- Call `clearAcknowledgement()` from session/broker/routing/risk mutations that change live behavior
- Check all assigned brokers or constrain launch scope to one broker and enforce that explicitly
- Add tests for stale acknowledgement invalidation and multi-broker failure paths

Dependencies:

- Phase 5 execution-control integrity

Risks and detection:

- Risk: the full phase-spec gate may be broader than launch actually needs. Detect by separating "must-have now" checks from "post-launch hardening" checks in code comments and tests.

Rollback plan:

- If a subset of checks proves too broad for first launch, reduce scope explicitly and update the truth table rather than silently bypassing checks.

**Phase 7: Security Blast-Radius Reduction**

Goal: harden the renderer/main/tool boundary enough for launch-track risk tolerance.

Done criteria:

- Privileged IPC handlers validate sender / frame origin
- Renderer shell has a real CSP compatible with the app's asset model
- `fetch_url` is hardened against redirect-based SSRF and private-address resolution
- sensitive traces are separated into debug-grade vs operator-grade visibility

Deliverables:

- Add sender validation in the generic IPC wrapper or per-handler policy layer
- Add restrictive CSP to `index.html` or equivalent headers / protocol path
- Update `fetch-url-tool.ts` to disable automatic redirects or revalidate every redirect hop and resolved IP destination, including IPv6/private/link-local ranges
- Split trace persistence/exposure into default-safe and debug-opt-in modes

Dependencies:

- Phase 2 contract integrity

Risks and detection:

- Risk: CSP or stricter IPC validation breaks current tooling or fonts. Detect with renderer smoke tests and dev/prod startup checks.

Rollback plan:

- Relax only the minimum CSP directives needed for packaged local assets; do not remove CSP entirely.

**Phase 8: Launch-Critical End-to-End Coverage**

Goal: prove the high-risk flows through the real desktop shell.

Done criteria:

- Playwright or equivalent Electron E2E tests exist for high-risk launch flows
- Launch blockers are measured by E2E and not just service-unit tests

Deliverables:

- Add Electron Playwright harness
- Add E2E coverage for: start paper session, approval-required trade path, force-close path, restart/rehydration behavior, live-readiness modal and acknowledgement invalidation, and renderer/preload/main contract correctness
- Add one security regression test for blocked / redirected `fetch_url` cases

Dependencies:

- Phases 1-7 substantially complete

Risks and detection:

- Risk: E2E setup is flaky in CI or local dev. Detect by repeated clean runs and keeping the initial suite small and deterministic.

Rollback plan:

- Keep the suite focused on launch-critical smoke coverage; if full breadth is unstable, reduce scope but preserve top-risk scenarios.

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Broker adapters prove too incomplete for all current advertised paths | Medium | High | De-scope unsupported adapters from launch instead of shipping partial behavior |
| 2 | Lifecycle changes introduce new concurrency or monitoring bugs | Medium | High | Add integration tests around pause/stop/restart/open-position monitoring before release |
| 3 | Stricter live gate blocks common workflows late in the cycle | Medium | Medium | Phase scope lock early and separate must-have checks from post-launch hardening |
| 4 | Security hardening breaks current renderer dev UX | Medium | Medium | Add CSP and sender validation incrementally with smoke tests |
| 5 | Verification cleanup turns into a moving target because the repo is concurrently evolving | High | Medium | Land baseline fixes early and keep launch-branch expectations explicit |
| 6 | Product ambiguity around self-adaptation or multi-broker launch scope stalls implementation | Medium | Medium | Resolve in Phase 0 and record the launch truth table |

## 9. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
|------|--------|----------|--------|--------------|
| Verification trust | `bun run typecheck` | failing | passing | local command |
| Verification trust | `bun run lint` | failing | passing | local command |
| Verification trust | launch-critical Vitest suites | partially failing | passing | local command |
| Desktop correctness | Electron E2E coverage for launch-critical flows | none | present for 5+ flows | Playwright run |
| Broker truthfulness | in-scope adapters with real balance/positions/close semantics | inconsistent | 100% of in-scope adapters | adapter checklist + tests |
| Live gate integrity | stale ack reused after config change | possible | impossible | targeted readiness tests |
| Execution control | approval recheck bypasses final policy gate | yes | no | orchestrator regression tests |
| Security hardening | sender validation on privileged IPC | absent | present | code review + tests |
| Security hardening | renderer CSP | absent | present | packaged app smoke test |
| Telemetry truthfulness | hardcoded portfolio values in runtime path | present | removed from launch paths | grep + dashboard integration tests |

Leading indicators:

- Verification baseline goes green before major lifecycle changes land.
- Launch truth table is agreed early.
- At least one E2E lifecycle test catches a real regression during implementation.

Lagging indicators:

- A live-allowed session cannot be started when any critical readiness dependency is stale or incomplete.
- Launch-claimed broker paths all support real monitoring and close behavior.

## 10. Open Questions

| # | Question | Owner | Needed By | Status |
|---|----------|-------|-----------|--------|
| 1 | Which broker adapters are truly in v1 launch scope versus paper/mock-only? | Kenneth | Phase 0 | Open |
| 2 | Is self-adaptation a required launch behavior or should it be explicitly deferred? | Kenneth | Phase 0 | Open |
| 3 | Should first launch be restricted to one live broker and one instrument class to simplify readiness enforcement? | Kenneth | Phase 0 | Open |
| 4 | Do we want full prompt/tool trace persistence on by default for launch, or debug-only? | Kenneth | Phase 7 | Open |
| 5 | Should restart automatically resume monitoring-only mode for open positions, or require explicit operator resume? | Kenneth | Phase 3 | Open |

## 11. Alternatives Rejected

| Option | Why Rejected |
|--------|-------------|
| Status quo plus selective bug fixes | Does not close root-cause readiness gaps and leaves false confidence in place |
| Minimal launch gate only | Improves optics more than truth; broker, lifecycle, and verification issues would remain launch blockers |
