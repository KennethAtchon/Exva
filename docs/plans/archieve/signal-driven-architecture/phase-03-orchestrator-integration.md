# Phase 3 — Orchestrator Integration

> **Date:** 2026-05-28
> **Status:** Todo
> **Spec sections:** §3 (Orchestrator catalyst trigger, preflight), §5.2 (signal-to-trade cycle), §5.3 (manual ticker flow), §6.7 (session table change)
> **Depends on:** Phase 2 (SignalBus, repos, delivery rows must exist)
> **Unlocks:** Phase 4 (Pipeline cleanup)

---

## 1. Problem Statement

The orchestrator (`AgentOrchestrator`) currently drives pipeline cycles without any concept of a signal queue. It has no mechanism to receive an inbound signal, enqueue it for a session, or trigger a cycle with catalyst context. This phase wires the signal bus into the orchestrator, implements the per-session FIFO queue, handles the manual ticker injection flow at session start, and adds the readiness preflight that determines whether a session has live inputs.

---

## 2. Goals

| #   | Goal                                                                   | Done When                                                                                         |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `attachSignalListener` / `detachSignalListener` added to orchestrator  | Analogous to existing `attachTradeClosedListener`                                                 |
| 2   | Per-session FIFO delivery queue implemented                            | One active cycle at a time; new deliveries append behind it                                       |
| 3   | `schedulePinnedSelectorCycle` called with catalyst context             | Pipeline receives ticker, companyName, documentUrl, processingMode                                |
| 4   | Paused-session delivery handling                                       | Deliveries for paused sessions get `waiting_for_resume` status + `expires_at = detectedAt + 4h`   |
| 5   | Manual ticker injection at session start                               | Each ticker in `instrumentScope` becomes a `ManualSignalEvent` injected into the bus              |
| 6   | Session readiness preflight                                            | `armed \| manual_only \| waiting_for_source_enable \| no_inputs` derived before start             |
| 7   | Session `selection_mode = signal_driven` set on signal-driven sessions |                                                                                                   |
| 8   | On-restart delivery replay                                             | Orchestrator replays un-fanned-out source events and unfinished session deliveries on app restart |

---

## 3. `attachSignalListener` / `detachSignalListener`

The orchestrator calls `attachSignalListener(sessionId)` when a session starts, and `detachSignalListener(sessionId)` when it stops or pauses.

```typescript
// In AgentOrchestrator (or a SessionSignalQueue companion class):
attachSignalListener(sessionId: string): void {
  const handler = (event: SignalEvent) => this.handleInboundSignal(sessionId, event);
  this.signalBus.onSignal(sessionId, handler);
  this.signalHandlers.set(sessionId, handler);
}

detachSignalListener(sessionId: string): void {
  const handler = this.signalHandlers.get(sessionId);
  if (handler) {
    this.signalBus.offSignal(sessionId, handler);
    this.signalHandlers.delete(sessionId);
  }
}
```

`SignalBus.onSignal(sessionId, handler)` is scoped: the bus only calls this handler for events destined for `sessionId` (i.e., events where a `session_signal_delivery` row was created for this session).

---

## 4. Per-Session FIFO Queue

Each session maintains a delivery queue: an ordered list of `session_signal_delivery` IDs with status `queued`. Exactly one delivery can be in `processing` status at a time per session.

**Invariants:**

- When a delivery enters `processing`, all others remain `queued`.
- A new signal arriving while a cycle is active appends to the queue (creates a `queued` delivery, does not interrupt).
- When the active cycle finishes (delivery reaches terminal status), the orchestrator dequeues the next `queued` delivery and starts a new cycle.

**Queue position:** `queue_position_at_enqueue` is set at delivery creation time. Use `SELECT COUNT(*) + 1 FROM session_signal_deliveries WHERE session_id = ? AND status = 'queued'` at insert time.

**Drain loop:**

```typescript
private async drainSignalQueue(sessionId: string): Promise<void> {
  const next = await this.deliveriesRepo.nextQueued(sessionId);
  if (!next) return;
  await this.deliveriesRepo.setStatus(next.id, "processing");
  await this.eventBus.emit("signal_delivery_updated", { deliveryId: next.id, sessionId, signalId: next.signalEventId, status: "processing", statusBucket: "pending" });
  await this.schedulePinnedSelectorCycle(sessionId, next);
  // cycle completion transitions delivery to terminal status and calls drainSignalQueue again
}
```

---

## 5. `schedulePinnedSelectorCycle` with Catalyst Context

When a delivery moves to `processing`, the orchestrator calls `schedulePinnedSelectorCycle` (or the equivalent cycle-start function) with catalyst context injected into `selectionInstructions`:

```
"EDGAR 8-K detected: {companyName} ({ticker}) filed at {filedAt}.
Document: {documentUrl}.
Mode: catalyst.
Evaluate whether this filing is material and actionable."
```

