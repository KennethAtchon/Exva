# Broker-Centric Capital Refactor — Implementation Plan

> **Date:** 2026-05-16
> **Status:** Implemented (2026-05-16)
> **Deciders:** Ken
> **Implements:** `docs/design/broker-centric-capital-product-spec.md`, `docs/design/broker-centric-capital-design-spec.md`

> **Implementation Notes:**
> - Code path is now broker-centric end to end: schema, repos, services, orchestration, IPC/preload contracts, and session/editor surfaces.
> - Added custom Drizzle SQL migrations `0002_broker_capital_additive.sql` and `0003_broker_capital_cleanup.sql`. These were written manually because `drizzle-kit generate` prompted interactively on removed workspace capital columns.
> - Verification: `bun run typecheck` passes. `bun test` remains blocked in this environment by Bun incompatibilities with `better-sqlite3`, Playwright spec loading under Vitest, and Electron module-loading issues in non-Electron test runs.

---

## 1. Problem Statement

The current capital model is architecturally dishonest. `sessions.capital_limit_usd` is a number the user types; it has no relationship to what a broker account actually holds. The global shared pool (`workspace_preferences.capital_allocation_mode = 'shared_global_pool'`) is an opt-in second system that the default mode (`per_session_only`) skips entirely — meaning `CapitalReservationService.checkOrderFits()` is a no-op for most users. The orchestrator calls it at lines 394 and 421 in `agent-orchestrator.ts` but the call returns `{ ok: true }` unconditionally in `per_session_only` mode.

This means:

- Two sessions sharing a broker account have no mutual awareness of each other's capital consumption.
- Risk math runs against a fictional ceiling, not a real balance.
- Instrument conflicts are checked once at session start (preflight) and never again at order time, creating a real-time race window.
- The dashboard shows portfolio value sourced from `"session_capital_limit"` as a fallback — a lie the UI exposes.

The refactor replaces all of this with broker-account-scoped capital: real balances, per-session allocations at the join table, a two-layer gate before every order, and a new Brokers tab that makes the broker-account view first-class.

---

## 2. Goals & Non-Goals

**Goals**


| #   | Goal                                          | Success Looks Like                                                                                                                      |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Broker balance is source of truth             | `broker_accounts.balance_cache_usd` populated on session start and on a per-broker tick; dashboard reads from it                        |
| 2   | Per-session allocation enforced at order time | `BrokerAllocationGate.checkOrderFits()` called in orchestrator after layer-1 risk; orders blocked when allocation exhausted (hard mode) |
| 3   | Instrument conflict enforced at order time    | `BrokerAllocationGate.checkInstrumentConflict()` called in same path; always hard block                                                 |
| 4   | Old model deleted                             | Zero references to `capitalAllocationMode`, `globalCapitalPoolUsd`, `capitalLimitUsd` (session field) in code after Phase 6             |
| 5   | Brokers tab rendered                          | New renderer route with broker cards, balance, sessions, allocation bar                                                                 |
| 6   | Configurable per-broker settings              | `maxSessions`, `allocationEnforcement`, `balanceRefreshIntervalMin` editable in UI                                                      |


**Non-Goals**


| #   | Non-Goal                                        | Reason                                                                |
| --- | ----------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Cross-broker netting or portfolio analytics     | Out of scope; each broker is independent                              |
| 2   | Worker-thread balance fetching                  | I/O-only; main-process async is sufficient                            |
| 3   | Backwards compatibility with old capital fields | App is in development; clean deletion is correct                      |
| 4   | Live streaming balance via WebSocket            | Polling is sufficient; adapter interfaces don't standardize WebSocket |


---

## 3. Background & Context

### Current data flow (capital path)

```
SessionService.start()
  → runPreflight()
    → capitalPoolCheck()           ← no-op unless capitalAllocationMode = "shared_global_pool"
    → instrumentConflictCheck()    ← session-start only, not repeated at order time
  → AgentOrchestrator.start()
    → riskEngine.validateDecision()           ← layer 1: session config + stats
    → capitalReservation.checkOrderFits()     ← no-op in per_session_only mode
    → adapter.placeOrder()
```

The `capitalReservation.checkOrderFits()` call at orchestrator:394 reads `workspace.capitalAllocationMode` and returns `{ ok: true }` immediately if not `"shared_global_pool"`. This is the dead code we replace.

### Relevant files


| File                                                         | Current role                 | Changes                                                                      |
| ------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------- |
| `electron/main/db/schema.ts`                                 | Schema definitions           | Add/remove fields, two migrations                                            |
| `electron/main/services/risk/capital-reservation-service.ts` | Global pool logic            | Strip pool logic, keep in-flight tracking                                    |
| `electron/main/services/orchestration/agent-orchestrator.ts` | Order placement              | Replace `checkOrderFits` calls at lines 394, 421 with `BrokerAllocationGate` |
| `electron/main/services/session/session-types.ts`            | `OrchestratorDeps` interface | Add `brokerAllocationGate`, `brokerCapital`, `brokerBalanceCache`            |
| `electron/main/services/session/preflight/index.ts`          | Preflight runner             | Swap `capital-pool` step for `broker-allocation`                             |
| `electron/main/services/infra/event-bus.ts`                  | Pub/sub + IPC bridge         | Add `broker_balance_updated` event type                                      |
| `electron/shared/ipc/channels.ts`                            | Channel constants            | Add `brokerAccounts.*` namespace                                             |
| `electron/preload/exva-api.ts`                               | Renderer API surface         | Add `brokerAccounts.*` methods, update `SessionSummary`                      |
| `src/lib/types.ts`                                           | Shared types                 | Remove `capitalLimitUsd`, add `BrokerAccountWithState`                       |


---

## 4. Research Summary

**Electron main-to-renderer push updates**

`EventBus` in this codebase already implements the canonical pattern: `webContents.send(name, payload)` per attached window, plus in-process `on()/emit()` for main-process consumers. The renderer receives events via `ipcRenderer.on()` exposed through preload. This is exactly how balance updates should flow: `BrokerBalanceTicker` emits `broker_balance_updated` on `EventBus`; the Brokers tab subscribes via the existing `events.subscribe()` API. No new infrastructure needed.

