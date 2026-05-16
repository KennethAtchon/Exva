# Exva Application Review

Date: 2026-05-15

## Executive Verdict

Exva has a credible local-desktop architecture and a lot of serious implementation work behind it, but it is not yet ready to be treated as a plug-in-and-run autonomous trading application. The repo is much closer to a strong prototype / operator workbench than to a trustworthy autonomous trading product.

The good news is that the core shape is mostly right: Electron main owns privileged work, the preload bridge is typed, session runtimes are explicit, persistence is local, and the AI / broker / risk concerns are separated well enough to keep iterating. The bad news is that several end-to-end promises are still broken at the seams: broker adapters are incomplete, stop / restart behavior undercuts autonomy, live-readiness is only partially implemented, documentation is materially out of sync with the code, and the verification story does not support the product claims.

If the question is "does everything work well enough that I can connect it to real systems and trust it to do its stated job," the answer is no.

## Review Scope

This review focused on macro product readiness, implementation cohesion, and adversarial risk.

Areas reviewed:

- Product docs and architecture docs
- Electron main / preload / renderer boundary
- Session lifecycle and runtime ownership
- AI orchestration and approval flow
- Risk and live-readiness controls
- Broker adapter completeness
- Logging, audit, and trace persistence
- Verification signals from typecheck, lint, and test runs

## Evidence Snapshot

Repo checks run during review:

```text
bun run typecheck
- failed: electron/main/services/orchestration/__tests__/execution-step-runner.test.ts(40,56)
  Property 'nextRetryAt' does not exist on type 'never'.

bun run test
- failed: 8 tests failed, 6 suites failed to run
- logical regressions in agent orchestrator and prompt-pack tests
- multiple DB-backed suites blocked by better-sqlite3 ABI mismatch

bun run lint
- failed: 72 errors across main process, renderer, and tests
- includes missing ESLint rule config for react-hooks/exhaustive-deps
```

This matters because the current repo state is not just "missing polishing". The verification surface is actively red, which makes every higher-level product claim less trustworthy.

## What Is Working Well

These parts are directionally strong and worth keeping:

1. Electron privilege boundaries are mostly sane.
   File refs: `electron/main/window.ts:16-21`, `electron/preload/index.ts:32-163`
   The app uses `contextIsolation`, `sandbox`, `nodeIntegration: false`, and a narrow preload API instead of exposing raw Node APIs to the renderer.

2. The system is split along good service boundaries.
   File refs: `electron/main/services/app-services.ts:235-273`, `electron/main/services/session/session-runtime-manager.ts:113-143`
   Session ownership, orchestration, risk, broker routing, strategy context, and persistence are separated enough that the app can still be made production-grade without a rewrite.

3. The runtime model is conceptually correct.
   File refs: `electron/main/services/session/session-runtime.ts:16-60`, `electron/main/services/session/session-runtime-manager.ts:113-123`
   Owning one runtime per session in main process is the right foundation for a multi-session autonomous app.

4. The codebase has meaningful service-level tests.
   File refs: `electron/main/services/risk/__tests__/*`, `electron/main/services/orchestration/__tests__/*`, `electron/main/services/ai/__tests__/*`
   There is real test intent here, especially around risk, orchestration, and AI tooling behavior.

5. The app is taking observability seriously.
   File refs: `electron/main/services/ai/adapters/run-agent-execute.ts:117-133`, `233-255`; `electron/main/ipc/events.ts:7-31`
   Traces, messages, tool calls, and event access are all present. This is useful for development and debugging, even though the current implementation overexposes sensitive trace data.

## Major Findings

## 1. The broker layer is not complete enough for the product's stated goal

This is the biggest macro blocker.

Key file refs:

- `electron/main/services/broker/adapters/alpaca-adapter.ts:111-114`
- `electron/main/services/broker/adapters/coinbase-advanced-trade-adapter.ts:172-179`
- `electron/main/services/broker/adapters/polymarket-adapter.ts:113-142`
- `electron/main/services/broker/adapters/tradovate-adapter.ts:22-26`, `35-95`

