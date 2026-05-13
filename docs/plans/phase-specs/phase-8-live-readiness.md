# Phase 8 Spec — Live Readiness Gate

> **Status:** Not started — depends on all prior phases
> **Files to create:**
> - `electron/main/services/risk/live-readiness-service.ts`
> **Files to modify:**
> - `electron/main/ipc/session.ts` (add `session:getLiveReadiness`, `session:acknowledgeLiveReadiness`)
> - `electron/main/db/` (migration: add `live_readiness_acknowledged_at` to workspace prefs or sessions)
> - `src/components/sessions/` (live toggle blocked by readiness gate)

---

## Goal

Live order placement is impossible until the readiness gate explicitly passes. No configuration option or developer shortcut can bypass it. The gate is a hard checklist, not an advisory warning.

---

## 1. Readiness Check Items

```ts
export type ReadinessCheckId =
  | "phase3_policy_gate_active"
  | "phase4_capital_reservation_active"
  | "phase6_exit_policy_active"
  | "paper_scorecard_meets_promotion"
  | "human_approval_required_on_first_live_session"
  | "max_concurrent_trades_limited"
  | "max_position_usd_limited"
  | "emergency_stop_mode_configured"
  | "live_broker_credentials_configured"
  | "live_broker_connection_test_passed"
  | "user_acknowledged";

export interface ReadinessCheckResult {
  id: ReadinessCheckId;
  label: string;          // human-readable description shown in UI
  passed: boolean;
  detail?: string;        // why it failed; null if passed
}

export interface LiveReadinessReport {
  sessionId: string;
  generatedAt: string;    // ISO-8601
  overallPassed: boolean;
  checks: ReadinessCheckResult[];
  blockedBy: ReadinessCheckId[];  // checks that are not passed
}
```

---

## 2. Check Definitions

### `phase3_policy_gate_active`
- **Pass condition:** `OrderPolicyGate` class is importable and wired into `AgentOrchestrator.runTradeCycle()`. Verified at compile time (TypeScript import check) + a runtime feature flag if desired.
- **Fail detail:** `"OrderPolicyGate is not wired into the execution pipeline."`

### `phase4_capital_reservation_active`
- **Pass condition:** `CapitalReservationService.reserveForOrder` method exists and is called for no-approval sessions. Verified by checking `CapitalReservationService` has the method.
- **Fail detail:** `"Capital reservation does not cover no-approval order paths."`

### `phase6_exit_policy_active`
- **Pass condition:** `ExitPolicyEvaluator` is wired into `TradeMonitor.tick()`. Verified by checking `TradeMonitor` constructor accepts `ExitPolicyEvaluator` dep.
- **Fail detail:** `"Exit policy evaluator is not active in the trade monitor."`

### `paper_scorecard_meets_promotion`
- **Pass condition:** `PaperScorecardService.generate(sessionId)` → `meetsPromotionCriteria(scorecard, DEFAULT_THRESHOLDS).meets === true`
- **Fail detail:** Lists which criteria failed, e.g. `"minTradeCount: need 100, have 23"`.
- **Default thresholds:** `{ minTradeCount: 100, minExpectancy: 0, maxDrawdownPct: 0.20, requiredScenarioCoverage: all 10 MockScenarioKind values }`

### `human_approval_required_on_first_live_session`
- **Pass condition:** `session.riskConfig.humanApprovalRequired === true` for the target session.
- **Fail detail:** `"First live session must have humanApprovalRequired enabled."`

### `max_concurrent_trades_limited`
- **Pass condition:** `session.riskConfig.maxConcurrentTrades <= 1` for the first live session.
- **Fail detail:** `"First live session must limit max concurrent trades to 1."`

### `max_position_usd_limited`
- **Pass condition:** `session.riskConfig.maxPositionUsd <= 100` (conservative default for first live session; user can raise after first confirmed run).
- **Fail detail:** `"First live session maxPositionUsd should be ≤ $100."`

### `emergency_stop_mode_configured`
- **Pass condition:** Workspace prefs contain a configured `emergencyStopMode` value (one of the four stop modes from H8 spec).
- **Fail detail:** `"Configure emergency stop behavior before going live."`

### `live_broker_credentials_configured`
- **Pass condition:** At least one broker account has `executionMode = "live_allowed"` and credentials in keychain (`connectionTest` does not return auth error).
- **Fail detail:** `"No live broker account configured."`

### `live_broker_connection_test_passed`
- **Pass condition:** `adapter.testConnection()` returns `{ ok: true }` for the live broker.
- **Fail detail:** `"Live broker connection test failed: ${result.message}"`
- This check makes a live network call — run it only when explicitly requested (not on every `getLiveReadiness` call).

