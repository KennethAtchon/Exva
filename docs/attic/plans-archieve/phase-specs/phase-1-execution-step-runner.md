# Phase 1 Spec — Failure-Isolated Execution Step Runner

> **Status:** Implemented with deviations
> **Files to create:**
>
> - `electron/main/services/orchestration/execution-step-runner.ts`
> - `electron/main/db/repositories/session-execution-steps-repo.ts`
>   **Files to modify:**
> - `electron/main/services/orchestration/agent-orchestrator.ts`
> - `electron/main/ipc/` (wherever IPC handlers are registered)
> - `electron/main/db/migrations.ts`
>
> **Implementation notes:**
>
> - This repo uses a single `electron/main/db/migrations.ts` bootstrap file rather than per-migration files, so the schema landed there instead of a new `electron/main/db/migrations/XXXX_add_session_execution_steps.ts` file.
> - The persisted step runner is wired for selector, analyst, reviewer, decision, risk-gate, and broker-order stages. Selector candidate validation remains folded into selector resolution in this pass, and monitoring remains enforced as an always-on `TradeMonitor` lifecycle invariant rather than a persisted execution-step row.

---

## Goal

Every named execution stage must be a durable, retryable unit. A failing selector or broker call must mark only that stage failed, keep the session runtime alive, and allow the user (or the backoff scheduler) to retry it — without restarting the app or losing open-trade monitoring.

This change to the schema should be one direction, no backwards compatibility like fixing existing tables. This is because we will be running db:reset, so all tables will be dropped anyways. Everything will work as expected, no need for writing for backwards compatibility.

---

## 1. Database Schema

### New table: `session_execution_steps`

```sql
CREATE TABLE session_execution_steps (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  cycle_id      TEXT NOT NULL,
  stage         TEXT NOT NULL,      -- ExecutionStage enum value
  status        TEXT NOT NULL,      -- ExecutionStepStatus enum value
  attempt       INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT,               -- ISO-8601 or NULL
  completed_at  TEXT,               -- ISO-8601 or NULL
  next_retry_at TEXT,               -- ISO-8601 or NULL; set when status = 'retrying'
  last_error_code    TEXT,
  last_error_message TEXT,
  retryable     INTEGER NOT NULL DEFAULT 0,  -- 0 | 1 (SQLite boolean)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_ses_steps_session_cycle
  ON session_execution_steps(session_id, cycle_id);

CREATE INDEX idx_ses_steps_session_status
  ON session_execution_steps(session_id, status);
```

**Constraint:** `(session_id, cycle_id, stage)` should be treated as a logical unique key. The repo `upsert` method must update-or-insert on this triple, not insert duplicates.

---

## 2. TypeScript Types

```ts
// electron/main/services/orchestration/execution-step-runner.ts

export type ExecutionStage =
  | "selector"
  | "candidate_validation"
  | "analyst_technical"
  | "analyst_fundamental"
  | "reviewer"
  | "decision_maker"
  | "risk_gate"
  | "broker_order"
  | "monitoring";

export type ExecutionStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "skipped";

export interface ExecutionStepState {
  id: string;
  sessionId: string;
  cycleId: string;
  stage: ExecutionStage;
  status: ExecutionStepStatus;
  attempt: number;
  startedAt: string | null;
  completedAt: string | null;
  nextRetryAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

## 3. Repo Interface

```ts
// electron/main/db/repositories/session-execution-steps-repo.ts

export interface SessionExecutionStepsRepo {
  /**
   * Insert or update the step row for (sessionId, cycleId, stage).
   * Uses the logical unique key — never creates a second row for the same triple.
   */
  upsert(
    step: Omit<ExecutionStepState, "id" | "createdAt" | "updatedAt">,
  ): ExecutionStepState;

  /** Returns the latest step state for each stage in the given cycle. */
  getLatestByCycle(sessionId: string, cycleId: string): ExecutionStepState[];

  /**
   * Returns the most recent step row per stage across all cycles for this session.
   * Used by the UI to show the current state of each session card without knowing cycleId.
   */
  getLatestBySession(sessionId: string): ExecutionStepState[];

