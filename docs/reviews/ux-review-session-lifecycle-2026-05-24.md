# UX Review: Session Lifecycle — Stop While Monitoring / Selector-During-Open-Trades

**Date:** 2026-05-24  
**Scope:** Session stop flow, trade-closed selector restart, monitoring-phase controls, crash recovery, trade outcome visibility  
**Trigger:** Hard rule stated by operator — once trades are open, no selector or AI loop may start until all trades close with results.

---

## Overview

The system has several interlocking failures across the trade lifecycle. There is no hard invariant enforcing "no selector while any trade is open" — the existing check is capacity-based, not closure-based. Clicking Stop while a trade is in monitoring either kills the only thing watching open positions (the trade monitor) or, under a race condition, fires a new selector cycle before the stop fully propagates. Crash recovery is partial: only `active`/`paused` sessions are rehydrated, broker-side fills during downtime are not reconciled, and the first monitor tick after restart is delayed. Trade outcomes (close, stop-loss, take-profit) are silent — no notification reaches the user. The progress bar stays at "Monitoring position" after a trade closes. Nearly all of these stem from the same root: no single source of truth for "trades are in flight" that all entry points check, and no startup reconciliation pass.

---

## Broken Flows

---

### 1. Stop While Monitoring Kills the Trade Monitor

**What the user wants to do:** Click Stop to halt AI analysis while open positions continue to be watched and managed.

**What the app does instead:** `SessionRuntime.stop()` calls `orchestrator.stop()` then `tradeMonitor.stop()`. The trade monitor — the only thing watching stops, take-profits, max-hold, and event resolution — is fully killed. Trades sit in `"open"` state in the DB with nothing managing them. The next monitor tick never fires.

**Why it's wrong:** The user's mental model of "Stop" is "halt new analysis, my open positions should still be managed." The system's "Pause" state does exactly that (orchestrator paused, monitor still running). "Stop" kills both. The user is using the wrong control, and the UI gives no indication the two differ in this critical way during the monitoring phase.

**Severity:** `State-corrupting` — open trades lose their exit management (trailing stops, take-profit, max-hold enforcement) until the session is restarted.

**Fix direction:** Either:
- Disable the Stop button when `openTradeCount > 0` and explain why ("Pause keeps your positions managed. Stop is for when no trades are open."), or
- Add a "monitoring-only" state that the stop transitions through: `active → monitoring_only` (orchestrator stopped, monitor alive) → `stopped` (once all trades close).
- At minimum: stop should warn the user that `N open trades will lose automated management`.

---

### 2. New Selector Fires When Any Trade Closes, Even If Others Are Still Open

**What the user wants to do:** Wait for ALL open trade results before running any new AI analysis.

**What the app does instead:** `trade-closed-handler.ts` fires `scheduleSelectorCycle` on every individual `trade_closed` event, regardless of how many other trades are still open. If 3 trades are open and trade 1 closes, a new selector cycle starts immediately while trades 2 and 3 are still live.

Additionally, `cycle-refill.ts`'s `hasOpenTradeCapacity()` returns `true` when `openTrades.length < max_concurrent_trades`. With `max_concurrent_trades = 3` and 1 open trade, capacity reads as "available" and a new selector cycle is scheduled while the position is still live.

**Why it's wrong:** The stated rule is "once trades are open, do NOT start the selector or anything else again until ALL trades close with results." The system's check is "is there empty capacity?" — a completely different question. The system will happily run a new AI selector loop while an existing trade is still waiting on broker resolution.

**Severity:** `Flow-breaking` — violates the core invariant of the system as the user intends it.

**Fix direction:** Replace the capacity check with a full-close check. `scheduleSelectorCycle` should only run when `openTrades.length === 0`. The `trade-closed-handler` must query open trades after each closure:

```ts
// Only restart selector when ALL trades are closed
const remaining = ctx.deps.tradesRepo.listOpenAndPending(ctx.sessionId)
  .filter(t => t.status === "open");
if (remaining.length > 0) return;
```