### `user_acknowledged`
- **Pass condition:** `session.liveReadinessAcknowledgedAt` is not null (persisted via `session:acknowledgeLiveReadiness`).
- **Fail detail:** `"Confirm you have reviewed the readiness report and accept the risks of live trading."`

---

## 3. `LiveReadinessService`

```ts
export class LiveReadinessService {
  constructor(
    private readonly scorecardService: PaperScorecardService,
    private readonly sessionRepo: SessionRepo,
    private readonly workspacePrefsRepo: WorkspacePreferencesRepo,
    private readonly brokerRegistry: BrokerRegistry,
  ) {}

  /**
   * Run all checks except the live broker connection test (which makes a network call).
   * Returns the full report synchronously from DB state.
   */
  check(sessionId: string): LiveReadinessReport;

  /**
   * Run the live broker connection test (network call).
   * Updates the cached test result but does not mutate DB state.
   */
  testLiveBrokerConnection(sessionId: string): Promise<ReadinessCheckResult>;

  /**
   * Mark the user as having acknowledged the readiness report.
   * Persists `live_readiness_acknowledged_at` to the session record.
   */
  acknowledge(sessionId: string): void;

  /**
   * Returns true only if ALL checks pass including user_acknowledged.
   * This is the hard gate: called before enabling the live toggle.
   */
  isReady(sessionId: string): boolean;
}
```

---

## 4. DB Schema Change

```sql
-- Migration: track readiness acknowledgement on session
ALTER TABLE sessions ADD COLUMN live_readiness_acknowledged_at TEXT;
-- ISO-8601 or NULL. Set by acknowledge(); cleared when session config changes materially.
```

The acknowledgement is cleared (set back to NULL) whenever the session's `riskConfig` or `executionMode` changes, because the user must re-acknowledge after any config change.

---

## 5. IPC Handlers

### `session:getLiveReadiness`

```ts
Request:  { sessionId: string }
Response: LiveReadinessReport
```

Calls `LiveReadinessService.check(sessionId)`. Does not run the broker connection test.

---

### `session:testLiveBrokerConnection`

```ts
Request:  { sessionId: string }
Response: ReadinessCheckResult
```

Calls `LiveReadinessService.testLiveBrokerConnection(sessionId)`.

---

### `session:acknowledgeLiveReadiness`

```ts
Request:  { sessionId: string }
Response: { ok: true } | { ok: false; reason: string }
```

Only succeeds if all non-acknowledgement checks pass first. Calls `LiveReadinessService.acknowledge(sessionId)`.

---

## 6. UI — Live Toggle Gate

In `SessionTable.tsx` (or wherever the `executionMode` is toggled from paper to live):

```tsx
// Replace unconditional live toggle with:
const startLive = async () => {
  const report = await ipc.invoke("session:getLiveReadiness", { sessionId: session.id });
  if (!report.overallPassed) {
    openReadinessModal(report);  // show checklist with failed items highlighted
    return;
  }
  onLifecycle(session, "start");
};
```

The readiness modal shows each `ReadinessCheckResult` as a checklist row:
- Passed: green checkmark
- Failed: red X with `detail` text

The "I accept the risks" confirmation button calls `session:acknowledgeLiveReadiness` and then starts the session.

---

## 7. First Live Session Constraints Summary

| Constraint | Value | Reason |
|-----------|-------|--------|
| `humanApprovalRequired` | `true` | Every order reviewed before placement |
| `maxConcurrentTrades` | `1` | Limit blast radius |
| `maxPositionUsd` | `≤ $100` | Conservative capital exposure |
| `executionMode` | `live_allowed` | Must be explicitly set |
| Broker | 1 account only | Limit routing complexity |
| Instrument class | 1 class only | Limit market-specific risk |

These constraints are enforced by the readiness checks, not hard-coded in the runtime. Once the user has completed a successful live session and wants to raise them, they update config and re-run the gate.

---

## 8. Acceptance Tests

```
describe("LiveReadinessService.check")
  ✓ all checks pass → overallPassed=true, blockedBy=[]
  ✓ paper_scorecard_meets_promotion fails → overallPassed=false, blockedBy includes it
  ✓ human_approval_required=false → overallPassed=false
  ✓ maxConcurrentTrades=3 → overallPassed=false
  ✓ user_acknowledged=null → overallPassed=false even if all other checks pass

describe("LiveReadinessService.acknowledge")
  ✓ called when all non-ack checks pass → sets live_readiness_acknowledged_at
  ✓ called when checks still failing → returns ok:false, acknowledgement not written

describe("live toggle UI gate")
  ✓ session:getLiveReadiness returns failing report → modal opens, session not started
  ✓ all checks pass + user confirms → session:acknowledgeLiveReadiness called then session starts
  ✓ config change after acknowledgement → live_readiness_acknowledged_at cleared, gate re-blocks
```
