# Phase 2 Spec — Session Card Progress UI

> **Status:** Not started — depends on Phase 1 (step events must exist)
> **Files to create:**
> - `src/components/sessions/SessionExecutionProgress.tsx`
> **Files to modify:**
> - `src/components/sessions/SessionTable.tsx` (insert progress strip)
> - `electron/main/services/infra/event-bus.ts` (add step events to `ExvaEventMap`)
> - `electron/shared/channels.ts` (add step channel names)
> - `electron/main/ipc/session.ts` (add `session:getExecutionProgress` handler)

---

## Goal

Every session card shows the live execution stage, active AI role, retry countdown, and last error — without opening DevPanel. Users must be able to see at a glance whether the session is working, stuck, or waiting.

---

## 1. EventBus — New Events

Add to `ExvaEventMap` in `electron/main/services/infra/event-bus.ts`:

```ts
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
  nextRetryAt: string | null;  // ISO-8601
};

"step:retrying": {
  sessionId: string;
  cycleId: string;
  stage: ExecutionStage;
  attempt: number;
  nextRetryAt: string;
};
```

Add the four channel names to `electron/shared/channels.ts` (wherever `ExvaEventName` union is defined).

---

## 2. IPC Handler — `session:getExecutionProgress`

In `electron/main/ipc/session.ts`:

```ts
handle("session:getExecutionProgress", ({ sessionId }: { sessionId: string }) => {
  const steps = deps.sessionExecutionStepsRepo.getLatestBySession(sessionId);
  const latestCycleId = steps.length > 0
    ? steps.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b).cycleId
    : null;
  return {
    cycleId: latestCycleId,
    steps: steps.map((s) => ({
      stage: s.stage,
      status: s.status,
      attempt: s.attempt,
      nextRetryAt: s.nextRetryAt,
      lastErrorCode: s.lastErrorCode,
      lastErrorMessage: s.lastErrorMessage,
      retryable: s.retryable,
    })),
  };
});
```

---

## 3. Stage Metadata

```ts
// src/components/sessions/SessionExecutionProgress.tsx

const STAGE_META: Record<ExecutionStage, { label: string; progressPct: number }> = {
  selector:             { label: "Finding instruments",  progressPct: 10 },
  candidate_validation: { label: "Validating candidates", progressPct: 20 },
  analyst_technical:    { label: "Technical analyst",    progressPct: 35 },
  analyst_fundamental:  { label: "Fundamental analyst",  progressPct: 50 },
  reviewer:             { label: "Reviewing thesis",     progressPct: 65 },
  decision_maker:       { label: "Making decision",      progressPct: 78 },
  risk_gate:            { label: "Risk checks",          progressPct: 88 },
  broker_order:         { label: "Broker execution",     progressPct: 96 },
  monitoring:           { label: "Monitoring position",  progressPct: 100 },
};
```

---

## 4. `SessionExecutionProgress` Component

```tsx
interface SessionExecutionProgressProps {
  sessionId: string;
  // Passed from the Sessions page store — pre-fetched or subscribed
  progress: SessionProgressState | null;
  onRetry: (sessionId: string, cycleId: string, stage: ExecutionStage) => void;
  onViewTrace: (sessionId: string, cycleId: string, stage: ExecutionStage) => void;
  onPauseAfterStep: (sessionId: string) => void;
}

interface SessionProgressState {
  cycleId: string;
  activeStage: ExecutionStage | null;
  activeStatus: ExecutionStepStatus | null;
  progressPct: number;          // 0–100
  stageLabel: string;
  activeRoleLabel: string | null;  // e.g. "technical analyst · claude-haiku-4-5"
  retryable: boolean;
  nextRetryAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  cycleIdShort: string;         // cycleId.slice(0, 8)
}
```

### Render rules

| Condition | What to show |
|-----------|-------------|
| `progress === null` | Render nothing (no active cycle) |
| `activeStatus === "running"` | Progress bar at `progressPct`, stage label, active role chip |
| `activeStatus === "retrying"` | Progress bar frozen, label = `"Retrying in Xs"` with live countdown from `nextRetryAt` |
| `activeStatus === "failed" && retryable` | Red stage label, Retry button, View Trace button |
| `activeStatus === "failed" && !retryable` | Orange stage label, View Trace button (no Retry) |
| `activeStatus === "succeeded" && stage === "monitoring"` | Progress bar at 100%, label = `"Monitoring position"` |