  /** Hard-deletes the failed row so the cycle can be retried from scratch. */
  clearFailed(sessionId: string, cycleId: string, stage: ExecutionStage): void;
}
```

---

## 4. `ExecutionStepRunner` Class Interface

```ts
export interface StepRunnerDeps {
  stepsRepo: SessionExecutionStepsRepo;
  bus: EventBus;
  logger: Logger;
}

export class ExecutionStepRunner {
  constructor(
    private readonly sessionId: string,
    private readonly cycleId: string,
    private readonly deps: StepRunnerDeps,
  ) {}

  /**
   * Runs `fn` as a named stage.
   *
   * - Writes `running` before calling `fn`.
   * - Writes `succeeded` on resolution.
   * - On rejection: classifies error, writes `failed` or `retrying`,
   *   schedules backoff if retryable, emits the appropriate bus event.
   * - NEVER rethrows. The caller gets back a StepResult.
   */
  async run<T>(
    stage: ExecutionStage,
    fn: () => Promise<T>,
    opts?: { skipIfPreviouslySucceeded?: boolean },
  ): Promise<StepResult<T>>;
}

export type StepResult<T> =
  | { ok: true; value: T }
  | { ok: false; retryable: boolean; errorCode: string; errorMessage: string };
```

### Error classification rules

| Error type                                     | `retryable` | `status` written |
| ---------------------------------------------- | ----------- | ---------------- |
| Provider API timeout / 5xx / rate-limit        | `true`      | `retrying`       |
| Broker API timeout / 5xx                       | `true`      | `retrying`       |
| Search provider error                          | `true`      | `retrying`       |
| `AppError` with code `VALIDATION_FAILED`       | `false`     | `failed`         |
| `AppError` with code `PROVIDER_NOT_CONFIGURED` | `false`     | `failed`         |
| `AppError` with code `LOCKED`                  | `false`     | `failed`         |
| Risk gate denial                               | `false`     | `failed`         |
| Policy gate denial                             | `false`     | `failed`         |
| Unknown / unclassified `Error`                 | `false`     | `failed`         |

Classification is done by inspecting `error instanceof AppError && error.code` first, then checking HTTP status codes on provider/broker errors if available.

### Retry backoff schedule

```
attempt 1 → wait 30s  → nextRetryAt = now + 30_000
attempt 2 → wait 90s  → nextRetryAt = now + 90_000
attempt 3 → wait 270s → nextRetryAt = now + 270_000
attempt 4 → no retry  → status = 'failed', retryable = false
```

Jitter: add `Math.random() * 5_000` ms to each interval to prevent thundering herd across sessions.

---

## 5. Bus Events Emitted

```ts
// additions to EventBus event map

"step:started": {
  sessionId: string;
  cycleId: string;
  stage: ExecutionStage;
  attempt: number;
};

"step:succeeded": {
  sessionId: string;
  cycleId: string;
  stage: ExecutionStage;
};

"step:failed": {
  sessionId: string;
  cycleId: string;
  stage: ExecutionStage;
  retryable: boolean;
  errorCode: string;
  errorMessage: string;
  nextRetryAt: string | null;
};

"step:retrying": {
  sessionId: string;
  cycleId: string;
  stage: ExecutionStage;
  attempt: number;
  nextRetryAt: string;
};
```

---

## 6. `AgentOrchestrator` Integration Points

### `start()` — selector stage

**Current** (lines 85–92):

```ts
try {
  instruments = await this.runResearchBurst(session, config);
} catch (error) {
  // ... emitEvent + throw
  throw error instanceof AppError
    ? error
    : new AppError(message, "VALIDATION_FAILED");
}
```

**Target:**

```ts
const selectorResult = await this.stepRunner.run("selector", () =>
  this.runResearchBurst(session, config),
);
if (!selectorResult.ok) {
  // stepRunner already wrote DB state + emitted event
  // session runtime stays alive; return without throwing
  return;
}
instruments = selectorResult.value;
```

The `throw` at line 91 must be removed. `SessionRuntimeManager` must not see a thrown error from `start()` for transient failures.

### `enqueueTradeCycles()` — per-instrument stages

Each of `runAiPipeline`, `RiskEngine.validateDecision`, `placeRoutedOrder` must be wrapped in `stepRunner.run(stage, fn)`. On `!result.ok`, log and skip to the next instrument — do not `throw`.

### `TradeMonitor` — independence guarantee

`TradeMonitor.start()` is called before the selector stage runs. It must remain running regardless of any step failure in the research/decision path. Its `stop()` is only called by `AgentOrchestrator.stop()`.

---

## 7. IPC Action Contracts

### `session:getExecutionProgress`

```ts
// Request
{
  sessionId: string;
}

