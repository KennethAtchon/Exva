# Phase 2 — Signal Infrastructure

> **Date:** 2026-05-28
> **Status:** Todo
> **Spec sections:** §3 (ISignalSource, SignalBus, EdgarSignalSource, WebSearchSignalSource), §7 (IPC channels), §7.1 (EventBus events)
> **Depends on:** Phase 0 (DB tables), Phase 1 (ProcessingMode type)
> **Unlocks:** Phase 3 (Orchestrator integration), Phase 5 (Sources UI)

---

## 1. Problem Statement

There is no concept of a pluggable signal source in the codebase. The pipeline currently discovers instruments inside the selector phase via web-search and trending-symbol workers. This phase extracts instrument discovery entirely: a new `ISignalSource` interface, a `SignalBus` that coordinates source lifecycle and event fan-out, and the first two concrete source implementations (EDGAR 8-K and WebSearch wrapper). The repos, IPC handlers, and EventBus events for signal sources are also wired here.

---

## 2. Goals

| #   | Goal                                                | Done When                                                                                                                     |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ISignalSource` interface defined                   | Contract for `start()`, `stop()`, `test()`, `status`, `onSignal` exists                                                       |
| 2   | `SignalBus` class implemented                       | Sources register with bus; bus fans signal events out to interested sessions                                                  |
| 3   | `SignalSourceRegistry` tracks live source instances | Start/stop/restart lifecycle managed centrally                                                                                |
| 4   | `EdgarSignalSource` implemented                     | Polls EDGAR 8-K Atom feed, resolves CIK→ticker, deduplicates, emits signal events                                             |
| 5   | `WebSearchSignalSource` implemented                 | Wraps existing selector web-scout + trend-scout as a no-op signal source (backward compat shim)                               |
| 6   | CIK→ticker cache implemented                        | `cik_ticker_cache` table or reuse of `session_instrument_cache`; lookups via `https://data.sec.gov/submissions/CIK{cik}.json` |
| 7   | `SignalSourcesRepo` implemented                     | CRUD for `signal_sources` table                                                                                               |
| 8   | `SignalEventsRepo` implemented                      | Write signal_events; read by source/status                                                                                    |
| 9   | `SignalDeliveriesRepo` implemented                  | Write/update `session_signal_deliveries`; query per session                                                                   |
| 10  | IPC channels wired                                  | All 7 channels in `signals.*` namespace registered and handled                                                                |
| 11  | EventBus events added                               | `signal_received` and `signal_delivery_updated` in `ExvaEventMap`                                                             |
| 12  | IPC channels forwarded to renderer                  | Both events in `mainToRendererEvents`                                                                                         |

---

## 3. New Files & Locations

Confirm exact directory conventions by checking where existing services live (e.g., `electron/main/services/`).

```
electron/main/services/signals/
  ISignalSource.ts          — interface + SignalEvent type
  SignalBus.ts              — fan-out coordinator
  SignalSourceRegistry.ts   — lifecycle manager (start/stop/restart per source)
  sources/
    EdgarSignalSource.ts    — EDGAR 8-K Atom feed poller
    WebSearchSignalSource.ts — wrapper around existing web-scout workers
  cache/
    CikTickerCache.ts       — CIK→ticker resolution with SQLite cache
  repos/
    SignalSourcesRepo.ts
    SignalEventsRepo.ts
    SignalDeliveriesRepo.ts
```

---

## 4. `ISignalSource` Interface

```typescript
export interface SignalEvent {
  id: string; // crypto.randomUUID()
  sourceId: string;
  sourceType: "edgar_8k" | "web_search" | "manual";
  ticker: string;
  companyName: string | null;
  documentUrl: string | null;
  accessionNumber: string | null;
  payloadJson: Record<string, unknown>;
  filedAt: string; // ISO
  detectedAt: string; // ISO
}

export interface ISignalSource {
  readonly id: string;
  readonly type: string;
  readonly status: "running" | "idle" | "paused" | "restarting" | "error";
  readonly lastError: string | null;

  start(): Promise<void>;
  stop(): Promise<void>;
  restart(newConfig: Record<string, unknown>): Promise<void>;
  test(): Promise<PollResult>; // one immediate poll cycle
  onSignal(handler: (event: SignalEvent) => void): void;
  offSignal(handler: (event: SignalEvent) => void): void;
}

export interface PollResult {
  detected: number;
  passed: number;
  dropped: number;
  errors: string[];
}
```

---

## 5. `EdgarSignalSource` Implementation

**Feed URL:** `https://efts.sec.gov/LATEST/search-index?q=%228-K%22&dateRange=custom&startdt={today}&forms=8-K&hits.hits.total.value=1` — No, use the Atom feed: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=40&search_text=&output=atom`

**CIK→ticker resolution:**

1. Extract CIK from the feed entry's company link.
2. Look up `cik_ticker_cache` table first.
3. On miss: `GET https://data.sec.gov/submissions/CIK{paddedCIK}.json` → extract `tickers[0]`.
4. Cache result (even empty = no ticker) with a TTL.

**Deduplication:** Before emitting, check `signal_events` for existing row with same `source_id` + `accession_number`. If found, drop silently.

**Whitelist filter:** If `config.cikWhitelist` is non-empty, drop filings whose CIK is not in the list.

**Min filing age:** If `config.minFilingAgeMinutes > 0`, drop filings filed less than that many minutes ago.