### Active role chip

The `activeRoleLabel` is derived from the step's stage + the session's configured AI role for that stage. Pull from session config passed to the progress component. Format: `"${role} · ${modelId}"`. Show only when `status === "running"`.

### Retry countdown

Use a `useEffect` interval that ticks every second and computes `Math.max(0, Math.ceil((new Date(nextRetryAt).getTime() - Date.now()) / 1000))`. Display as `"Retrying in 42s"`.

---

## 5. Visual Spec

The progress strip sits **between the top row and the meta strip** in `SessionTable.tsx`. Insert after the closing `</div>` of the top row grid.

```tsx
{/* Execution progress strip — only rendered when progress data exists */}
<SessionExecutionProgress
  sessionId={session.id}
  progress={progressBySessionId[session.id] ?? null}
  onRetry={onRetryStep}
  onViewTrace={onViewTrace}
  onPauseAfterStep={onPauseAfterStep}
/>
```

**Visual language rules:**
- Progress bar: thin (4px height), `rgba(96,165,250,0.6)` fill on dark track `rgba(255,255,255,0.06)` — matches the card's existing blue accent (`rgba(96,165,250,0.30)`)
- Stage label: `11px`, `color: var(--text3)`, uppercase, `letterSpacing: 0.08em`
- Active role chip: `10px`, `color: var(--text2)`, `background: rgba(255,255,255,0.05)`, `borderRadius: 4`, `padding: 2px 6px`
- Cycle ID short code: `10px`, `color: var(--text3)`, monospace, dim link style
- Retry button: small, `variant="outline"`, red-ish border `rgba(239,68,68,0.4)` — matches danger button aesthetic
- View Trace button: small, `variant="outline"`, neutral — same as existing action buttons
- Pause-after-step toggle: small checkbox or toggle, label `"Pause after step"`
- No bright colors, no animations beyond the progress bar fill transition

---

## 6. Sessions Page Store Changes

The Sessions page (wherever it manages session data) must:

1. On mount and on `"step:started"` / `"step:succeeded"` / `"step:failed"` / `"step:retrying"` events: call `session:getExecutionProgress` for the affected `sessionId` and update local state `progressBySessionId: Record<string, SessionProgressState>`.

2. Derive `SessionProgressState` from the raw `ExecutionStepState[]`:
   ```ts
   function deriveProgress(
     steps: ExecutionStepState[],
     cycleId: string,
     sessionAiRoles: SessionAiRole[]
   ): SessionProgressState
   ```
   - Find the step with the most recent `updatedAt` that is not `succeeded`
   - If all steps are `succeeded` and `monitoring` is included: activeStage = `"monitoring"`
   - progressPct = `STAGE_META[activeStage].progressPct`

3. `progressBySessionId` is keyed by `sessionId`. Only sessions that have received at least one step event (or have existing step rows on load) appear in this map.

---

## 7. New `SessionSummary` fields (optional but preferred)

If the Sessions page already fetches `SessionSummary` from IPC, add `currentStage` and `currentCycleId` to it so an initial render doesn't flash empty before the first `getExecutionProgress` call returns.

```ts
interface SessionSummary {
  // ... existing fields ...
  currentCycleId?: string | null;
  currentStage?: ExecutionStage | null;
  currentStageStatus?: ExecutionStepStatus | null;
}
```

Populate in the `session:list` or `session:get` IPC handler by calling `stepsRepo.getLatestBySession(sessionId)` and picking the active step.

---

## 8. Acceptance Tests

```
describe("SessionExecutionProgress")
  ✓ renders nothing when progress is null
  ✓ renders stage label "Finding instruments" when stage=selector, status=running
  ✓ renders "Retrying in 42s" label when status=retrying, nextRetryAt=now+42s
  ✓ countdown decrements each second via useEffect
  ✓ Retry button visible when retryable=true and status=failed
  ✓ Retry button absent when retryable=false
  ✓ View Trace button always visible on failed status
  ✓ progress bar width = progressPct % of container
  ✓ renders monitoring label at 100% when stage=monitoring + status=succeeded

describe("deriveProgress()")
  ✓ step with most recent updatedAt and status!=succeeded is active
  ✓ all steps succeeded → activeStage=monitoring
  ✓ empty steps array → returns null
```
