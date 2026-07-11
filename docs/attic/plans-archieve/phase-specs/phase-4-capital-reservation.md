# Phase 4 Spec — Capital Reservation for Full Autonomy

> **Status:** Not started
> **Files to modify:**
>
> - `electron/main/services/orchestration/agent-orchestrator.ts` (lines 334–364)
> - `electron/main/services/risk/capital-reservation-service.ts` (add `reserveForOrder`)
> - `electron/main/db/repositories/capital-reservations-repo.ts` (add `reserveForOrder`)

---

## Goal

No-approval sessions (`humanApprovalRequired: false`) currently skip all capital reservation. Two `moderate` preset sessions can exceed the global pool with no enforcement. Fix: every autonomous order reserves capital before the broker call, regardless of approval mode.

---

## 1. Root Cause (Exact Code)

In `agent-orchestrator.ts`:

```ts
// Line 334–364 — current broken flow:

let approvalIdForCapital: string | null = null;
if (config.human_approval_required) {
  // ... waitForApproval sets approvalIdForCapital
}

const placed = await this.placeRoutedOrder(...);

if (approvalIdForCapital) {  // ← false for no-approval sessions
  this.capitalReservation.convertApprovalToOpenOrder(approvalIdForCapital, trade.id);
}
if (workspace.capitalAllocationMode === "shared_global_pool" && approvalIdForCapital) {  // ← also false
  this.capitalReservation.convertOrderToPosition(trade.id);
}
```

For no-approval sessions, `approvalIdForCapital` is always `null`, so `convertOrderToPosition` never fires. The pool is never debited.

---

## 2. New `reserveForOrder` Method

The existing `reserveForApproval` creates a reservation tied to an `approvalId`. We need a parallel path that creates a reservation tied directly to a `tradeId`.

### `CapitalReservationsRepo` addition

```ts
// electron/main/db/repositories/capital-reservations-repo.ts

reserveForOrder(input: { sessionId: string; tradeId: string; amountUsd: number }): CapitalReservation {
  // INSERT INTO capital_reservations with:
  //   session_id   = input.sessionId
  //   trade_id     = input.tradeId
  //   approval_id  = NULL
  //   amount_usd   = input.amountUsd
  //   status       = 'reserved'
  //   created_at   = now()
}
```

The existing `reserveForApproval` row shape uses `approval_id` as the anchor. The new method uses `trade_id` as the anchor directly. Both converge on the same row once open; `releaseOnClose(tradeId)` already works on `trade_id` so it will cover both paths.

### `CapitalReservationService` addition

```ts
// electron/main/services/risk/capital-reservation-service.ts

reserveForOrder(input: { sessionId: string; tradeId: string; amountUsd: number }): CapitalReservation {
  return this.repo.reserveForOrder(input);
}
```

---

## 3. Reservation Availability Check

Before calling `reserveForOrder`, the orchestrator must confirm the pool has room. This is the same check as `checkSessionStartFits` but per-order:

```ts
// Add to CapitalReservationService:

checkOrderFits(amountUsd: number): { ok: true } | { ok: false; reserved: number; ceiling: number } {
  const workspace = this.workspacePreferencesRepo.get();
  if (workspace.capitalAllocationMode !== "shared_global_pool") return { ok: true };
  const ceiling = workspace.globalCapitalPoolUsd;
  if (ceiling == null || ceiling <= 0) return { ok: false, reserved: this.repo.sumActiveReservedUsd(), ceiling: 0 };
  const reserved = this.repo.sumActiveReservedUsd();
  if (reserved + amountUsd > ceiling) return { ok: false, reserved, ceiling };
  return { ok: true };
}
```

---

## 4. Target Call Flow in `runTradeCycle()`