Problems:

- `closeOrder()` is not a true flatten / close-position implementation in several adapters. In Alpaca and Coinbase it effectively cancels the order and returns `realizedPnlUsd: 0`.
- `getPositions()` is empty in multiple adapters, which breaks the monitor, exit, and dashboard story.
- Tradovate is explicitly simulated.
- Polymarket close logic is more developed than some others, but still reports synthetic / incomplete realized P&L.

Macro impact:

- The app claims autonomous execution, monitoring, force-close, and P&L visibility.
- Those claims depend on a broker layer that can read actual balances, positions, order state, and close positions deterministically.
- Right now that is not consistently true.

Bottom line: the product cannot be called ready while core broker semantics are partial or simulated.

## 2. Stop / pause / restart behavior is not aligned with autonomous trading reality

Key file refs:

- `electron/main/services/session/session-runtime.ts:22-60`
- `electron/main/services/session/session-runtime-manager.ts:113-123`
- `docs/USAGE.md:45-48`

Problems:

- Pausing or stopping a runtime stops the trade monitor as well.
- On restart, previously active sessions are forcibly downgraded to `paused`.
- `docs/USAGE.md` says open trades keep being monitored after stop, but the runtime currently stops the monitor on `stop()`.

Macro impact:

- An autonomous trading app must be extremely explicit about lifecycle semantics.
- "Stop new entries" and "stop all monitoring" are not the same action.
- A restart path that pauses old sessions may be acceptable for safety during development, but it is not compatible with the app's autonomous-product positioning.

Bottom line: the app currently behaves like a guarded dev harness, not like a resilient autonomous runtime.

## 3. Live readiness is implemented as a thin checklist, not as a hard production gate

Key file refs:

- `electron/main/services/risk/live-readiness-service.ts:33-105`
- `electron/main/ipc/session.ts:142-155`
- `docs/plans/archieve/phase-specs/phase-8-live-readiness.md:15-17`, `19-100`, `147-150`

Problems:

- The implementation checks only execution mode, broker assignment, broker mode, broker connection, and user acknowledgement.
- The phase spec describes a much broader hard gate including policy-gate wiring, capital-reservation behavior, exit-policy wiring, scorecard promotion, conservative first-live limits, and config-change invalidation.
- `clearAcknowledgement()` exists, but nothing in the repo calls it.
- The connection test only validates the first assigned broker account.

Macro impact:

- This is the exact area where the product must be stricter than normal apps.
- Instead, the code currently gives a UI and API shape that looks safer than the actual enforcement.

Bottom line: live-readiness currently communicates confidence it has not earned.

## 4. The typed bridge exists, but critical contracts are already drifting

Key file refs:

- `electron/main/services/risk/live-readiness-service.ts:9-14`
- `electron/main/ipc/session.ts:153-154`
- `electron/preload/exva-api.ts:232-239`
- `src/lib/exva.ts:288-297`
- `src/components/sessions/LiveReadinessModal.tsx:5-10`, `96-98`

Problems:

- Main service emits `detail`, while the renderer types and UI expect `message`.
- IPC returns `{ acknowledged: true }`, while preload and renderer types expect `{ acknowledgedAt: string }`.

Macro impact:

- This is not a cosmetic mismatch. It happens at the safety boundary for live trading.
- When the bridge contracts drift here, it reduces confidence in the rest of the renderer/main integration surface.

Bottom line: the typed-bridge story is good in principle, but the current implementation is already violating its own promise.

## 5. Core telemetry still includes synthetic values

Key file refs:

- `electron/main/services/session/session-service.ts:6-8`, `68-70`
- `electron/main/services/app-services.ts:238-250`

Problems:

- `portfolioValue` is hardcoded to `100000`.
- `TradeMonitor` is wired with `() => 100000` as the portfolio callback.

Macro impact:

- Dashboard numbers and risk context are part of the product's operating model.
- Synthetic values are fine in a narrow mock mode, but this value is wired into main services rather than isolated to explicit mock-only paths.