// Response
{
  steps: Array<{
    stage: ExecutionStage;
    status: ExecutionStepStatus;
    attempt: number;
    nextRetryAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    retryable: boolean;
  }>;
  cycleId: string | null; // null if no cycle has started yet
}
```

Implementation: calls `stepsRepo.getLatestBySession(sessionId)`, picks the most recent `cycleId` from the result.

---

### `session:retryStep`

```ts
// Request
{ sessionId: string; cycleId: string; stage: ExecutionStage }

// Response
{ ok: true } | { ok: false; reason: string }
```

Allowed only when:

- Session status is `active` or `attention_required`
- The step's current status is `failed` or `retrying`
- Stage is not `risk_gate` or `broker_order` unless status is `failed` (not mid-flight)

Implementation: clears the step row via `stepsRepo.clearFailed`, then re-enqueues the stage in the orchestrator's p-queue.

---

### `session:pauseAfterCurrentStep`

```ts
// Request
{
  sessionId: string;
}

// Response
{
  ok: true;
}
```

Sets an internal `pauseAfterStep: boolean` flag on `AgentOrchestrator`. After the current `run()` call in the step runner returns (success or failure), the orchestrator pauses instead of proceeding to the next stage or restarting the cycle. The flag is cleared when the session is manually resumed.

---

### `session:clearFailedStep`

```ts
// Request
{ sessionId: string; cycleId: string; stage: ExecutionStage }

// Response
{ ok: true } | { ok: false; reason: string }
```

Hard-deletes the failed step row. Does not re-enqueue anything. Used to dismiss a stuck/stale failure without retrying.

---

## 8. Session Status: `attention_required`

Add `"attention_required"` to the `SessionStatus` union in `src/lib/types.ts` (or `electron/shared/domain.ts` — wherever `SessionStatus` is defined).

A session enters `attention_required` when a non-retryable step failure occurs on a stage that is not `risk_gate` or `broker_order`. The session is not stopped — it still accepts IPC actions and the `TradeMonitor` continues running. The status is cleared back to `active` when the user retries and the step succeeds.

For `risk_gate` and `broker_order` non-retryable failures: keep status `active` but mark the individual cycle step as `failed`. The session moves on to the next instrument or next cycle.

---

## 9. Invariants the Implementation Must Preserve

1. `TradeMonitor` is never stopped by a step runner failure. Only `AgentOrchestrator.stop()` stops it.
2. A `failed` step with `retryable: false` never triggers an automatic retry. Only explicit user action (`session:retryStep`) can re-run it.
3. `risk_gate` and `broker_order` steps can never be skipped by the user — only retried or left as failed.
4. Retry count is bounded at 3 attempts per step per cycle. After attempt 3, `retryable` is set to `false` in the DB row even if the error type would normally be retryable.
5. The p-queue concurrency setting (`config.max_concurrent_trades`) is never changed by the step runner.

---

## 10. Acceptance Tests

```
describe("ExecutionStepRunner")
  ✓ wraps fn, writes running→succeeded, emits step:started + step:succeeded
  ✓ provider error → status=retrying, nextRetryAt set, retryable=true
  ✓ VALIDATION_FAILED AppError → status=failed, retryable=false, no retry scheduled
  ✓ 3 consecutive retryable failures → status=failed, retryable=false after attempt 3
  ✓ skipIfPreviouslySucceeded=true skips fn if DB row is 'succeeded'

describe("AgentOrchestrator with step runner")
  ✓ selector provider error → start() returns without throwing, session stays alive
  ✓ TradeMonitor continues ticking after selector failure
  ✓ session:retryStep re-runs selector and succeeds on second attempt
  ✓ session:pauseAfterCurrentStep pauses after current stage completes
  ✓ non-retryable decision failure for instrument A does not block instrument B in same cycle
```