For `manual` source type:

```
"Manual ticker: {ticker}. Mode: catalyst. Validate that this is a tradeable equity and assess current opportunity."
```

The `processingMode` passed to the pipeline is derived from source type:

- `edgar_8k` → `"catalyst"`
- `web_search` → `"trend_scan"` (maps to existing standard workers)
- `manual` → `"catalyst"`

---

## 6. Paused Session Handling

When the SignalBus fans out a signal event and a target session has `status = "paused"`:

- Create the `session_signal_delivery` row with `status = "waiting_for_resume"` and `expires_at = detectedAt + 4h`.
- Do **not** call `attachSignalListener` or trigger a cycle.

On resume:

1. Orchestrator's session-resume path queries deliveries with `status = "waiting_for_resume"`.
2. Any delivery where `expires_at < now()` → set to `expired`.
3. Remaining `waiting_for_resume` deliveries → transition to `queued` and call `drainSignalQueue`.

---

## 7. Manual Ticker Injection

In `orchestrator.start(sessionId)`, after setting session status to `running` and before the first cycle:

```typescript
const session = await this.sessionsRepo.get(sessionId);
const tickers = parseTickerList(session.instrumentScope); // split on comma/newline, trim, filter empty

for (const ticker of tickers) {
  const manualEvent: SignalEvent = {
    id: crypto.randomUUID(),
    sourceId: MANUAL_SOURCE_ID, // well-known ID for the implicit manual source
    sourceType: "manual",
    ticker,
    companyName: null,
    documentUrl: null,
    accessionNumber: null,
    payloadJson: {},
    filedAt: new Date().toISOString(),
    detectedAt: new Date().toISOString(),
  };
  await this.signalBus.injectManual(manualEvent, sessionId);
}

await this.drainSignalQueue(sessionId);
```

`SignalBus.injectManual` skips the source-subscription check (manual signals always go to the specified session) and creates the delivery row directly.

---

## 8. Session Readiness Preflight

Called before `start()` returns or before the start confirmation dialog. Returns one of:

```typescript
type SessionReadiness =
  | "armed" // ≥1 enabled subscribed source OR ≥1 manual ticker
  | "manual_only" // manual tickers present, zero enabled subscribed sources
  | "waiting_for_source_enable" // subscribed sources exist but all disabled, no manual tickers
  | "no_inputs"; // no manual tickers, no subscribed sources at all
```

```typescript
async deriveReadiness(sessionId: string): Promise<SessionReadiness> {
  const [tickers, subscriptions] = await Promise.all([
    this.getManualTickerCount(sessionId),
    this.getSubscribedSourceStates(sessionId), // [{sourceId, enabled}]
  ]);

  const hasManual = tickers > 0;
  const enabledSources = subscriptions.filter(s => s.enabled).length;
  const anySources = subscriptions.length > 0;

  if (enabledSources > 0 || hasManual) {
    return hasManual && enabledSources === 0 ? "manual_only" : "armed";
  }
  if (anySources) return "waiting_for_source_enable";
  return "no_inputs";
}
```

Sessions in `waiting_for_source_enable` or `no_inputs` require explicit start confirmation (modal must surface this — handled in Phase 6).

---

## 9. On-Restart Delivery Replay

On app startup, after the orchestrator initializes:

1. Query `signal_events` where `dispatch_status = 'new'` (fanned-out was never completed). Re-run fan-out for each.
2. Query `session_signal_deliveries` where `status IN ('queued', 'processing')` for sessions that are `running`.
   - For any delivery stuck in `processing` (app crashed mid-cycle): reset to `queued`.
   - Call `drainSignalQueue(sessionId)` for each affected session.
3. Query `session_signal_deliveries` where `status = 'waiting_for_resume'` and `expires_at < now()`. Mark as `expired`.

---

## 10. Checklist

- [ ] `attachSignalListener` / `detachSignalListener` on orchestrator
- [ ] Per-session FIFO queue with `drainSignalQueue` drain loop
- [ ] `schedulePinnedSelectorCycle` receives catalyst context (ticker, companyName, documentUrl, processingMode)
- [ ] Paused-session deliveries get `waiting_for_resume` + `expires_at`
- [ ] On-resume: expired deliveries marked `expired`, remaining re-queued
- [ ] Manual tickers injected as `ManualSignalEvent`s at session start
- [ ] `deriveReadiness` returns correct state for all 4 conditions
- [ ] `sessions.selection_mode = 'signal_driven'` set on sessions using sources
- [ ] On-restart: stuck `processing` deliveries reset to `queued` and replayed
- [ ] On-restart: un-fanned-out `signal_events` re-dispatched
- [ ] `signal_delivery_updated` EventBus event emitted on every status transition