Bottom line: the app still contains fake operator-facing financial telemetry in important paths.

## 6. Documentation is materially out of sync with the codebase

Key file refs:

- `README.md:4`, `43`
- `src/lib/exva.ts:126-137`, `374`
- `docs/USAGE.md:34-35`, `47`, `58`
- `electron/main/services/session/session-runtime.ts:53-59`
- `electron/main/db/migrations.ts:52`
- `docs/design/Product_Spec.md:12`, `38-40`, `62-63`

Examples:

- `README.md` points to `docs/System_Design.md` and `docs/CHECKLIST.md`; those exact paths do not exist.
- Docs claim renderer-only browser fallback with mock data, but `src/lib/exva.ts` hard-fails when the Electron bridge is unavailable and exports `showMock = false`.
- Usage docs say stopped sessions keep monitoring open trades; runtime code stops the monitor.
- Usage docs still reference `session_config`, while the DB and strategy model have evolved beyond that.
- Product spec still describes a different agent framing and promises self-adaptation that is not implemented.

Macro impact:

- For a system like this, docs are part of the control surface.
- When docs drift this far, operators cannot trust setup instructions, safety expectations, or even the basic mental model.

Bottom line: documentation currently overstates readiness and sometimes describes a different product than the one in the repo.

## 7. The repo's verification story does not support its readiness claims

Key file refs:

- `package.json:18-20`
- `docs/design/System_Design.md:33`
- current command results from `bun run typecheck`, `bun run test`, `bun run lint`

Problems:

- Typecheck fails.
- Lint fails broadly.
- Tests fail for both logic regressions and environment issues.
- DB-backed tests are blocked by a native-module ABI mismatch.
- System design mentions Playwright, but the repo does not currently demonstrate true desktop end-to-end coverage.

Macro impact:

- This app is trying to be a local trading system, not a static website.
- The verification bar should be higher than average, especially around session lifecycle, approval flow, force close, monitor continuity, and broker path safety.

Bottom line: the app is not currently in a state where its own checks justify operator trust.

## 8. Approval recheck flow bypasses the normal final execution gate

Key file refs:

- `electron/main/services/orchestration/agent-orchestrator.ts:436-465`
- `electron/main/services/orchestration/agent-orchestrator.ts:586-704`
- `electron/main/services/orchestration/order-policy-gate.ts:60-179`
- `electron/main/db/schema.ts:391-412`

What happens:

- In the normal path, the orchestrator evaluates `OrderPolicyGate` before placement.
- In the post-approval recheck path, the system reruns AI and risk, then goes straight to `placeRoutedOrder()`.
- The stored approval contains broker and proposed trade context, but the recheck path does not bind final placement to the originally approved routing and policy assumptions.

Why this matters:

- This is exactly the sort of "it looks safe until restart or retry" bug that causes production incidents.
- A human approval gate is only meaningful if the final placement still honors the reviewed context.

Bottom line: this is a major control-gap, not a minor hardening issue.

## 9. The app is over-trusting local traces and tool output from a security standpoint

Key file refs:

- `electron/main/services/ai/tools/fetch-url-tool.ts:13-23`, `103-145`
- `electron/main/services/ai/adapters/run-agent-execute.ts:117-133`, `175-193`, `233-255`
- `electron/main/db/schema.ts:294-333`, `350-364`
- `electron/main/ipc/events.ts:13-30`
- `electron/main/ipc/trades.ts:36-42`

Problems:

- `fetch_url` blocks obvious localhost / private IPv4 strings, but it does not defend against redirect-based SSRF or full destination revalidation.
- The app intentionally persists and exposes full prompts, tool outputs, fetched content, and reasoning-like traces in local logs and SQLite.
- The renderer can fetch those traces through IPC for the Developer and Trade Detail surfaces.

Macro impact:

- The current observability model is very useful for debugging.
- It is also a large local exposure surface if the renderer is compromised, if local malware is present, or if sensitive external content is ingested.

Bottom line: the current trace model is developer-friendly but security-heavy by default.

## Areas That Are Not Properly Connected Yet

