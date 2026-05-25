# Session Lifecycle Remediation — Implementation Verification

> **Date:** 2026-05-24
> **Plan:** [Session Lifecycle Remediation Plan](../plans/session-lifecycle-remediation-plan-2026-05-24.md)
> **Status:** Phases 0–5 verified against source code
> **Reviewer:** Claude Sonnet 4.6

---

## Summary

All six phases are implemented. One real gap exists (Phase 2). Two lower-priority risks are unmitigated in code. One documentation inconsistency in the plan's own implementation notes.

---

## Phase 0 — Shared lifecycle contracts ✅

All four helpers present in `electron/main/services/session/session-trade-state.ts`:
- `listOpenTrades`, `hasAnyOpenTrade`, `countOpenTrades`, `hasAnyBlockingTrade`
- `canScheduleSelector` hits `hasAnyOpenTrade` first before capacity checks

Progress IPC (`electron/main/ipc/session/session.ts`) returns `openTradeCount` and `monitoringActive`. Structured logging present at every gate.

---

## Phase 1 — Invariant enforcement ✅

| File | What was checked | Result |
|---|---|---|
| `trade-closed-handler.ts` | `countOpenTrades` gate → early return if remaining > 0; `enqueueTask` used | ✅ |
| `cycle-refill.ts` | `canScheduleSelector` as first gate; `enqueueTask` used | ✅ |
| `session-runtime-manager.ts` | `resumeSession()` throws `SESSION_NOT_ACTIVE` when no runtime (no silent `startSession` fallback) | ✅ |
| `agent-orchestrator.ts:executeSelectorCycle` | Defense-in-depth `canScheduleSelector` gate | ✅ |
| `session-service.ts` | `stop()` drains when open trades exist; `forceStop()` exists | ✅ |
| TopNav / SessionsPage / SessionTable / StrategyConfig | `window.confirm` before `forceStop`; "Stop when flat" when open trades; "Pause" copy correct | ✅ |

**Documented deviation from Phase 1 plan text:** `stop()` when `openTradeCount > 0` enters drain mode (`monitoring_only`) instead of blocking with `OPEN_TRADES_BLOCK_STOP`. This is correct — Phase 4 was merged into `stop()` behavior. See Phase 4 below.

---

## Phase 2 — Startup recovery and graceful shutdown ⚠️ One gap

### What is correct

- `SessionStartupRecoveryService.collectRecoverableSessions()` handles `active` → demote to `paused`, `paused` unchanged, `monitoring_only` unchanged, `stopped` with open trades → safety recovery as `paused`
- `recoverSession()` runs `reconcileOpenTrades()`, `repairStaleRunningSteps()`, `auditCapitalReservations()` in sequence
- `TradeMonitor.start()` calls `void this.tick()` immediately before registering `setInterval` ✅
- `electron/main/index.ts` wires `ShutdownCoordinator` on `will-quit`; `shutdown()` is idempotent ✅
- Broker reconciliation only treats `status === "closed"` as terminal — documented deviation ✅

### Gap: `attention_required` sessions with open trades not recovered

`collectRecoverableSessions()` does not scan sessions in `attention_required` status. If a session was `attention_required` with open trades when the process died, it is skipped on restart — no trade monitor starts, positions go unmanaged until the operator manually resumes.

**Affected file:** `electron/main/services/session/session-startup-recovery-service.ts`

**Fix:**
```ts
for (const session of this.deps.sessionRepo.listByStatuses(["attention_required"])) {
  const openTradeCount = countOpenTrades(this.deps.tradesRepo, session.id);
  if (openTradeCount === 0) continue;
  recoverable.push({
    sessionId: session.id,
    priorStatus: "attention_required",  // extend RecoverableSession union
    demoteToPaused: true,
    safetyRecovery: true,
  });
}
```

### Risk: No timeout on broker reconciliation calls

`reconcileOpenTrades()` calls `adapter.getOrderStatus(broker_order_id)` with no timeout. A slow or unresponsive broker on startup will block recovery indefinitely for that session. The risk register documents this but it is not mitigated in code.

**Suggested fix:** Wrap each call in `Promise.race` with a 5–10 second timeout and emit a WARN event on timeout rather than hanging.

---

## Phase 3 — Renderer truthfulness ✅