`hasOpenTradeCapacity()` in `cycle-refill.ts` should be augmented or replaced with this same check for the no-instrument retry path.

---

### 3. Stop While Monitoring — Race Condition Spawns New AI Loop

**What the user wants to do:** Click Stop → runtime halts cleanly.

**What the app does instead:** In `trade-closed-handler.ts`, when a `trade_closed` event fires:

```ts
ctx.queue.add(scheduleSelectorCycle)  // direct queue.add, not ctx.enqueueTask
```

`enqueueTask` has a guard: `if (this.stopped) return`. `ctx.queue.add()` bypasses this. The only guard in the handler is `if (!ctx.runtimeIsActive()) return`, which checks the bus status. Bus status is set to `"stopping"` in `SessionRuntimeManager.stopSession()` before `orchestrator.stop()` runs. But the event listener callback can be mid-execution (already past the `runtimeIsActive()` check) when the bus status changes. At that point, `ctx.queue.add(scheduleSelectorCycle)` fires against a queue that is being cleared.

If this task lands after `queue.clear()` but before `queue.onIdle()`, `orchestrator.stop()` blocks on `queue.onIdle()` indefinitely because the queue is paused (tasks won't run) but not empty (the task is queued). Stop hangs. When `stopSession()` finally unblocks or throws, the session's DB status becomes `"attention_required"`.

Now `resumeSession` in the manager has:

```ts
const runtime = this.runtimes.get(sessionId) ?? (await this.startSession(sessionId));
```

If anything triggers resume on an `attention_required` session with no runtime, `startSession` creates a brand-new runtime and kicks off a new orchestrator with a fresh selector cycle. **New AI loop starts — directly from clicking Stop.**

**Why it's wrong:** The user clicked Stop. The system created a new runtime and started a new AI analysis cycle.

**Severity:** `Flow-breaking` — the terminal user action (Stop) causes the opposite behavior (new runtime + new loop).

**Fix direction:** Two structural fixes required:
1. `trade-closed-handler.ts` must use `ctx.enqueueTask` (which checks `ctx.stopped`) rather than `ctx.queue.add()` directly.
2. `resumeSession` must not call `startSession` for sessions with no runtime. If the runtime doesn't exist, throw — don't silently create one.

---

### 4. Stop Button Available During Active Monitoring — Wrong Controls for the State

**What the user wants to do:** See appropriate controls based on what the session is actually doing.

**What the app does instead:** When a session is in the monitoring phase (stage = `"monitoring"`, trades open, waiting for broker results), both "Pause" and "Stop" are available. The UI doesn't distinguish between:
- **Pause** — stops new cycles, keeps monitor alive (correct during monitoring)
- **Stop** — kills everything including the monitor (dangerous during monitoring)

**Why it's wrong:** "Monitoring position" in the progress bar + Stop button creates an affordance that says "stop monitoring this position." That's not what Stop does — it orphans the position.

**Severity:** `Confusing` — the user picks the wrong control because the UI doesn't signal the difference.

**Fix direction:** During the monitoring stage:
- Surface "Pause after step" more prominently (or auto-transition to monitoring-only mode)
- Disable or rename Stop to "Force stop (loses trade management)" with a confirmation modal when `openTradeCount > 0`

---

### 5. No Feedback When Stop Leaves Orphaned Trades

**What the user wants to do:** Know that their open positions are now unmanaged after a stop.

**What the app does instead:** Stop completes, session shows "stopped." No banner, no badge, no indication that the session has `N open trades` that are no longer being monitored.

**Why it's wrong:** The user believes the system is clean. The trades are still marked "open" in the DB, broker position is still live, but nothing is managing them. Silent risk exposure.

**Severity:** `State-corrupting` — user is unaware of ongoing risk.

**Fix direction:** After stop, if `openTradeCount > 0`, show a persistent warning on the session card: "Stopped with N open trade(s) — no automated exits will fire. Restart to resume monitoring." The stopped session should surface this prominently, not just in the trade count metric.

---

## Rules the App Should Enforce (But Doesn't)

**Rule: No selector while any trade is open.**
- Why: The selector starts a new AI analysis → new entry candidates → new positions → compound exposure while prior positions are still unresolved.
- What enforces it now: Nothing. `hasOpenTradeCapacity()` is capacity-based, not closure-based.
- What should enforce it: A single `hasAnyOpenTrade(sessionId)` check in `trade-closed-handler.ts`, `cycle-refill.ts`, and any other selector entry point. This must be the first gate, before capacity is evaluated.

**Rule: Stop must not kill the trade monitor while positions are open.**
- Why: The monitor is the only automated exit mechanism. Killing it means stops and take-profits can't fire.
- What enforces it now: Nothing. Stop always kills the monitor.
- What should enforce it: Block Stop when trades are open, or add a monitoring-only state that survives to zero open trades before completing the stop.

**Rule: `trade_closed` must only restart the selector when ALL trades are closed.**
- Why: Restarting after one of many closures runs new AI cycles on top of live open positions.
- What enforces it now: Nothing. Handler fires on any individual closure.
- What should enforce it: `trade-closed-handler.ts` checks `remaining open trades === 0` before scheduling.

**Rule: `ctx.queue.add()` in the trade-closed listener must respect `ctx.stopped`.**
- Why: Direct queue access bypasses the `enqueueTask` stop guard, enabling the race where Stop triggers a new loop.
- What enforces it now: `runtimeIsActive()` bus check only — has a window between event delivery and status propagation.
- What should enforce it: Replace `ctx.queue.add()` in `trade-closed-handler.ts` with `ctx.enqueueTask()`.

**Rule: `resumeSession` must not silently create a new runtime.**
- Why: If resume finds no runtime for an existing session, creating one is an implicit restart with no preflight, no live readiness check, no user intent.
- What enforces it now: Nothing. `runtimes.get(sessionId) ?? startSession()` is the current behavior.
- What should enforce it: If no runtime exists and the session isn't in `draft`/`idle`/`stopped`, throw `SESSION_NOT_ACTIVE`.

**Rule: Startup must reconcile all open DB trades against broker state before the first monitor tick.**
- Why: Broker-side fills (stop-loss, take-profit, cancellations) that occurred during app downtime are invisible to the DB until explicitly checked. The first monitor tick may be minutes away for swing/position sessions.
- What enforces it now: Nothing. `rehydrateFromDb` starts sessions and lets the normal interval timer fire the first tick.
- What should enforce it: A dedicated startup reconciliation pass in `rehydrateFromDb` that calls `adapter.getOrderStatus(broker_order_id)` for every trade in `"open"` DB state, reconciles closes, and only then starts the normal monitor loop.

**Rule: `"stopped"` sessions with open trades must be included in startup rehydration.**
- Why: A session stopped while trades were open (whether by user action or crash) has live positions at the broker with no monitor. The next restart must pick these up.
- What enforces it now: Nothing. `listByStatuses(["active", "paused"])` excludes stopped sessions.
- What should enforce it: `rehydrateFromDb` should also include sessions where `status === "stopped" AND openTradeCount > 0`, starting them in monitoring-only mode.

**Rule: App quit must stop all session runtimes before closing the DB.**
- Why: `before-quit` currently only closes the SQLite file. Every active runtime is abandoned — steps stay `"running"`, capital stays reserved, in-flight AI calls are billed for nothing.
- What enforces it now: Nothing. `services?.db.sqlite.close()` is the entire teardown.
- What should enforce it: `before-quit` / `will-quit` must call `stopSession()` on all active runtimes before closing the DB. On next startup, any step still in `"running"` state must be marked `"failed"` with code `"process_killed"` before the runtime restarts.

**Rule: Each session runtime must be isolated from other session runtimes.**
- Why: All runtimes share the Electron main process. A crash or OOM in one session kills all other sessions and their trade monitors.
- What enforces it now: Nothing. Everything runs on the same Node.js event loop.
- What should enforce it: Session runtimes should run in Node.js worker threads or child processes — independent memory, independent crash boundary, independently restartable.

**Rule: The first monitor tick must fire immediately on start, not after the first interval.**
- Why: `setInterval` delays the first tick by the full poll interval. For position-style sessions this is 5 minutes. During that window after crash/restart, no exits can fire.
- What enforces it now: Nothing. `start()` does `setInterval(() => void this.tick(), pollMs)` with no leading tick.
- What should enforce it: `start()` should call `void this.tick()` immediately before registering the interval.

---

---

### 6. Process Crash or Kill — Open Trades Partially Orphaned on Restart

**What the user wants to do:** Restart the app after a crash and have trade monitoring resume exactly where it left off, covering the gap.

**What the app does instead — gap by gap:**

**`rehydrateFromDb` only picks up `"active"` and `"paused"` sessions.** Sessions in `"stopped"` state with open trades (bug from section 1 above) are never rehydrated. Their trades remain in `"open"` DB state permanently — not managed before the crash, not managed after.

**No immediate catch-up tick on monitor start.** `TradeMonitor.start()` schedules a `setInterval` but does not run a tick immediately. The first tick fires after the full poll interval: 5 seconds for intraday, 60 seconds for swing, 5 minutes for position/custom styles. During that window after restart, positions sit unmanaged. For a swing or position style session, that's a full minute of no exit enforcement after the app comes back up.

**Broker-side fills during downtime are not reconciled on startup.** If the broker executed a stop-loss or take-profit while the app was dead, the trade is still marked `"open"` in the local DB. The monitor will eventually catch this on the next tick (via `adapter.getMarketSnapshot` + exit policy evaluation), but there is no startup reconciliation pass that immediately checks all open DB trades against current broker state. If the crash happened at a critical price level and take-profit fired broker-side, the app doesn't know until the next tick — and won't record a clean P&L close until then.

**Capital reservations from in-flight trades at crash time may be leaked.** `releaseApprovalsAndCapital` is called in `orchestrator.stop()` during a clean stop. A crash skips this entirely. On rehydration, the orchestrator starts fresh with a new `TradingCycleContext` that has empty `pendingApprovalIds` and `approvalCallbacks`. Any capital reservations that were held by the old context are not automatically released. If the capital reservation service is DB-backed, those reservations persist.

**Why it's wrong:** After a crash, the user expects the app to pick up where it left off — especially for open positions. The actual behavior is a delayed, partial recovery: only `active`/`paused` sessions restart, no catch-up tick fires, broker-side fills during the outage are invisible until the next poll, and stopped-with-open-trades sessions are silently abandoned.

**Severity:** `State-corrupting` — open positions can accumulate unrealized losses during the restart window with no exit enforcement, and broker-side events during downtime are not reconciled.

**Fix direction:**
- Add a startup reconciliation pass in `rehydrateFromDb` that immediately checks all open DB trades against broker order status before starting the normal monitor loop. For each trade marked `"open"` in DB: call `adapter.getOrderStatus(broker_order_id)` and reconcile — close it in DB if the broker already filled/cancelled it.
- Run one immediate tick in `TradeMonitor.start()` on first start (not restart via `setInterval`): `void this.tick(); this.timer = setInterval(...)`.
- Include `"stopped"` sessions with `openTradeCount > 0` in the rehydration list, starting them in a monitoring-only mode.
- On rehydration, audit `capitalReservationsRepo` for reservations with no corresponding active runtime and release them.

---

### 7. "Monitoring Position" Progress Reads as Done — It Isn't

**What the user wants to do:** Glance at the session card and know whether the system is actively waiting for a trade outcome or has finished its work.

**What the app does instead:** When a trade reaches the monitoring stage, `STAGE_META.monitoring.progressPct = 100` and the fill bar goes to 100%. `activeStatus` is `"succeeded"`. The visual reads as "pipeline complete." Nothing in the UI communicates that the system is in an indefinite hold — it could be waiting seconds or weeks.

**Why it's wrong:** 100% progress with green fill and "Monitoring position" label is identical in appearance to a completed cycle. A user who glances at the sessions list will not know whether the system is actively managing a live position or has finished and is idle.

**Severity:** `Confusing` — the user cannot distinguish "actively holding a position" from "done."

**Fix direction:** Monitoring stage should use a distinct visual state: pulsing indicator (not a full bar), a different label ("Holding position — waiting for exit"), and the `openTradeCount` metric surfaced inline on the session card. 100% fill should be reserved for "cycle complete, no open positions."

---

### 8. Trade Close is Silent — No User Notification

**What the user wants to do:** Know when a position closes without having to poll the trades list.

**What the app does instead:** When `trade_closed` fires, `App.tsx` calls `reloadTrades()` silently. No toast appears. No banner. No sound. `RuntimeEventToast` only surfaces `ERROR` and `WARN` level `agent_event` entries. A trade closing at take-profit or stop-loss is a neutral outcome — no toast fires.

The user discovers their trade closed by: noticing the open trade count dropped, or manually checking the Trades page.

**Why it's wrong:** A position closing is the most significant outcome in the system. The user set up the session specifically to trade. A silent UI update (trade list refresh) for a take-profit or stop-loss exit means the user has no awareness that anything happened unless they're actively watching.

**Severity:** `Friction` — user must actively poll to learn what happened. In a live session, this is a significant gap in situational awareness.

**Fix direction:** Fire a toast on `trade_closed` that shows the instrument, exit reason (stop-loss / take-profit / max-hold / manual), and realized P&L. This does not require a new event — `trade_closed` is already emitted by the bus and subscribed in `App.tsx`. Add a handler that pulls the close payload and renders an info-level toast.

---

### 9. Progress Bar Does Not Update When Trade Closes — Stale "Monitoring" State

**What the user wants to do:** See the session card update when a trade closes and the monitoring phase ends.

**What the app does instead:** `SessionsPage` updates `progressBySessionId` in response to `step:started`, `step:succeeded`, `step:failed`, and `step:retrying` events. The monitoring stage is set when `broker_order` succeeds — that's the last real step event. When the trade monitor closes a trade (via `TradeMonitor.tick`), it does not go through the `TradingStepRunner` and does not emit any `step:*` event. It emits `trade_closed` directly.

The session table listens for `trade_closed` and calls `reloadTrades`, which updates trade counts. But `progressBySessionId` is not refreshed. The progress bar stays at "Monitoring position / 100%" even after the trade closes and the position is gone.

**Why it's wrong:** The progress display is stale. The user sees "Monitoring position" with a full bar after the trade already closed. The session has actually returned to idle (waiting for the next selector cycle), but the card says it's still monitoring.

**Severity:** `Confusing` — stale progress state means users cannot trust the progress bar as a real-time signal.

**Fix direction:** Subscribe to `trade_closed` in `SessionsPage` and call `refreshProgress(sessionId)` when it fires — same pattern as the `step:*` events. Alternatively, clear `progressBySessionId[sessionId]` on `trade_closed` so the monitoring stage chip disappears, which is the correct state: no active cycle, waiting for the next selector run.

---

---

### 10. Graceful Termination — App Quit Doesn't Stop Runtimes

**What the user wants to do:** Close or quit the app and have in-progress sessions stop cleanly — steps finalized, capital released, state written — so the next startup has an accurate picture of what was in flight.

**What the app does instead:** `electron/main/index.ts`'s `before-quit` handler:

```ts
app.on("before-quit", () => {
  services?.db.sqlite.close();
});
```

That's the entire teardown. The SQLite file is closed. No runtime is stopped. No `orchestrator.stop()` is called. No `tradeMonitor.stop()`. No capital reservations released. Every `SessionRuntime` in `runtimeManager.runtimes` is abandoned in memory and evaporates with the process.

The specific damage from a graceless quit:

**Steps stuck in `"running"` forever.** `TradingStepRunner` persists step state to the DB. When a step starts it's written as `"running"`. On clean completion it's updated to `"succeeded"`. On quit while a step is running, the update never fires — the step stays `"running"` in the DB. `ACTIVE_STEP_STATUSES = ["failed", "retrying"]` — `"running"` is not included. There is no query that detects stale-running steps. After restart, the progress bar for that session will show the step as still running indefinitely, even though no AI is executing.

**In-flight AI calls pay tokens and produce nothing.** If the LLM was mid-generation (streaming response), the API call is abandoned. Tokens are billed. The partial response is discarded. No checkpoint of the partial output exists.

**Retry timers and no-instrument retry delays are lost.** `ctx.noInstrumentRetryTimer` is a `setTimeout` — purely in-memory. On restart, the orchestrator has no knowledge that it was scheduled to retry in 3 minutes. It either starts fresh (new selector cycle immediately) or stays idle until the user manually resumes.

**`pendingApprovalIds` and `approvalCallbacks` are lost.** Human-approval trades that were in the approval queue are abandoned with no record. The approval UI may show them as pending but the callback that would resolve them no longer exists.

**Why it's wrong:** The user quits the app expecting it to clean up. Instead, DB has stale `"running"` steps that are never resolved, capital is locked until manual intervention, and the progress UI on next startup shows phantom in-progress work.

**Severity:** `State-corrupting` — DB state diverges from reality on every non-crash app quit with active sessions.

**Fix direction:** Extend `before-quit` to be async-aware (or use `app.on("will-quit", event => { event.preventDefault(); ... })`):

```ts
app.on("before-quit", async () => {
  if (!services) return;
  // Stop all active runtimes gracefully (clears queue, releases capital, finalizes steps)
  for (const runtime of services.runtimeManager.listActive()) {
    await services.runtimeManager.stopSession(runtime.sessionId).catch(() => {});
  }
  services.db.sqlite.close();
});
```

Additionally, on startup in `rehydrateFromDb`, mark any steps with `status = "running"` as `"failed"` with error code `"process_killed"` before starting the runtime — so the progress bar reflects reality and the user can retry.

---

### 11. AI Runtimes Run in the Electron Main Process — No Isolation

**What the user wants to do:** Run multiple sessions. Have one session's AI runtime crash or OOM without taking down everything else.

**What the app does instead:** All `SessionRuntime` instances live in `SessionRuntimeManager.runtimes`, a `Map` inside the Electron main process. Every AI call, every LLM stream, every broker HTTP call, every PQueue task — all run on the same Node.js event loop. A single unhandled rejection or out-of-memory event in one session's orchestrator can kill the entire process, taking all other sessions, the UI, and the IPC bridge with it.

Current consequences of the shared-process model:

**No independent restart.** If session A's runtime throws fatally, the only recovery is restarting the whole Electron app. Session B and C runtimes also die, even if they were healthy.

**No memory isolation per session.** Large LLM responses, accumulated failure history, and cached broker data for one session compete with all others for the same heap. A session doing deep research with large context windows can OOM the process for everyone.

**No per-runtime kill signal.** To stop one runtime cleanly, you call `runtimeManager.stopSession()` in-process. You cannot send a signal to just that runtime. There's no way to hard-kill one session's AI loop without affecting others.

**Crash during AI streaming takes down all open trade monitors.** The trade monitor for every session runs on the same event loop. If an AI streaming response for session A causes a crash, session B's monitor tick that was 2 seconds away never fires.

**Why it's wrong:** For a system managing live money across multiple concurrent sessions, process isolation is not a nice-to-have. A crash in session A should not be observable by session B. The current architecture makes session isolation impossible.

**Fix direction:** Move each `SessionRuntime` (orchestrator + trade monitor) to a Node.js [Worker Thread](https://nodejs.org/api/worker_threads.html) or a child process spawned via `child_process.fork`. The main process becomes a coordinator: it manages IPC, DB writes, and the renderer bridge. Each session runtime is an independent unit that:

- Can be killed and restarted without touching other sessions
- Has its own memory heap (via `worker_threads` with `--max-old-space-size` per worker)
- Can be monitored for health (heartbeat from the worker on a known interval)
- Reports step events, trade events, and bus events back to the main process via `postMessage` / IPC
- Can be gracefully terminated via `worker.terminate()` or `process.kill(worker.pid, 'SIGTERM')` targeting only that runtime

The DB remains in the main process. Workers communicate through a message protocol. The existing `EventBus` abstraction becomes a cross-process bridge. The `SessionRuntimeManager` becomes a process manager rather than an in-process object map.

This also makes graceful termination (callout #10) straightforward: on `before-quit`, send SIGTERM to each worker, wait for ACK, then exit.

---

## What's Working

**Pause semantics are correct.** Pausing blocks new intake but keeps the trade monitor alive. This is the right design. `SessionRuntime.pause()` and `resume()` use a serial lifecycle queue that prevents concurrent state mutations.

**The `runtimeIsActive()` bus check intent is right.** Setting bus status to `"stopping"` before entering `orchestrator.stop()` means most in-flight event handlers see "not active" before cleanup runs. The gap is specifically in `ctx.queue.add()` bypassing this guard.

**`queue.onIdle()` before declaring stop complete.** Waiting for the queue to drain before marking the session stopped prevents mid-step termination. The design intent is correct; the failure is tasks arriving after `clear()` making `onIdle()` block.

**Rehydration demotes active → paused.** On app restart, sessions that were `active` are demoted to `paused` instead of auto-resumed. The monitor still starts so open positions remain managed. This is the right conservative default.

---

## Priority Order

**Fix first — flow-breaking / state-corrupting:**
1. `trade-closed-handler.ts`: use `ctx.enqueueTask` instead of `ctx.queue.add` — closes the race that triggers a new loop on stop
2. `trade-closed-handler.ts` + `cycle-refill.ts`: add `openTrades.length === 0` check before scheduling any selector cycle
3. Stop with open trades: block the action or warn prominently + preserve monitor lifecycle
4. Crash recovery: run immediate reconciliation pass in `rehydrateFromDb` — check all open DB trades against broker order status before first monitor tick
5. Crash recovery: include `"stopped"` sessions with open trades in rehydration list

**Fix next — confusing / high-frequency:**
6. Monitoring phase: change Stop button label/behavior when `openTradeCount > 0`
7. Post-stop state: warning banner on stopped sessions that have open trades
8. `resumeSession`: remove the silent `startSession` fallback — throw instead
9. `TradeMonitor.start()`: run one immediate tick before the first `setInterval` fires
10. Progress bar: subscribe to `trade_closed` in `SessionsPage` and call `refreshProgress` — stale "Monitoring position" after close

**Fix when you can — low-frequency:**
11. Trade close toast: fire an info-level toast on `trade_closed` with instrument + exit reason + realized P&L
12. "Monitoring position" visual: replace 100% fill bar with a pulsing/distinct "holding" indicator that can't be confused with a completed cycle
13. Clearer label differentiation between Pause and Stop during the monitoring phase in session controls
14. Audit capital reservations on rehydration — release any reservations with no active runtime

**Architectural — do when the system stabilizes:**
15. Graceful termination: extend `before-quit` to stop all runtimes before closing DB; mark stale `"running"` steps as `"failed"` on next startup
16. Process isolation: move each `SessionRuntime` to a Node.js worker thread or child process — independent crash boundary, independent restart, per-session memory limits