These are the main "the pieces exist but do not fully connect" gaps:

1. Product promise vs runtime capability
   The product says the system can trade autonomously, adapt, monitor, and halt safely. The runtime does some of this, but broker completeness, adaptation, and restart semantics are not there yet.

2. Safety UI vs actual enforcement
   The live-readiness UI shape suggests a strong production gate. The implementation is currently much thinner.

3. Typed contract story vs real handler responses
   The preload / API / renderer types suggest rigor, but there are already mismatches on live-readiness payloads.

4. Docs vs actual operator path
   A user following the docs will hit wrong file paths, wrong runtime assumptions, and outdated behavioral guarantees.

5. Observability vs least-privilege
   The system has strong developer visibility, but it has not yet split "safe operator data" from "full sensitive debug trace".

## Major Improvement Areas

These are the highest-value macro improvements, in order.

## Priority 1: Finish the real trading substrate

- Make broker adapters support real position lookup, close / flatten semantics, and meaningful realized P&L.
- Separate mock behavior cleanly from live / paper broker behavior.
- Refuse to advertise a broker path as supported until its trade lifecycle is fully implemented.

## Priority 2: Make lifecycle semantics explicit and safe

- Split "pause new work" from "stop monitoring".
- Decide restart behavior intentionally rather than pausing everything by default and calling it autonomous.
- Add clear user-visible states for "no new entries, monitoring only," "paused," and "fully stopped."

## Priority 3: Turn live-readiness into a real gate

- Match the implementation to the phase spec, or rewrite the spec to match reality.
- Invalidate acknowledgement when execution-mode, broker assignment, routing, or risk config changes.
- Check every assigned live broker, not just the first one.
- Fix response-shape drift immediately.

## Priority 4: Rebuild trust in verification

- Get `typecheck`, `lint`, and the DB-backed test suite green again.
- Fix the current agent-orchestrator and prompt-pack regressions.
- Add true end-to-end Electron coverage for the highest-risk flows.

## Priority 5: Reduce security blast radius

- Re-run `OrderPolicyGate` in approval rechecks.
- Harden `fetch_url` against SSRF via redirects and resolved private addresses.
- Add sender validation to privileged IPC handlers.
- Add a real CSP to the renderer shell.
- Move full prompts / tool outputs / fetched content behind an explicit debug mode.

## Priority 6: Bring docs back to truth

- Fix broken doc links.
- Remove claims that are no longer true.
- Document actual session, workspace, and readiness behavior as implemented.
- Either implement self-adaptation or explicitly de-scope it.

## Plug-In Readiness Assessment

Readiness by category:

| Category | Assessment | Notes |
|---|---|---|
| Desktop architecture | Strong | Main/preload/renderer split is sound. |
| Local-first persistence | Strong | SQLite + keychain direction is correct. |
| Session/runtime architecture | Medium | Good structure, but restart / stop semantics are not product-ready. |
| Risk controls | Medium | Real work exists, but enforcement is fragmented and readiness gating is thin. |
| Broker execution | Weak | Too many incomplete / simulated semantics remain. |
| Operator trust / observability | Medium | Strong visibility, but not safely scoped. |
| Documentation accuracy | Weak | Too much drift between docs and implementation. |
| Verification confidence | Weak | Typecheck, lint, and tests are not green. |
| Live trading readiness | Not ready | Major blocker. |

## Final Assessment

Exva is a serious codebase, not a toy. The architecture is better than the current product readiness. That is important, because it means the main problem is not "wrong foundation" but "critical layers are still unfinished or disconnected."

The application can already serve as:

- a local development harness
- a session-oriented research and orchestration prototype
- a UI for iterating on AI-driven trading workflows
- a partially wired paper-trading / mock-trading environment

It should not yet be treated as:

- a trustworthy autonomous live-trading system
- a product where the docs accurately describe reality
- a system whose current checks are enough to guarantee safe end-to-end behavior

The shortest honest summary is:

Exva has strong bones, but the last mile matters most in trading software, and that last mile is still incomplete.