**Poll scheduling:** Use `setInterval` (or a similar scheduler). Market hours = 9:30–16:00 ET on weekdays. Use `pollIntervalMarketMinutes` during market hours, `pollIntervalOffHoursMinutes` otherwise. Detect market hours from UTC offset (ET = UTC-4 or UTC-5 depending on DST).

**Error handling:** On HTTP error, set `status = "error"`, set `lastError`, do not crash. Retry on next scheduled poll.

---

## 6. `WebSearchSignalSource` Implementation

This is a backward-compatibility wrapper. It does not poll a feed. Instead, it registers as a signal source type so existing web-search-driven sessions can subscribe to it as a source rather than embedding discovery in the selector phase.

For Phase 2, this can be a stub that:

- Has `type = "web_search"`
- Starts and stops without error
- Never emits signals (the pipeline still handles web-search discovery internally via existing selector workers for now)
- The real integration with the selector phase is handled in Phase 3/4

---

## 7. `SignalBus`

Responsibilities:

1. Receive `SignalEvent` from any registered source.
2. Persist the event to `signal_events` via `SignalEventsRepo`.
3. Fan out: find all sessions subscribed to the source via `session_signal_sources` where the source is enabled.
4. For each interested session: create a `session_signal_delivery` row.
5. Emit `signal_received` on the EventBus.
6. Update `signal_event.dispatch_status` to `fanned_out` (or `dropped_pre_fanout` if no sessions found).

```typescript
class SignalBus {
  register(source: ISignalSource): void;
  unregister(sourceId: string): void;
  private handleSignal(event: SignalEvent): Promise<void>;
}
```

---

## 8. IPC Channels

File: `electron/shared/ipc/channels.ts` — add:

```typescript
signals: {
  sources: {
    list:    "signals:sources:list",
    create:  "signals:sources:create",
    update:  "signals:sources:update",
    delete:  "signals:sources:delete",
    enable:  "signals:sources:enable",
    disable: "signals:sources:disable",
  },
  events: {
    list: "signals:events:list",
  },
}
```

IPC handler file: create `electron/main/ipc/signals-handler.ts` (or equivalent naming convention).

Handler responsibilities:

| Channel                   | Action                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `signals:sources:list`    | Query `SignalSourcesRepo`, join with `SignalSourceRegistry` for live status, return full `SignalSourceRecord[]`    |
| `signals:sources:create`  | Validate type + config, insert via `SignalSourcesRepo`, create source instance in `SignalSourceRegistry`, start it |
| `signals:sources:update`  | Update DB; if runtime-affecting fields changed: `registry.restart(id, newConfig)`                                  |
| `signals:sources:delete`  | Check `attachedSessionCount > 0` → return `SOURCE_IN_USE` error; else stop + delete                                |
| `signals:sources:enable`  | `registry.start(id)` + update `enabled = true` in DB                                                               |
| `signals:sources:disable` | `registry.stop(id)` + update `enabled = false` in DB                                                               |
| `signals:events:list`     | Query `SignalDeliveriesRepo` by sessionId with filters; join `signal_events` + `signal_sources` for display fields |

---

## 9. EventBus Events

File: `electron/main/services/infra/event-bus.ts` — add to `ExvaEventMap`:

```typescript
signal_received: {
  signalId: string;
  sourceId: string;
  sourceType: string;
  ticker: string;
  companyName: string | null;
  detectedAt: string;
}

signal_delivery_updated: {
  deliveryId: string;
  sessionId: string;
  signalId: string;
  status: "queued" |
    "waiting_for_resume" |
    "processing" |
    "triggered" |
    "traded" |
    "rejected" |
    "dropped" |
    "expired";
  statusBucket: "pending" | "completed" | "dropped";
}
```

File: `electron/shared/ipc/channels.ts` — add both to `mainToRendererEvents`.

---

## 10. CIK→Ticker Cache

**Open question from spec §11:** Reuse `session_instrument_cache` or create `cik_ticker_cache`.

**Decision for this phase:** Create a dedicated `cik_ticker_cache` table (add to migration `0003_signal_sources.sql` or a separate `0004_cik_cache.sql`):

```sql
CREATE TABLE cik_ticker_cache (
  cik        TEXT PRIMARY KEY,
  ticker     TEXT,            -- NULL means "looked up, no ticker found"
  looked_up_at TEXT NOT NULL
);
```

TTL: 7 days. On hit where `looked_up_at` is older than 7 days, re-fetch.

---

## 11. Checklist

- [ ] `ISignalSource` interface + `SignalEvent` type defined
- [ ] `EdgarSignalSource` polls EDGAR feed, resolves CIK, deduplicates by accession_number
- [ ] `EdgarSignalSource.test()` triggers one immediate poll
- [ ] `WebSearchSignalSource` stub compiles and registers without error
- [ ] `CikTickerCache` reads/writes `cik_ticker_cache` table
- [ ] `SignalBus` fans events out and creates delivery rows
- [ ] `SignalSourceRegistry` start/stop/restart lifecycle works
- [ ] All 7 IPC channels registered and handled
- [ ] `signal_received` + `signal_delivery_updated` in EventBus + forwarded to renderer
- [ ] `SignalSourcesRepo` CRUD tested against DB
- [ ] `SignalEventsRepo` insert + dedup query tested
- [ ] `SignalDeliveriesRepo` insert + status-update + session query tested
- [ ] `tsc --noEmit` passes