| Deliverable | Where | Result |
|---|---|---|
| Distinct holding state (not 100%) | `SessionExecutionProgress.tsx:deriveProgress` | Amber pulsing bar at 66%, "Holding position (N) — waiting for exit" label ✅ |
| Progress refresh on `trade_opened` / `trade_closed` | `SessionsPage.tsx` | Both events trigger `refreshProgress`; `trade_closed` also reloads session list ✅ |
| `trade_closed` toast with instrument, exit reason, P&L | `RuntimeEventToast.tsx` | Present, level `INFO`, formatted correctly ✅ |
| Orphan warning | `SessionTable.tsx` | Shown when `status === "stopped" && openTradeCount > 0` ✅ |
| Drain banner | `SessionTable.tsx`, `SessionsPage.tsx` | Shown when `status === "monitoring_only"` ✅ |
| "Pause after step" during monitoring | `SessionExecutionProgress.tsx` | Shown when `isRunning || isRetrying || isMonitoring` ✅ |

---

## Phase 4 — Drain-to-stop ✅

- `monitoring_only` added to `SessionStatus` union and `LEGAL_TRANSITIONS` in `electron/shared/domain/enums.ts`
- `SessionRuntimeManager.drainSession()`, `completeDrainStop()`, `handleTradeClosedForDrain()` all present
- `SessionRuntime.drainStop()` stops orchestrator, keeps trade monitor alive
- `SessionService.stop()` transitions to drain when `openTradeCount > 0`
- UI: "Stop when flat" button (TopNav + SessionsPage + StrategyConfig), amber `monitoring_only` state, `SESSION_STATUS` map entry with pulse

---

## Phase 5 — Per-session runtime isolation ✅ (opt-in)

| Deliverable | File | Result |
|---|---|---|
| `SessionRuntimeHost` interface | `session-runtime-host.ts` | ✅ |
| `UtilityProcessSessionRuntimeHost` | `utility-process-runtime-host.ts` | ✅ |
| Worker entry | `electron/main/workers/session-runtime-worker.ts` | ✅ |
| RPC bridge | `runtime-rpc-bridge.ts` | ✅ |
| Worker build config | `vite.worker.config.ts` | ✅ |
| Env flag | `EXVA_UTILITY_PROCESS_RUNTIMES` in `env.ts` + `app-services.ts` | ✅ |

**Minor risk:** `ShutdownCoordinator.shutdown()` calls `stopSession()` for each runtime (removes from `runtimes` Map), then calls `runtimeManager.shutdownAll()` → `runtimeHost.shutdownAll()`. For `UtilityProcessSessionRuntimeHost`, `shutdownAll()` iterates its own `children` Map, which is only cleared on process `exit` event — not immediately on `shutdown()`. A slow-exiting worker may receive a second `shutdown()` call. Not critical if `UtilityProcessSessionRuntime.shutdown()` is idempotent; verify or clear `children` immediately on first `shutdown()` call.

---

## Regression tests present ✅

| Test file | Covers |
|---|---|
| `scheduling/__tests__/trade-closed-handler.test.ts` | Trade-close restart gating |
| `scheduling/__tests__/cycle-refill.test.ts` | Idle refill gating |
| `session/__tests__/session-startup-recovery.test.ts` | Startup recovery |
| `session/__tests__/shutdown-coordinator.test.ts` | Graceful quit teardown |
| `session/__tests__/runtime-rpc-bridge.test.ts` | Worker RPC |

---

## Action items

| Priority | Gap | File | Fix |
|---|---|---|---|
| **High** | `attention_required` sessions with open trades not recovered at startup | `session-startup-recovery-service.ts` | Add scan for `attention_required` with `openTradeCount > 0`; demote to `paused` with safety recovery |
| **Medium** | No timeout on `adapter.getOrderStatus()` during reconciliation | `session-startup-recovery-service.ts:reconcileOpenTrades()` | `Promise.race` with 5–10s timeout; emit WARN and continue on timeout |
| **Low** | Potential double-shutdown of utility process workers | `shutdown-coordinator.ts`, `utility-process-runtime-host.ts` | Verify `UtilityProcessSessionRuntime.shutdown()` is idempotent or clear `children` map immediately on `shutdown()` |
| **Doc** | Section 12 of plan says `stop()` "blocks with `OPEN_TRADES_BLOCK_STOP`" | `session-lifecycle-remediation-plan-2026-05-24.md` | Update to reflect Phase 4 merge: `stop()` drains, not blocks |