Sources: [Electron IPC docs](https://www.electronjs.org/docs/latest/tutorial/ipc), [BigBinary sync store pattern](https://www.bigbinary.com/blog/sync-store-main-renderer-electron)

**Background scheduler: setInterval vs worker thread**

Balance fetching is async I/O (HTTP) — non-blocking and lightweight. Worker threads add process-spawning overhead and are justified for CPU-bound work (Bree's use case). A single `BrokerBalanceTicker` class using `setInterval` in the main process is the right call. The key design choice: one global 60-second tick that evaluates per-broker staleness, not one timer per broker. This avoids managing N timers when broker accounts change and handles the case where a broker's `balanceRefreshIntervalMin` is updated mid-session without requiring timer teardown.

Sources: [setInterval vs Cron in Node.js](https://www.sabbir.co/blogs/68e2852ae6f20e639fc2c9bc), [Node.js scheduler comparison](https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/)

**Gate / Policy pattern for multi-layer risk**

Chain of Responsibility (CoR) is the textbook pattern when handlers are interchangeable or dynamically composed. Here the two layers are fixed and semantically different (session-config vs broker-account), so full CoR adds indirection without benefit. The implementation uses direct sequential calls in the orchestrator — `riskEngine.validateDecision()` then `brokerAllocationGate.checkOrderFits()` then `brokerAllocationGate.checkInstrumentConflict()` — mirroring the existing pattern at lines 354 and 394. Each returns a typed result; the orchestrator acts on failures identically (reject trade, emit event).

Sources: [Chain of Responsibility in TypeScript](https://refactoring.guru/design-patterns/chain-of-responsibility/typescript/example), [Medium guide](https://medium.com/@robinviktorsson/a-guide-to-the-chain-of-responsibility-design-pattern-in-typescript-and-node-js-0c1560a532cd)

**Drizzle ORM migrations for SQLite**

SQLite does not support `DROP COLUMN` before version 3.35.0, and `ALTER TABLE ... MODIFY` doesn't exist. The safe approach for this codebase is two-migration sequencing: Migration A adds new columns with defaults (additive, always safe), Migration B drops old columns. Run Migration A with code that handles both old and new schema; deploy; then run Migration B once old field reads are removed. For this app (no production users yet), a single migration doing both is acceptable but more risky. The plan uses two migrations for correctness.

Sources: [Drizzle migrations docs](https://orm.drizzle.team/docs/migrations), [Zero-downtime schema changes](https://dev.to/whoffagents/drizzle-orm-migrations-in-production-zero-downtime-schema-changes-e71)

---

## 5. Options Considered

### Option A: Status Quo (do nothing)

Keep `capitalLimitUsd` and the global pool. Document that capital enforcement is "best effort."


| Dimension            | Assessment                                    |
| -------------------- | --------------------------------------------- |
| Complexity           | None                                          |
| Risk math accuracy   | Risk calculations remain fictional            |
| Conflict enforcement | Session-start only; race window at order time |
| Technical debt       | Grows; two capital models diverge further     |
| Reversibility        | Trivially reversible                          |


**Rejected** because the core invariant — "system knows how much capital a broker has" — is violated, and order-time conflict enforcement is absent.

---

### Option B: Broker balance as advisory display only (simpler change)

Fetch broker balance on-demand and display it on the UI, but keep `capitalLimitUsd` as the enforcement ceiling. Don't add `BrokerAllocationGate` to the order path.


| Dimension            | Assessment                                       |
| -------------------- | ------------------------------------------------ |
| Complexity           | Low; balance cache + one new IPC call            |
| Risk math accuracy   | Still fictional — display ≠ enforcement          |
| Conflict enforcement | Still session-start only                         |
| Technical debt       | Adds balance plumbing on top of the broken model |
| Reversibility        | Easy                                             |


**Rejected** because it adds UI complexity without fixing the fundamental problem. Two models (display vs enforcement) still diverge.

---

### Option C: Full broker-centric model (recommended)

Replace `capitalLimitUsd` with `session_broker_assignments.allocated_usd`. Add `BrokerBalanceCacheService`, `BrokerCapitalService`, `BrokerAllocationGate`. Wire layer 2 into orchestrator. New Brokers tab.


| Dimension            | Assessment                                         |
| -------------------- | -------------------------------------------------- |
| Complexity           | High; 6 phases, ~20 files touched                  |
| Risk math accuracy   | Real balance from adapter, enforced at order time  |
| Conflict enforcement | Real-time at order placement                       |
| Technical debt       | Eliminates both dead models                        |
| Reversibility        | Low — schema changes require migration to undo     |
| Stack fit            | Follows existing repo/service/IPC patterns exactly |
| Team readiness       | All patterns exist in codebase; no new libraries   |


**Risks:**

- Schema migration in SQLite for column removal requires multi-step; if rushed into one migration, data loss risk
- `allocatedUsd = 0` default after migration blocks all sessions until user configures allocations — needs UX mitigation (50% heuristic or prompt)
- Concurrent order race between two sessions on same broker is documented but not serialized (desktop app; acceptable)

---

## 6. Recommendation

**We recommend Option C: Full broker-centric model.**

Over Option A: the current system silently lies about capital. This will cause real problems as soon as multiple sessions share a broker.

Over Option B: advisory display is half-work that doesn't fix enforcement. Adds a second display path on top of the broken enforcement path, making the codebase harder to reason about.

The decisive reason: the orchestrator already calls `capitalReservation.checkOrderFits()` at exactly the right insertion points (lines 394 and 421). The new `BrokerAllocationGate` replaces those calls at the same sites with real logic. The EventBus pub/sub infrastructure already exists for pushing balance updates to the renderer. No new architectural dependencies are needed — only new service classes that follow the existing patterns.

**Key assumptions this depends on:**

- All broker adapters implement `getAccountBalance()` correctly (verified: it's in `BrokerAdapter` interface)
- `drizzle-kit generate` handles the column additions and removals in two passes
- The 50% heuristic for migration `allocated_usd` is acceptable as a starting point; users will adjust

**Conditions that would change this recommendation:**

- If a broker adapter's `getAccountBalance()` rate-limits aggressively (< 1 req/5 min), the balance cache refresh strategy needs adjustment
- If user testing shows the 50% default causes widespread preflight failures, we may need the explicit "set your allocations" onboarding prompt instead

---

## 7. Implementation Plan

### Phase 1: Schema — Additive Migration Only

**Goal:** Add all new columns to the database with safe defaults. No code behavior changes. System continues working exactly as before after this phase.

**Done criteria:** App starts, existing tests pass, new columns exist with correct defaults in SQLite. `grep -r "capitalLimitUsd\|capitalAllocationMode\|globalCapitalPoolUsd"` still has hits (removal is Phase 6).

**Files to touch:**

#### `electron/main/db/schema.ts`

Add to `brokerAccounts` table:

```ts
maxSessions: integer("max_sessions").notNull().default(10),
allocationEnforcement: text("allocation_enforcement").notNull().default("hard"),
balanceRefreshIntervalMin: integer("balance_refresh_interval_min").notNull().default(5),
balanceCacheUsd: real("balance_cache_usd"),
balanceCachedAt: text("balance_cached_at"),
```

Add to `sessionBrokerAssignments` table:

```ts
allocatedUsd: real("allocated_usd").notNull().default(0),
```

Add to `workspacePreferences` table:

```ts
allocationEnforcementOverride: text("allocation_enforcement_override"),
```

Do NOT remove `capitalLimitUsd`, `capitalAllocationMode`, or `globalCapitalPoolUsd` yet. They stay in schema until Phase 6.

#### Generate and run migration

```bash
bun run drizzle-kit generate
```

Review the generated SQL to confirm it only adds columns. Then:

```bash
bun run drizzle-kit migrate  # or however migrations run in this project
```

Check `electron/main/db/migrations.ts` to understand how migrations are applied at app startup — ensure the new migration is picked up.

#### `electron/main/db/repositories/broker-accounts-repo.ts`

Add methods:

```ts
updateBalanceCache(id: string, balanceCacheUsd: number, balanceCachedAt: string): void {
  this.client.db
    .update(brokerAccounts)
    .set({ balanceCacheUsd, balanceCachedAt })
    .where(eq(brokerAccounts.id, id))
    .run();
}

getBalanceCache(id: string): { balanceCacheUsd: number | null; balanceCachedAt: string | null } {
  const row = this.client.db
    .select({ balanceCacheUsd: brokerAccounts.balanceCacheUsd, balanceCachedAt: brokerAccounts.balanceCachedAt })
    .from(brokerAccounts)
    .where(eq(brokerAccounts.id, id))
    .get();
  return { balanceCacheUsd: row?.balanceCacheUsd ?? null, balanceCachedAt: row?.balanceCachedAt ?? null };
}

updateSettings(
  id: string,
  patch: { maxSessions?: number; allocationEnforcement?: "hard" | "warn"; balanceRefreshIntervalMin?: number }
): void {
  this.client.db
    .update(brokerAccounts)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(brokerAccounts.id, id))
    .run();
}
```

Update `list()` and `find()` to include the new fields in the return type. Update `toBrokerAccount` mapper in `mappers.ts` to include the new fields.

#### `electron/main/db/repositories/session-broker-assignments-repo.ts`

Add method:

```ts
listAssignments(sessionId: string): { brokerAccountId: string; allocatedUsd: number }[] {
  return this.client.db
    .select({
      brokerAccountId: sessionBrokerAssignments.brokerAccountId,
      allocatedUsd: sessionBrokerAssignments.allocatedUsd,
    })
    .from(sessionBrokerAssignments)
    .where(eq(sessionBrokerAssignments.sessionId, sessionId))
    .orderBy(asc(sessionBrokerAssignments.brokerAccountId))
    .all();
}

sumAllocatedUsdForBroker(brokerAccountId: string, activeSessionIds: string[]): number {
  if (activeSessionIds.length === 0) return 0;
  const row = this.client.db
    .select({ total: sql<number>`coalesce(sum(${sessionBrokerAssignments.allocatedUsd}), 0)` })
    .from(sessionBrokerAssignments)
    .where(
      and(
        eq(sessionBrokerAssignments.brokerAccountId, brokerAccountId),
        inArray(sessionBrokerAssignments.sessionId, activeSessionIds),
      )
    )
    .get();
  return Number(row?.total ?? 0);
}
```

Update `replaceAssignments` signature to accept `allocatedUsd` per entry:

```ts
replaceAssignments(sessionId: string, assignments: { brokerAccountId: string; allocatedUsd: number }[]): void {
  this.client.db.transaction((tx) => {
    tx.delete(sessionBrokerAssignments).where(eq(sessionBrokerAssignments.sessionId, sessionId)).run();
    for (const a of assignments) {
      tx.insert(sessionBrokerAssignments).values({ sessionId, brokerAccountId: a.brokerAccountId, allocatedUsd: a.allocatedUsd }).run();
    }
  });
}
```

**Migration seed script** (run once, inline with startup or as a separate bun script):

```ts
// scripts/seed-broker-allocations.ts
// For each existing session_broker_assignment:
//   1. Fetch broker balance (via adapter)
//   2. Set allocated_usd = floor(balance * 0.5)
// TODO: replace with dynamic proportional calculation based on active session consumption
async function seedAllocations(services: AppServices) {
  const allAssignments = services.repos.sessionBrokerAssignments.listAll(); // add listAll() to repo
  for (const assignment of allAssignments) {
    if (assignment.allocatedUsd > 0) continue; // already seeded
    try {
      const adapter = await services.brokerRegistry.get(assignment.brokerAccountId);
      const balance = await adapter.getAccountBalance();
      const allocated = Math.floor(balance * 0.5);
      services.repos.sessionBrokerAssignments.setAllocatedUsd(
        assignment.sessionId,
        assignment.brokerAccountId,
        allocated,
      );
      services.repos.brokerAccounts.updateBalanceCache(
        assignment.brokerAccountId,
        balance,
        new Date().toISOString(),
      );
    } catch {
      // log and leave at 0; user will see migration prompt
    }
  }
}
```

Wire `seedAllocations` to run after migrations in `electron/main/index.ts` (or wherever `createAppServices` is called) — guard with `allocatedUsd === 0` so it's idempotent.

**Rollback:** Migrations are not auto-reversible in SQLite. If Phase 1 causes issues, revert the schema.ts changes and create a compensating migration that drops the new columns. Since this is dev-only, a `scripts/db-reset.ts` wipe is acceptable.

---

### Phase 2: New Services

**Goal:** `BrokerBalanceCacheService`, `BrokerCapitalService`, `BrokerAllocationGate` all implemented and unit-tested. `CapitalReservationService` stripped of pool logic. Nothing is wired into the live call path yet.

**Done criteria:** All new service unit tests pass. `CapitalReservationService` no longer imports `WorkspacePreferencesRepo`.

#### `electron/main/services/broker/broker-balance-cache-service.ts`

```ts
export class BrokerBalanceCacheService {
  constructor(
    private readonly repo: BrokerAccountsRepo,
    private readonly registry: BrokerRegistry,
  ) {}

  /**
   * Returns cached balance if within the broker's refresh interval.
   * Fetches and stores if stale. Propagates adapter errors.
   */
  async getBalance(brokerAccountId: string): Promise<number> {
    const { balanceCacheUsd, balanceCachedAt } = this.repo.getBalanceCache(brokerAccountId);
    const account = this.repo.require(brokerAccountId);
    const staleLimitMs = account.balanceRefreshIntervalMin * 60 * 1000;
    const isStale =
      !balanceCacheUsd ||
      !balanceCachedAt ||
      Date.now() - Date.parse(balanceCachedAt) > staleLimitMs;

    if (!isStale) return balanceCacheUsd!;
    return this.refreshBalance(brokerAccountId);
  }

  /** Always fetches from adapter. Updates cache. Propagates adapter errors. */
  async refreshBalance(brokerAccountId: string): Promise<number> {
    const adapter = await this.registry.get(brokerAccountId);
    const balance = await adapter.getAccountBalance();
    this.repo.updateBalanceCache(brokerAccountId, balance, new Date().toISOString());
    return balance;
  }

  /** Refresh all given broker accounts in parallel. Collects errors without throwing. */
  async refreshAll(brokerAccountIds: string[]): Promise<{ id: string; balance?: number; error?: string }[]> {
    return Promise.all(
      brokerAccountIds.map(async (id) => {
        try {
          const balance = await this.refreshBalance(id);
          return { id, balance };
        } catch (e) {
          return { id, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  }
}
```

#### `electron/main/services/broker/broker-balance-ticker.ts`

```ts
/**
 * Single global tick (every 60s). For each broker account, checks if its
 * per-broker balanceRefreshIntervalMin has elapsed since last fetch.
 * If stale, refreshes. Emits broker_balance_updated on EventBus after each refresh.
 *
 * Design: one timer, per-broker staleness check — avoids N timers when broker
 * accounts are added/removed or their intervals change at runtime.
 */
export class BrokerBalanceTicker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repo: BrokerAccountsRepo,
    private readonly balanceCache: BrokerBalanceCacheService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly tickIntervalMs = 60_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const accounts = this.repo.list();
    for (const account of accounts) {
      const { balanceCachedAt } = this.repo.getBalanceCache(account.id);
      const staleLimitMs = account.balanceRefreshIntervalMin * 60 * 1000;
      const isStale = !balanceCachedAt || Date.now() - Date.parse(balanceCachedAt) > staleLimitMs;
      if (!isStale) continue;

      try {
        const balance = await this.balanceCache.refreshBalance(account.id);
        this.bus.emit("broker_balance_updated", { brokerAccountId: account.id, balanceUsd: balance, cachedAt: new Date().toISOString() });
      } catch (e) {
        this.logger.warn({ brokerAccountId: account.id, error: e instanceof Error ? e.message : String(e) }, "balance refresh failed in tick; retaining stale cache");
      }
    }
  }
}
```

Add `broker_balance_updated` to `ExvaEventMap` in both `electron/main/services/infra/event-bus.ts` and `electron/preload/exva-api.ts`:

```ts
// event-bus.ts ExvaEventMap
broker_balance_updated: { brokerAccountId: string; balanceUsd: number; cachedAt: string };

// channels.ts mainToRendererEvents
"broker_balance_updated",
```

#### `electron/main/services/broker/broker-capital-service.ts`

```ts
export interface BrokerAccountWithState {
  id: string;
  name: string;
  brokerType: string;
  mode: "paper" | "live";
  maxSessions: number;
  allocationEnforcement: "hard" | "warn";
  balanceRefreshIntervalMin: number;
  balanceCacheUsd: number | null;
  balanceCachedAt: string | null;
  isStale: boolean;
  sessions: { sessionId: string; sessionName: string; status: SessionStatus; allocatedUsd: number }[];
  activeSessionCount: number;
  totalAllocatedUsd: number;
  freeCapitalUsd: number | null;
  isOverAllocated: boolean;
  atSessionCap: boolean;
}

export interface AllocationCheckFailure {
  brokerAccountId: string;
  brokerName: string;
  reason: "over_allocated" | "session_cap_exceeded";
  detail: string;
}

export class BrokerCapitalService {
  constructor(
    private readonly brokerAccountsRepo: BrokerAccountsRepo,
    private readonly assignmentsRepo: SessionBrokerAssignmentsRepo,
    private readonly sessionRepo: SessionRepo,
  ) {}

  listWithState(): BrokerAccountWithState[] {
    const accounts = this.brokerAccountsRepo.list();
    const activeSessions = this.sessionRepo.listByStatuses(["active", "paused"]);
    const activeIds = new Set(activeSessions.map((s) => s.id));
    const sessionMap = new Map(activeSessions.map((s) => [s.id, s]));

    return accounts.map((account) => {
      const allAssignments = this.assignmentsRepo.listAssignmentsForBroker(account.id); // new repo method
      const activeSessions = allAssignments.filter((a) => activeIds.has(a.sessionId));
      const totalAllocatedUsd = activeSessions.reduce((sum, a) => sum + a.allocatedUsd, 0);
      const freeCapitalUsd = account.balanceCacheUsd != null ? account.balanceCacheUsd - totalAllocatedUsd : null;
      const staleLimitMs = account.balanceRefreshIntervalMin * 60 * 1000;
      const isStale =
        !account.balanceCachedAt ||
        Date.now() - Date.parse(account.balanceCachedAt) > staleLimitMs;

      return {
        ...account,
        isStale,
        sessions: activeSessions.map((a) => ({
          sessionId: a.sessionId,
          sessionName: sessionMap.get(a.sessionId)?.name ?? a.sessionId,
          status: sessionMap.get(a.sessionId)?.status ?? "draft",
          allocatedUsd: a.allocatedUsd,
        })),
        activeSessionCount: activeSessions.length,
        totalAllocatedUsd,
        freeCapitalUsd,
        isOverAllocated: freeCapitalUsd != null && freeCapitalUsd < 0,
        atSessionCap: activeSessions.length >= account.maxSessions,
      };
    });
  }

  /**
   * Check whether this session can start on all its assigned brokers.
   * Returns ok or a list of failures (one per failing broker).
   */
  checkSessionStartFits(sessionId: string): { ok: true } | { ok: false; failures: AllocationCheckFailure[] } {
    const assignments = this.assignmentsRepo.listAssignments(sessionId);
    const activeSessions = this.sessionRepo.listByStatuses(["active", "paused"]);
    const otherActiveIds = activeSessions.filter((s) => s.id !== sessionId).map((s) => s.id);

    const failures: AllocationCheckFailure[] = [];

    for (const assignment of assignments) {
      const account = this.brokerAccountsRepo.require(assignment.brokerAccountId);
      const currentCount = this.assignmentsRepo.countActiveSessionsForBroker(account.id, otherActiveIds); // new repo method
      if (currentCount >= account.maxSessions) {
        failures.push({
          brokerAccountId: account.id,
          brokerName: account.name,
          reason: "session_cap_exceeded",
          detail: `${account.name} already has ${currentCount} active sessions (cap: ${account.maxSessions}).`,
        });
        continue;
      }

      if (account.balanceCacheUsd != null) {
        const currentlyAllocated = this.assignmentsRepo.sumAllocatedUsdForBroker(account.id, otherActiveIds);
        const freeCapital = account.balanceCacheUsd - currentlyAllocated;
        if (assignment.allocatedUsd > freeCapital) {
          failures.push({
            brokerAccountId: account.id,
            brokerName: account.name,
            reason: "over_allocated",
            detail: `${account.name} has $${freeCapital.toFixed(2)} free but session requests $${assignment.allocatedUsd.toFixed(2)}.`,
          });
        }
      }
    }

    return failures.length === 0 ? { ok: true } : { ok: false, failures };
  }

  updateSettings(
    brokerAccountId: string,
    patch: { maxSessions?: number; allocationEnforcement?: "hard" | "warn"; balanceRefreshIntervalMin?: number },
  ): void {
    if (patch.maxSessions !== undefined) {
      if (patch.maxSessions < 1 || patch.maxSessions > 50) {
        throw new AppError("maxSessions must be between 1 and 50", "VALIDATION_FAILED");
      }
      const activeSessions = this.sessionRepo.listByStatuses(["active", "paused"]);
      const activeIds = activeSessions.map((s) => s.id);
      const currentCount = this.assignmentsRepo.countActiveSessionsForBroker(brokerAccountId, activeIds);
      if (patch.maxSessions < currentCount) {
        throw new AppError(
          `Cannot reduce cap to ${patch.maxSessions}; broker has ${currentCount} active sessions.`,
          "VALIDATION_FAILED",
        );
      }
    }
    if (patch.balanceRefreshIntervalMin !== undefined) {
      if (patch.balanceRefreshIntervalMin < 1 || patch.balanceRefreshIntervalMin > 60) {
        throw new AppError("balanceRefreshIntervalMin must be between 1 and 60", "VALIDATION_FAILED");
      }
    }
    this.brokerAccountsRepo.updateSettings(brokerAccountId, patch);
  }
}
```

You'll need two new repo methods on `SessionBrokerAssignmentsRepo`:

```ts
listAssignmentsForBroker(brokerAccountId: string): { sessionId: string; allocatedUsd: number }[]
countActiveSessionsForBroker(brokerAccountId: string, activeSessionIds: string[]): number
```

#### `electron/main/services/risk/broker-allocation-gate.ts`

```ts
export type AllocationGateResult =
  | { ok: true; warning?: "over_allocated" }
  | { ok: false; reason: string; code: "BROKER_ALLOCATION_EXHAUSTED" | "INSTRUMENT_CONFLICT" };

export class BrokerAllocationGate {
  constructor(
    private readonly assignmentsRepo: SessionBrokerAssignmentsRepo,
    private readonly tradesRepo: TradesRepo,
    private readonly workspacePrefsRepo: WorkspacePreferencesRepo,
    private readonly brokerAccountsRepo: BrokerAccountsRepo,
  ) {}

  /**
   * Layer 2 capital check. Resolves effective enforcement:
   * workspace.allocationEnforcementOverride takes precedence over broker-level setting.
   */
  checkOrderFits(brokerAccountId: string, sessionId: string, sizeUsd: number): AllocationGateResult {
    const assignment = this.assignmentsRepo.findAssignment(sessionId, brokerAccountId); // new repo method
    if (!assignment) return { ok: true }; // no assignment found → no constraint

    const openPositionSizeUsd = this.tradesRepo.sumOpenPositionSizeUsd(sessionId, brokerAccountId); // new/existing repo method
    const freeAllocation = assignment.allocatedUsd - openPositionSizeUsd;

    if (sizeUsd <= freeAllocation) return { ok: true };

    const enforcement = this.resolveEnforcement(brokerAccountId);
    if (enforcement === "warn") {
      return { ok: true, warning: "over_allocated" };
    }
    return {
      ok: false,
      reason: `Broker allocation exhausted: $${freeAllocation.toFixed(2)} free, order requires $${sizeUsd.toFixed(2)}.`,
      code: "BROKER_ALLOCATION_EXHAUSTED",
    };
  }

  /**
   * Instrument conflict check. Always hard block regardless of allocationEnforcement.
   */
  checkInstrumentConflict(brokerAccountId: string, symbol: string, sessionId: string): AllocationGateResult {
    const conflict = this.tradesRepo.findOpenTradeOnBroker(brokerAccountId, symbol, sessionId); // exclude this session
    if (!conflict) return { ok: true };
    return {
      ok: false,
      reason: `${symbol} is already held on this broker by another session.`,
      code: "INSTRUMENT_CONFLICT",
    };
  }

  private resolveEnforcement(brokerAccountId: string): "hard" | "warn" {
    const prefs = this.workspacePrefsRepo.get();
    if (prefs.allocationEnforcementOverride) return prefs.allocationEnforcementOverride as "hard" | "warn";
    const account = this.brokerAccountsRepo.find(brokerAccountId);
    return (account?.allocationEnforcement as "hard" | "warn") ?? "hard";
  }
}
```

You need a new `TradesRepo` method:

```ts
findOpenTradeOnBroker(brokerAccountId: string, instrumentSymbol: string, excludeSessionId: string): Trade | null
// SELECT * FROM trades WHERE broker_account_id = ? AND instrument_symbol = ? AND status = 'open' AND session_id != ? LIMIT 1
```

And:

```ts
sumOpenPositionSizeUsd(sessionId: string, brokerAccountId: string): number
// SELECT coalesce(sum(position_size_usd), 0) FROM trades WHERE session_id = ? AND broker_account_id = ? AND status = 'open'
```

#### Simplify `CapitalReservationService`

Remove `checkSessionStartFits`, `checkOrderFits`, and the `WorkspacePreferencesRepo` constructor dependency:

```ts
// REMOVE these methods:
// checkSessionStartFits(sessionId, capitalLimitUsd)
// checkOrderFits(amountUsd)

// KEEP: reserveForOrder, reserveForApproval, releaseByApproval,
//       convertApprovalToOpenOrder, convertOrderToPosition,
//       releaseOnCancel, releaseOnFailure, releaseOnClose,
//       sumActiveReservedUsd, listActiveBySession,
//       updateReservedAmountForApproval
```

Update constructor:

```ts
constructor(private readonly repo: CapitalReservationsRepo) {}
// remove: private readonly workspacePreferencesRepo: WorkspacePreferencesRepo
```

Update `createAppServices`:

```ts
const capitalReservation = new CapitalReservationService(repos.capitalReservations);
// Remove the second arg
```

**Rollback:** Services are not yet wired into any call path. Reverting means deleting the new files and restoring `CapitalReservationService` to its current form.

---

### Phase 3: Preflight + Orchestration Wiring

**Goal:** New preflight step replaces `capital-pool-check`. `BrokerAllocationGate` is called in orchestrator at the two existing `capitalReservation.checkOrderFits()` call sites. Session start and order placement now enforce broker-account-level capital.

**Done criteria:** Starting a session with `allocatedUsd > brokerBalance` fails preflight. Placing an order that exceeds allocation emits `BROKER_ALLOCATION_EXHAUSTED`. Placing an order when another session holds the same symbol emits `INSTRUMENT_CONFLICT`.

#### `electron/main/services/session/preflight/broker-allocation-check.ts` (new)

```ts
export async function brokerAllocationCheck(session: WorkspaceSession, deps: OrchestratorDeps): Promise<StepResult> {
  // 1. Refresh all broker balances (surfaces adapter errors as preflight failures)
  const assignmentIds = deps.sessionBrokerAssignmentsRepo.listBrokerAccountIds(session.id);
  if (assignmentIds.length === 0) {
    return { ok: false, code: "VALIDATION_FAILED", message: "No broker accounts assigned. Add at least one to start." };
  }

  const refreshResults = await deps.brokerBalanceCache.refreshAll(assignmentIds);
  for (const r of refreshResults) {
    if (r.error) {
      return {
        ok: false,
        code: "BROKER_UNREACHABLE",
        message: `Could not fetch balance for broker ${r.id}: ${r.error}`,
        details: { brokerAccountId: r.id },
      };
    }
  }

  // 2. Capital allocation check
  const capitalCheck = deps.brokerCapital.checkSessionStartFits(session.id);
  if (!capitalCheck.ok) {
    const first = capitalCheck.failures[0]!;
    return {
      ok: false,
      code: first.reason === "session_cap_exceeded" ? "BROKER_SESSION_CAP_EXCEEDED" : "BROKER_ALLOCATION_EXCEEDED",
      message: first.detail,
      details: { failures: capitalCheck.failures },
    };
  }

  return { ok: true };
}
```

#### `electron/main/services/session/preflight/index.ts`

Replace `capital-pool` with `broker-allocation`:

```ts
import { brokerAllocationCheck } from "./broker-allocation-check";
// remove: import { capitalPoolCheck } from "./capital-pool-check";

const steps = [
  { check: "task-boundary",        run: () => taskBoundaryCheck(session, deps) },
  { check: "provider-credentials", run: () => providerCredentialsCheck(session, deps) },
  { check: "broker-reachability",  run: () => brokerReachabilityCheck(session, deps) },
  { check: "broker-allocation",    run: () => brokerAllocationCheck(session, deps) },  // NEW
  { check: "selector-config",      run: () => selectorConfigCheck(session, deps) },
  { check: "instrument-conflict",  run: () => instrumentConflictCheck(session, deps) },
];
```

Delete `electron/main/services/session/preflight/capital-pool-check.ts`.

#### `electron/main/services/session/session-types.ts` — update `OrchestratorDeps`

```ts
import type { BrokerAllocationGate } from "../risk/broker-allocation-gate";
import type { BrokerCapitalService } from "../broker/broker-capital-service";
import type { BrokerBalanceCacheService } from "../broker/broker-balance-cache-service";

export interface OrchestratorDeps {
  // ... existing fields ...
  brokerAllocationGate: BrokerAllocationGate;   // ADD
  brokerCapital: BrokerCapitalService;           // ADD
  brokerBalanceCache: BrokerBalanceCacheService; // ADD
}
```

#### `electron/main/services/orchestration/agent-orchestrator.ts`

Replace the `capitalReservation.checkOrderFits()` calls at lines ~394 and ~421.

**At line ~388-439** (the block guarded by `useSharedPool`), remove the entire `useSharedPool` block and replace with:

```ts
// REMOVE: lines 388-438 (the workspace.capitalAllocationMode block)

// AFTER risk_gate passes and context.riskOrder is set, BEFORE waitForApproval:
const brokerAccountId = await this.deps.brokerRouting
  .resolveBrokerAccountId(this.sessionId, context.instrument.instrumentClass);

const allocationResult = this.deps.brokerAllocationGate.checkOrderFits(
  brokerAccountId,
  this.sessionId,
  context.riskOrder.sizeUsd,
);
if (!allocationResult.ok) {
  this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
  this.emitEvent("WARN", trade.id, allocationResult.reason, "orchestrator", context.cycleId);
  this.deps.bus.emit("trade_closed", this.deps.tradesRepo.require(trade.id));
  return;
}
if (allocationResult.warning === "over_allocated") {
  this.emitEvent("WARN", trade.id, "Order exceeds allocation (warn-only mode); proceeding.", "orchestrator", context.cycleId);
}

const conflictResult = this.deps.brokerAllocationGate.checkInstrumentConflict(
  brokerAccountId,
  context.instrument.symbol,
  this.sessionId,
);
if (!conflictResult.ok) {
  this.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
  this.emitEvent("WARN", trade.id, conflictResult.reason, "orchestrator", context.cycleId);
  this.deps.bus.emit("trade_closed", this.deps.tradesRepo.require(trade.id));
  return;
}
```

This block goes at the same execution point as the old `useSharedPool` check — after `risk_gate` step, before approval/order placement.

#### `electron/main/services/app-services.ts`

Instantiate and wire new services:

```ts
import { BrokerBalanceCacheService } from "./broker/broker-balance-cache-service";
import { BrokerBalanceTicker } from "./broker/broker-balance-ticker";
import { BrokerCapitalService } from "./broker/broker-capital-service";
import { BrokerAllocationGate } from "./risk/broker-allocation-gate";

const brokerBalanceCache = new BrokerBalanceCacheService(repos.brokerAccounts, brokerRegistry);
const brokerCapital = new BrokerCapitalService(repos.brokerAccounts, repos.sessionBrokerAssignments, repos.session);
const brokerAllocationGate = new BrokerAllocationGate(
  repos.sessionBrokerAssignments,
  repos.trades,
  repos.workspacePreferences,
  repos.brokerAccounts,
);
const balanceTicker = new BrokerBalanceTicker(repos.brokerAccounts, brokerBalanceCache, eventBus, logger);
balanceTicker.start(); // starts background tick loop

// Update capitalReservation construction:
const capitalReservation = new CapitalReservationService(repos.capitalReservations); // drop workspacePreferences arg

// Add to orchestratorDepsBase:
const orchestratorDepsBase: OrchestratorDeps = {
  ...existing,
  brokerAllocationGate,
  brokerCapital,
  brokerBalanceCache,
};
```

Also add to `AppServices` interface:

```ts
brokerCapital: BrokerCapitalService;
brokerBalanceCache: BrokerBalanceCacheService;
brokerAllocationGate: BrokerAllocationGate;
balanceTicker: BrokerBalanceTicker;
```

**Rollback:** Remove new service instantiations from `app-services.ts`. Restore `CapitalReservationService` constructor call. Restore `preflight/index.ts` to `capital-pool` step. Revert `agent-orchestrator.ts` changes (git checkout the file).

---

### Phase 4: IPC + Preload

**Goal:** New `brokerAccounts.`* IPC channels exposed to renderer. `SessionSummary` updated. Workspace IPC updated. Existing `accounts.listBrokers` is augmented or superseded.

**Done criteria:** Renderer can call `window.exva.brokerAccounts.list()` and receive `BrokerAccountWithState[]`. `window.exva.brokerAccounts.refreshBalance(id)` triggers a live fetch. `broker_balance_updated` events arrive in renderer.

#### `electron/shared/ipc/channels.ts`

```ts
export const channels = {
  // ... existing ...
  brokerAccounts: {
    list:           "broker-accounts:list",
    refreshBalance: "broker-accounts:refresh-balance",
    updateSettings: "broker-accounts:update-settings",
  },
} as const;

// Add to mainToRendererEvents:
export const mainToRendererEvents = [
  // ... existing ...
  "broker_balance_updated",
] as const;
```

#### `electron/main/ipc/broker-accounts.ts` (new file)

```ts
import { ipcMain } from "electron";
import { z } from "zod";
import { channels } from "@electron/shared/ipc/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

const updateSettingsSchema = z.object({
  brokerAccountId: z.string(),
  maxSessions: z.number().int().min(1).max(50).optional(),
  allocationEnforcement: z.enum(["hard", "warn"]).optional(),
  balanceRefreshIntervalMin: z.number().int().min(1).max(60).optional(),
});

export function registerBrokerAccountHandlers(services: AppServices): void {
  handle(ipcMain, channels.brokerAccounts.list, async () => {
    return services.brokerCapital.listWithState();
  });

  handle(ipcMain, channels.brokerAccounts.refreshBalance, async (payload) => {
    const { brokerAccountId } = z.object({ brokerAccountId: z.string() }).parse(payload);
    const balance = await services.brokerBalanceCache.refreshBalance(brokerAccountId);
    services.eventBus.emit("broker_balance_updated", {
      brokerAccountId,
      balanceUsd: balance,
      cachedAt: new Date().toISOString(),
    });
    return { balanceUsd: balance, cachedAt: new Date().toISOString() };
  });

  handle(ipcMain, channels.brokerAccounts.updateSettings, async (payload) => {
    const { brokerAccountId, ...patch } = updateSettingsSchema.parse(payload);
    services.brokerCapital.updateSettings(brokerAccountId, patch);
    return { ok: true };
  });
}
```

#### `electron/main/ipc/register.ts`

```ts
import { registerBrokerAccountHandlers } from "./broker-accounts";
// add to registerAll:
registerBrokerAccountHandlers(services);
```

#### `electron/preload/exva-api.ts`

Add to `ExvaApi`:

```ts
brokerAccounts: {
  list(): Promise<BrokerAccountWithState[]>;
  refreshBalance(brokerAccountId: string): Promise<{ balanceUsd: number; cachedAt: string }>;
  updateSettings(input: {
    brokerAccountId: string;
    maxSessions?: number;
    allocationEnforcement?: "hard" | "warn";
    balanceRefreshIntervalMin?: number;
  }): Promise<{ ok: true }>;
};
```

Add `broker_balance_updated` to `ExvaEventMap`:

```ts
broker_balance_updated: { brokerAccountId: string; balanceUsd: number; cachedAt: string };
```

Update `SessionSummary` — remove `capitalLimitUsd`, add `totalAllocatedUsd`:

```ts
export interface SessionSummary {
  // ...
  // REMOVE: capitalLimitUsd: number;
  totalAllocatedUsd: number;   // ADD: computed from broker assignments
  brokerCount: number;
  // ...
}
```

Update `SessionCreateInput` — remove `capitalLimitUsd`, change `brokerAccountIds` to `brokerAssignments`:

```ts
export interface SessionCreateInput {
  // ...
  // REMOVE: capitalLimitUsd: number;
  // REMOVE: brokerAccountIds: string[];
  brokerAssignments: { brokerAccountId: string; allocatedUsd: number }[];
  // ...
}
```

Update workspace `patchPreferences` — add `allocationEnforcementOverride`:

```ts
// WorkspacePreferences type in src/lib/types.ts:
// REMOVE: capitalAllocationMode, globalCapitalPoolUsd
// ADD: allocationEnforcementOverride: "hard" | "warn" | null
```

Update workspace IPC handler in `electron/main/ipc/workspace.ts` to pass `allocationEnforcementOverride` through and strip old capital fields from the patch.

**Rollback:** Remove `registerBrokerAccountHandlers` from register.ts. Remove the new `ExvaApi` surface additions. These don't break anything if called — the handlers just won't exist.

---

### Phase 5: Renderer

**Goal:** Brokers tab rendered with live data. Session broker panel shows per-broker allocation inputs. Dashboard uses broker-sourced balance. Workspace settings removes capital pool UI.

**Done criteria:** Brokers tab navigable, shows broker cards with real balances and session lists. Session creation/edit uses `brokerAssignments` with `allocatedUsd`. Dashboard shows `"broker"` source only.

#### New: `src/pages/brokers/` (or `src/components/brokers/`)

Structure:

```
src/pages/brokers/
  BrokersPage.tsx          — route component, fetches list, subscribes to broker_balance_updated
  BrokerCard.tsx           — single broker card with sessions, allocation bar, settings panel
  BrokerSettingsPanel.tsx  — inline expand: maxSessions, allocationEnforcement, refreshInterval
  AllocationBar.tsx        — visual bar: allocated / balance
```

`BrokersPage.tsx` pattern:

```tsx
function BrokersPage() {
  const [brokers, setBrokers] = useState<BrokerAccountWithState[]>([]);

  useEffect(() => {
    // initial load
    window.exva.brokerAccounts.list().then(setBrokers);

    // subscribe to balance updates — push from main process
    const unsub = window.exva.events.subscribe("broker_balance_updated", ({ brokerAccountId, balanceUsd, cachedAt }) => {
      setBrokers((prev) =>
        prev.map((b) =>
          b.id === brokerAccountId
            ? { ...b, balanceCacheUsd: balanceUsd, balanceCachedAt: cachedAt, isStale: false }
            : b,
        ),
      );
    });

    // poll every 30s as fallback (broker list membership can change)
    const interval = setInterval(() => window.exva.brokerAccounts.list().then(setBrokers), 30_000);

    return () => { unsub(); clearInterval(interval); };
  }, []);

  return <div>{brokers.map((b) => <BrokerCard key={b.id} broker={b} />)}</div>;
}
```

`BrokerCard.tsx` — renders balance, sessions (each with a `→ jump` link), allocation bar, "Shared" badge if `sessions.length > 1`, gear icon to expand `BrokerSettingsPanel`.

Jump-to-session: `navigate(\`/sessions/${session.sessionId})` (or however the existing router navigates to a session).

#### Modified: Session broker panel

Find the existing component that renders broker assignments and `capitalLimitUsd` input. Replace the single `capitalLimitUsd` input with a per-broker row:

```tsx
{assignments.map((a) => (
  <div key={a.brokerAccountId}>
    <span>{brokerName(a.brokerAccountId)}</span>
    <input
      type="number"
      value={a.allocatedUsd}
      onChange={(e) => updateAllocation(a.brokerAccountId, Number(e.target.value))}
    />
    <span>Free: {formatUsd(freeCapitalFor(a.brokerAccountId))}</span>
  </div>
))}
<div>Total: {formatUsd(totalAllocated)}</div>
```

Update `SessionCreateInput` calls to use `brokerAssignments: [{ brokerAccountId, allocatedUsd }]`.

#### Modified: Dashboard

In `src/store/sessionStore.ts` and dashboard components:

- Remove any rendering of `capitalLimitUsd` from portfolio display
- Remove `"session_capital_limit"` source handling — only `"broker"` source is valid
- Portfolio value label: "Broker Balance" or "Total Allocated"

#### Modified: Workspace settings

Remove capital allocation mode selector and global pool input from whatever settings UI currently renders `WorkspacePreferences.capitalAllocationMode`. Add `allocationEnforcementOverride` toggle (None / Hard / Warn).

**Rollback:** Renderer-only changes. Reverting the route and component changes has no backend impact.

---

### Phase 6: Cleanup Migration + Dead Code Deletion

**Goal:** Remove all deleted-concept code and the old schema columns. Zero remaining references to `capitalAllocationMode`, `globalCapitalPoolUsd`, `capitalLimitUsd` (session field).

**Done criteria:**

```bash
grep -r "capitalAllocationMode\|globalCapitalPoolUsd\|capitalLimitUsd\|shared_global_pool\|per_session_only" \
  --include="*.ts" --include="*.tsx" electron/ src/
# → zero hits
```

**Steps:**

1. Generate the removal migration in `schema.ts`:
  - Remove `capitalLimitUsd` from `sessions` table definition
  - Remove `capitalAllocationMode`, `globalCapitalPoolUsd` from `workspacePreferences` table definition
  - Run `drizzle-kit generate` — confirm generated SQL contains `DROP COLUMN` statements
  - Run migration
2. Delete `electron/main/services/session/preflight/capital-pool-check.ts`
3. Remove dead imports:
  - `WorkspacePreferencesRepo` from `CapitalReservationService` constructor (already done in Phase 2, verify)
  - Any remaining `capitalAllocationMode` checks in `agent-orchestrator.ts` (the `useSharedPool` variable and its block, already removed in Phase 3, verify)
4. Update `src/lib/types.ts`:
  - Remove `capitalLimitUsd` from `WorkspaceSession` / session types
  - Remove `capitalAllocationMode`, `globalCapitalPoolUsd` from `WorkspacePreferences`
  - Add `allocationEnforcementOverride: "hard" | "warn" | null` to `WorkspacePreferences`
5. Update `WorkspacePreferencesRepo.get()` and `update()` — remove old fields, add new field.
6. Update any remaining type usages in `exva-api.ts` preload types.
7. Run `tsc --noEmit` — zero errors is the bar.
8. Run the full test suite.

**Rollback:** This phase removes schema columns — not reversible without a compensating migration. Take a DB snapshot (`cp userData/app.db app.db.backup`) before running. For dev this is a non-issue.

---

## 8. Risk Register


| #   | Risk                                                                    | Likelihood | Impact                                                   | Mitigation                                                                                                                                     |
| --- | ----------------------------------------------------------------------- | ---------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SQLite `DROP COLUMN` fails on older SQLite bundled with Electron        | Medium     | Build break                                              | Check `better-sqlite3` version in package.json; `DROP COLUMN` requires SQLite 3.35+. If not supported, use create-copy-drop migration pattern. |
| 2   | `allocatedUsd = 0` after migration blocks all sessions                  | High       | All session starts fail preflight                        | Run seed script in Phase 1 (50% heuristic). Add UI banner if allocation is 0.                                                                  |
| 3   | Concurrent orders from two sessions race past `checkInstrumentConflict` | Low        | Duplicate open position on same broker                   | Accepted risk; broker will reject the second order. Both events logged. Document in code.                                                      |
| 4   | `getAccountBalance()` rate-limited by broker                            | Low        | Balance cache stays stale; preflight may fail on refresh | `refreshAll` in preflight propagates errors; user sees actionable message. Background ticker logs and skips without interrupting session.      |
| 5   | `OrchestratorDeps` interface growing too wide                           | Medium     | Maintenance cost                                         | Consider grouping new deps into `BrokerCapitalDeps` sub-object if it gets unwieldy, but only if the interface exceeds ~20 fields.              |
| 6   | Session broker panel UX is confusing with per-broker allocation inputs  | Medium     | User sets wrong allocations                              | Add inline validation: red if `allocatedUsd > freeCapital`; show current broker balance as helper text.                                        |


---

## 9. Success Criteria


| Goal                | Metric                                                       | Baseline           | Target                       | How Measured                                               |
| ------------------- | ------------------------------------------------------------ | ------------------ | ---------------------------- | ---------------------------------------------------------- |
| Capital truth       | Session start with `allocatedUsd > balance` fails preflight  | Not measured       | 100% of cases                | Manual QA + integration test                               |
| Order-time conflict | Two sessions blocked from opening same symbol on same broker | 0% (not enforced)  | 100%                         | Integration test: two sessions, shared broker, same symbol |
| Layer 2 fires       | Orders blocked by `BrokerAllocationGate` emit event          | 0 (no gate exists) | Event emitted on every block | Unit test                                                  |
| Dead code removed   | `grep` for old capital fields returns 0 hits                 | Many hits          | 0                            | Shell script in CI                                         |
| TypeScript clean    | `tsc --noEmit` clean after Phase 6                           | Currently clean    | Stays clean                  | CI                                                         |


**Leading indicators:**

- Phase 1 migration runs without error on first boot
- New service unit tests pass (no integration dependencies)
- `BrokerAllocationGate` tests cover hard/warn/conflict cases

**Lagging indicators:**

- Brokers tab renders with real balances after session start
- Preflight correctly blocks sessions with 0 allocation after migration without seed

---

## 10. Open Questions


| #   | Question                                                                                              | Owner | Needed By     | Status                                                              |
| --- | ----------------------------------------------------------------------------------------------------- | ----- | ------------- | ------------------------------------------------------------------- |
| 1   | Does better-sqlite3 in this project support `DROP COLUMN` (SQLite 3.35+)?                             | Ken   | Phase 6 start | Open — check `package.json` + `node_modules/better-sqlite3` version |
| 2   | Should the seed script run automatically on app startup or as an explicit `bun run seed:allocations`? | Ken   | Phase 1       | Open — automatic is smoother for dev, but opt-in is safer           |
| 3   | Where does the Brokers tab sit in the nav? After Sessions? As a sub-tab under Accounts?               | Ken   | Phase 5 start | Open — needs UX decision                                            |


---

## 11. Alternatives Rejected


| Option                                   | Why Rejected                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Status quo                               | Capital enforcement is a no-op in default mode; instrument conflicts not enforced at order time                       |
| Advisory display only (Option B)         | Doesn't fix enforcement; adds a parallel display path on top of broken logic                                          |
| Per-broker `setInterval` timers          | N timers to manage when broker count changes; single tick with per-broker staleness check is simpler                  |
| Chain of Responsibility for risk layers  | Two fixed layers don't benefit from CoR's dynamic handler composition; direct sequential calls match existing pattern |
| Worker thread for balance fetching       | Balance fetch is async I/O; worker threads are for CPU-bound work                                                     |
| Single combined migration (adds + drops) | Higher risk in SQLite; two-migration sequencing is safer and allows rollback between                                  |


---

*Sources consulted:*

- [Electron IPC docs](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [BigBinary: Sync store between main and renderer](https://www.bigbinary.com/blog/sync-store-main-renderer-electron)
- [setInterval vs Cron in Node.js](https://www.sabbir.co/blogs/68e2852ae6f20e639fc2c9bc)
- [Best Node.js schedulers](https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/)
- [Chain of Responsibility in TypeScript — Refactoring Guru](https://refactoring.guru/design-patterns/chain-of-responsibility/typescript/example)
- [Drizzle ORM migrations](https://orm.drizzle.team/docs/migrations)
- [Drizzle zero-downtime schema changes](https://dev.to/whoffagents/drizzle-orm-migrations-in-production-zero-downtime-schema-changes-e71)