```ts
// BEFORE placeRoutedOrder(), regardless of human_approval_required:

const workspace = this.deps.workspacePreferencesRepo.get();
const useSharedPool = workspace.capitalAllocationMode === "shared_global_pool";

// --- Human approval path (existing, unchanged) ---
let approvalIdForCapital: string | null = null;
if (config.human_approval_required) {
  const { approved, approvalId } = await this.waitForApproval(...);
  approvalIdForCapital = approvalId;
  if (!approved) {
    this.deps.capitalReservation.releaseByApproval(approvalId);
    // ... reject trade
    return;
  }
  // approval path already reserved via reserveForApproval in waitForApproval
}

// --- No-approval path: reserve now ---
if (!config.human_approval_required && useSharedPool) {
  const fit = this.deps.capitalReservation.checkOrderFits(trade.position_size_usd);
  if (!fit.ok) {
    this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
    this.emitEvent("WARN", trade.id, `Global capital pool exhausted (reserved $${fit.reserved}, ceiling $${fit.ceiling})`);
    return;
  }
  this.deps.capitalReservation.reserveForOrder({
    sessionId: this.sessionId,
    tradeId: trade.id,
    amountUsd: trade.position_size_usd,
  });
}

// --- Place order ---
const placed = await this.placeRoutedOrder(trade, instrument.instrumentClass, risk.value);
if (!placed) {
  // Release the reservation we just created
  if (!config.human_approval_required && useSharedPool) {
    this.deps.capitalReservation.releaseOnFailure(trade.id);
  } else if (approvalIdForCapital) {
    this.deps.capitalReservation.releaseByApproval(approvalIdForCapital);
  }
  this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
  // ...
  return;
}

// --- Broker success: convert reservation to open position ---
const opened = this.deps.tradesRepo.markOpen(trade.id, placed.brokerOrderId, placed.filledAvgPrice);
if (approvalIdForCapital) {
  this.deps.capitalReservation.convertApprovalToOpenOrder(approvalIdForCapital, trade.id);
}
if (useSharedPool) {
  // Applies to both approval and no-approval paths now
  this.deps.capitalReservation.convertOrderToPosition(trade.id);
}
```

---

## 5. Release on Failure / Stop

The release paths that already exist (`releaseOnClose`, `releaseOnCancel`, `releaseOnFailure`) all operate on `tradeId` — they will work for the new `reserveForOrder` rows without changes.

The orchestrator `stop()` method must release all reservations for the session. This already happens via `releaseByApproval` for approval-mode sessions. Add:

```ts
// In AgentOrchestrator.stop():

// Release all active no-approval reservations for this session
const activeReservations = this.deps.capitalReservation.listActiveBySession(
  this.sessionId,
);
for (const r of activeReservations) {
  if (r.approvalId == null) {
    this.deps.capitalReservation.releaseOnFailure(r.tradeId);
  }
}
```

`listActiveBySession` already exists on `CapitalReservationService`.

---

## 6. Reservation Lifecycle State Machine

```
reserveForOrder() → status: "reserved"
     │
     ├─ placeOrder succeeds → convertOrderToPosition() → status: "position"
     │       │
     │       └─ trade closed → releaseOnClose() → row deleted or status: "released"
     │
     ├─ placeOrder fails (broker reject / conflict) → releaseOnFailure() → deleted
     │
     └─ session stopped before order → releaseOnFailure() → deleted
```

No new status values needed — existing `"reserved"` → `"position"` → `"released"` covers it.

---

## 7. `capital_reservations` Schema (Existing — Confirm Compatibility)

The existing table must support `approval_id = NULL` rows. Verify in `capital-reservations-repo.ts` that:

1. `reserveForApproval` does not have a `NOT NULL` constraint on `approval_id` that would block a `NULL` insert — or add a separate `reserveForOrder` INSERT statement that uses `trade_id` as the primary anchor.
2. `sumActiveReservedUsd()` counts rows with `status IN ('reserved', 'position')` regardless of whether `approval_id` is null.
3. `releaseOnFailure(tradeId)` matches on `trade_id` column — confirm the WHERE clause doesn't also require `approval_id IS NOT NULL`.

If any of these assumptions are false, the repo method must be patched before `reserveForOrder` is wired in.

---

## 8. Acceptance Tests

```
describe("CapitalReservationService.checkOrderFits")
  ✓ mode=shared_global_pool, reserved=400, ceiling=500, order=50 → ok: true
  ✓ mode=shared_global_pool, reserved=470, ceiling=500, order=50 → ok: false (470+50 > 500)
  ✓ mode=per_session → ok: true always

describe("Capital reservation — no-approval path")
  ✓ two moderate sessions (humanApprovalRequired:false) each reserve $250 → second order blocked when ceiling=$450
  ✓ broker reject releases reservation immediately (sumActiveReservedUsd decreases)
  ✓ trade close releases reservation (sumActiveReservedUsd decreases)
  ✓ session stop releases all active no-approval reservations for that session

describe("Capital reservation — approval path (regression)")
  ✓ existing approval-mode reservation flow still works unchanged
  ✓ approval rejection still releases reservation via releaseByApproval
```
