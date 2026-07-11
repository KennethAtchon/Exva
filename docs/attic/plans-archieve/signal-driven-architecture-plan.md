# Signal-Driven Architecture — Implementation Plan

> **Date:** 2026-05-27
> **Status:** Draft
> **Deciders:** Kenneth Atchon
> **Related:** `docs/plans/information-arbitrage-pivot-plan.md`

---

## 1. Problem Statement

The current architecture bakes _discovery logic_ into pipeline phases. The selector owns `get_trending_symbols`, `search_web`, and `fetch_url` to find candidates. The fundamental phase owns `search_web` for context. The orchestrator owns the trigger schedule.

This means every new discovery strategy requires:

- New workers in selector/fundamental phases
- New prompts
- New mode branching in `*WorkersForMode` functions
- Changes to the orchestrator trigger logic

The pivot plan (`information-arbitrage-pivot-plan.md`) patches this by swapping workers for a `catalyst_scan` mode. That gets EDGAR in, but the next signal type (economic calendar, options flow, momentum screen, insider trades) requires the same loop: add workers, add prompts, add mode branches.

**The pipeline should not own discovery.** It should consume signals from independent, pluggable sources.

---

## 2. Target State

```
┌──────────────────────────────────────────────────┐
│                  Signal Sources                    │
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  EDGAR   │  │ Earnings │  │Momentum  │  ...    │
│  │  8-K RSS │  │Calendar  │  │ Scanner  │        │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘        │
│        │              │              │             │
│        └──────┬───────┴──────┬──────┘             │
│               │              │                     │
│               ▼              ▼                     │
│        ┌──────────────────────────┐               │
│        │      Signal Bus          │               │
│        │  (per-session queue)     │               │
│        │                          │               │
│        │  signals[]:              │               │
│        │    { ticker, source,     │               │
│        │      timestamp, url,     │               │
│        │      payload }           │               │
│        └────────────┬─────────────┘               │
└─────────────────────┼─────────────────────────────┘
                      │
                      ▼
              Orchestrator
                      │
                      ▼
               Pipeline (processor only)
          ┌─────────────────────────┐
          │ No discovery workers    │
          │ No search_web           │
          │ No get_trending_symbols │
          │                         │
          │ Verification            │
          │ Document extraction     │
          │ Staleness gate          │
          │ Risk gate               │
          │ Decision                │
          └─────────────────────────┘
```

The pipeline no longer _looks_ for things. It _receives_ things and decides whether to trade them.

---

## 3. Architecture

### 3.1 SignalSource Interface

A signal source is anything that produces potential trade signals. It runs independently, owns its lifecycle, and knows nothing about the pipeline.

```typescript
// electron/shared/domain/signal-source.ts

export type SignalSourceType =
  | "edgar_8k"
  | "earnings_calendar"
  | "economic_calendar"
  | "momentum_scanner"
  | "options_flow"
  | "insider_trades"
  | "webhook"
  | "custom";

export type SignalSourceStatus = "idle" | "running" | "paused" | "error";

export interface SignalSourceConfig {
  id: string;
  type: SignalSourceType;
  name: string;
  description: string;
  enabled: boolean;
  sessionIds: string[]; // empty = global (all sessions)
  config: Record<string, unknown>;
}

export interface SignalEvent {
  id: string;
  sourceId: string;
  sourceType: SignalSourceType;
  ticker: string;
  companyName?: string;
  timestamp: string;
  documentUrl?: string;
  payload: Record<string, unknown>;
}

export interface ISignalSource {
  readonly id: string;
  readonly type: SignalSourceType;
  getConfig(): SignalSourceConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): SignalSourceStatus;
  getLastError(): string | null;
  onSignal(handler: (event: SignalEvent) => void): void;
}
```

### 3.2 SignalBus

A lightweight per-session queue. The orchestrator subscribes and processes one signal at a time.

```typescript
// electron/main/services/signal-bus.ts

export class SignalBus {
  private handlers: Map<string, (event: SignalEvent) => void> = new Map();

  subscribe(sessionId: string, handler: (event: SignalEvent) => void): void;
  unsubscribe(sessionId: string): void;
  emit(event: SignalEvent): void; // routes to matching session handlers
}
```

Routing logic:

- If a signal source is scoped to specific sessions, emit only to those
- If global, emit to all active sessions whose instrument classes include the signal's ticker class
- If no sessions care about it, the signal is dropped silently

### 3.3 Signal Sources (Built-in Catalog)

**Phase 1 sources (implement first):**

| Source            | Provider              | Key Required    | Implementation                       |
| ----------------- | --------------------- | --------------- | ------------------------------------ |
| EDGAR 8-K         | sec.gov RSS           | No              | Poll Atom feed, parse, dedup, emit   |
| Earnings Calendar | Alpha Vantage / FMP   | Yes (free tier) | Poll dates, emit day before + day of |
| Economic Calendar | Federal Reserve / BLS | No              | Scrape or RSS for CPI/NFP/FOMC dates |

**Phase 2 sources (after UI lands):**

| Source           | Provider              | Key Required | Notes                                           |
| ---------------- | --------------------- | ------------ | ----------------------------------------------- |
| Momentum Scanner | Local (OHLCV)         | No           | Built-in scanner: volume spike + price breakout |
| Options Flow     | MarketBeat / Barchart | Yes          | Unusual options activity                        |
| Insider Trades   | SEC Form 4 RSS        | No           | Same EDGAR pipeline, different form type        |
| Webhook          | HTTP endpoint         | User-defined | External services POST signals to localhost     |

### 3.4 Pipeline Becomes a Pure Processor

The pipeline phases lose all discovery workers:

**Selector phase:** Removed entirely from the active path. The signal source has already identified the instrument.

**Fundamental phase:**

- `document-extractor` — fetch the signal's document URL, extract structured signal
- `market-reaction-checker` — has the market already moved since the signal timestamp?

**Technical phase:**

- `volume-profile` — liquidity check for position sizing
- `price-reaction-checker` — staleness gate

**Review phase:** Unchanged — evaluates probability, risk/reward, timing

**Decision phase:** Unchanged — makes the trade decision

### 3.5 Pipeline Modes Update

Rename `discoveryMode` → `processingMode`. It no longer controls _how to discover_ — it controls _how to analyze_:

| Mode       | Trigger                           | Analysis Workers                                                                    |
| ---------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `catalyst` | Signal source (EDGAR/Calendar)    | document-extractor, market-reaction-checker, price-reaction-checker, volume-profile |
| `contract` | Signal source (prediction market) | event-context, implied-probability, event-liquidity                                 |
| `manual`   | User directly entered tickers     | Same as catalyst but skip document-extractor (no document URL)                      |

The mode is inferred from the signal source type, not configured in the session. A session just subscribes to signal sources; the pipeline picks the right analysis path based on what arrives.

---

## 4. Signal Sources UI (New Tab)

### 4.1 Placement

Add a **"Signal Sources"** tab to the session creation/edit modal (alongside Execution, Strategy, etc.) and a top-level nav item under Settings.

### 4.2 What It Shows

```
┌──────────────────────────────────────────────────┐
│  Signal Sources                         [+ Add]  │
├──────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────┐ │
│ │ EDGAR 8-K                   ● Running        │ │
│ │ Polls SEC EDGAR for 8-K filings              │ │
│ │ Last signal: AAPL, 2m ago  [Configure] [×]  │ │
│ ├──────────────────────────────────────────────┤ │
│ │ Momentum Scanner             ○ Disabled      │ │
│ │ Scans for volume + price breakouts           │ │
│ │                              [Configure] [×]  │ │
│ ├──────────────────────────────────────────────┤ │
│ │ Earnings Calendar            ● Running        │ │
│ │ Alpha Vantage API                           │ │
│ │ Next event: NVDA, 3d away   [Configure] [×]  │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│  [This session only] [All sessions]               │
└──────────────────────────────────────────────────┘
```

### 4.3 Add Source Modal

```
┌─────────────────────────────────────┐
│  Add Signal Source                   │
├─────────────────────────────────────┤
│  Type: [Dropdown ▼]                  │
│  ┌─────────────────────────────────┐ │
│  │ ● Built-in                      │ │
│  │   ○ EDGAR 8-K (no key needed)  │ │
│  │   ○ Economic Calendar (free)    │ │
│  │   ○ Momentum Scanner (free)     │ │
│  │   ○ Earnings Calendar (API key) │ │
│  │                                 │ │
│  │ ● Custom URL / Webhook          │ │
│  │   ○ HTTP POST endpoint          │ │
│  └─────────────────────────────────┘ │
│                                       │
│  Scope: [This session] [Global]       │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │ 🔑 API Key (optional)           │  │
│  │ [ ............................ ]│  │
│  └─────────────────────────────────┘  │
│                                       │
│  [Cancel]              [Add Source]   │
└─────────────────────────────────────┘
```

### 4.4 Configure Panel Per Source

Each source type gets its own config panel:

**EDGAR 8-K:**

- Poll interval (market hours / off-hours)
- CIK whitelist (optional — filter to specific companies)
- Min filing age before emitting (avoid pre-market noise)

**Earnings Calendar:**

- API provider (Alpha Vantage / Financial Modeling Prep)
- API key
- Market filter (NYSE/Nasdaq only, min market cap)
- How far ahead to watch (3 days / 7 days / 14 days)

**Momentum Scanner:**

- Min volume (shares)
- Min price ($)
- Min price change % (1d / 5d)
- Scan interval (minutes)
- Universe (all stocks / watchlist / sector)

**Custom Webhook:**

- Port to listen on
- Secret token (optional)
- Signal format schema (docs / template)

---

## 5. DB Schema

### 5.1 `signal_sources` Table

```sql
CREATE TABLE signal_sources (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,                    -- edgar_8k, earnings_calendar, etc.
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,    -- boolean
  config_json TEXT NOT NULL DEFAULT '{}', -- type-specific config blob
  scope TEXT NOT NULL DEFAULT 'global',   -- 'global' | 'session'
  session_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array, empty if global
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 5.2 `signal_events` Table

```sql
CREATE TABLE signal_events (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES signal_sources(id),
  source_type TEXT NOT NULL,
  ticker TEXT NOT NULL,
  company_name TEXT,
  document_url TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  filed_at TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,  -- boolean: picked up by orchestrator yet
  consumed_at TEXT,
  trade_id TEXT                          -- linked trade if one resulted
);
```

---

## 6. Migration Path

### Phase 0 — Define SignalSource interface and SignalBus (no UI)

1. Create `electron/shared/domain/signal-source.ts` with types
2. Create `electron/main/services/signal-bus.ts`
3. Add `signal_sources` + `signal_events` migration
4. Create `SignalSourcesRepo`
5. Create `WebSearchSignalSource` — wraps the existing selector discovery workers as a backward-compat source
6. Wire SignalBus into orchestration path — orchestrator subscribes and triggers cycles on signal events
7. Verify existing behavior still works (the web search source emits signals, orchestrator processes them same as before)
8. `bun run typecheck`

**Files created:**

- `electron/shared/domain/signal-source.ts`
- `electron/main/services/signal-bus.ts`
- `electron/main/db/repositories/signal-sources-repo.ts`
- `electron/main/services/signal-sources/web-search-source.ts`
- `electron/main/db/drizzle/0003_signal_sources.sql`

**Files modified:**

- `electron/main/services/app-services.ts` — register signal bus
- `electron/main/services/orchestration/cycle/agent-orchestrator.ts` — subscribe to SignalBus

### Phase 1 — Strip Discovery From Pipeline

1. Delete `trend-scout`, `web-scout`, `event-web-scout`, `event-prediction-scout` from selector phase
2. Delete `SELECTOR_WORKERS_*` prompts (all selector workers — pipeline no longer discovers)
3. Delete `earnings-context`, `catalyst-context`, `sentiment-context` from fundamental phase
4. Delete `FUNDAMENTAL_WORKERS_*` prompts for those workers
5. Delete `chart-pattern`, `momentum-indicator` from technical phase
6. Delete `TECHNICAL_WORKERS_*` prompts for those workers
7. Remove `*WorkersForMode` branching — pipeline now has one fixed set of analysis workers
8. Keep only: `document-extractor`, `market-reaction-checker`, `volume-profile`, `price-reaction-checker`
9. `bun run typecheck`

**Files modified:**

- `electron/main/services/pipeline/definitions/selector.phase.ts` (gut it)
- `electron/main/services/pipeline/definitions/fundamental.phase.ts`
- `electron/main/services/pipeline/definitions/technical.phase.ts`
- `electron/main/services/pipeline/worker-prompts.ts`

### Phase 2 — EDGAR Signal Source (wire the first real non-search source)

1. Create `EdgarSignalSource` implementing `ISignalSource`
2. Poll EDGAR Atom feed, parse entries, emit `SignalEvent`
3. Dedup using `signal_events` table
4. Register in `app-services.ts`
5. Add UI for EDGAR source config
6. `bun run typecheck`

**Files created:**

- `electron/main/services/signal-sources/edgar-source.ts`
- `electron/main/services/signal-sources/edgar-rss-client.ts`

### Phase 3 — Signal Sources UI

1. Add `signal-sources` table and `signal_events` table IPC channels
2. Add preload API methods
3. Create `SignalSourcesPage` — list, add, configure, enable/disable, scope assignment
4. Wire into session creation modal as a step/tab
5. Add top-level nav entry under Settings
6. `bun run typecheck`

**Files created:**

- `src/pages/Settings/SignalSourcesPage.tsx`
- `src/components/SignalSources/SignalSourceCard.tsx`
- `src/components/SignalSources/AddSourceModal.tsx`
- `src/components/SignalSources/ConfigureSourcePanel.tsx`

### Phase 4 — Source Catalog (Earnings, Economic Calendar, Momentum)

1. `EarningsCalendarSource` — Alpha Vantage / FMP polling
2. `EconomicCalendarSource` — scrape BLS/Federal Reserve schedules
3. `MomentumScannerSource` — local OHLCV scan using existing data
4. `bun run typecheck`

### Phase 5 — Webhook Source

1. `WebhookSignalSource` — HTTP server listening on configurable port
2. Accept POST with `{ ticker, documentUrl?, payload }`
3. Validate optional secret token
4. Document format for external integrations

### Phase 6 — Remove Legacy Discovery Paths

1. Delete `ResearchDiscoveryMode` enum from `enums.ts` (or reduce to single mode)
2. Delete orphaned aggregator code (`technical-aggregator.ts` cleanup)
3. Remove `*WorkersForMode` branching from pipeline entirely
4. Delete `information-arbitrage-pivot-plan.md` (folded into this architecture)
5. `bun run typecheck`

---

## 7. What OHLCV Is Still Used For

Same as the pivot plan — OHLCV is context, not signal:

| Use                | Why                                                   |
| ------------------ | ----------------------------------------------------- |
| Staleness gate     | Has the stock already moved since the signal dropped? |
| Liquidity check    | Is this stock tradable without moving the market?     |
| Spread check       | Is the bid/ask spread reasonable?                     |
| Position sizing    | Current price × shares = dollar exposure              |
| Stop / take profit | Entry price math                                      |

---

## 8. Risks & Mitigations

| Risk                                                               | Mitigation                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Too many signals overwhelm the orchestrator                        | Per-source rate limit: max N signals/minute. SignalBus queues and the orchestrator processes one at a time                 |
| Signal sources are flaky (EDGAR down, API limits)                  | Each source tracks status/errors independently. UI shows error state. Pipeline continues processing from other sources     |
| User enables conflicting sources (same ticker from EDGAR + manual) | SignalBus deduplicates by `ticker + sourceType + filedAt` within a configurable window. Second identical signal is dropped |
| Adding UI increases surface area                                   | Phase 0 keeps it backend-only. UI comes in Phase 3 after the architecture is proven                                        |
| `processingMode` inference from source type is fragile             | Explicit mapping table in code. Add integration test per source type asserting the correct mode                            |
| Webhook is a security hole                                         | Optional secret token. Bind to localhost only. Warn user about exposing to network                                         |

---

## 9. Files Reference Map

| Area                       | Files                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| Signal types               | `electron/shared/domain/signal-source.ts`                                |
| SignalBus                  | `electron/main/services/signal-bus.ts`                                   |
| Signal sources (base)      | `electron/main/services/signal-sources/`                                 |
| EDGAR source               | `electron/main/services/signal-sources/edgar-source.ts`                  |
| Earnings source            | `electron/main/services/signal-sources/earnings-source.ts`               |
| Momentum scanner           | `electron/main/services/signal-sources/momentum-scanner-source.ts`       |
| Webhook source             | `electron/main/services/signal-sources/webhook-source.ts`                |
| Signal Sources repo        | `electron/main/db/repositories/signal-sources-repo.ts`                   |
| Signal events repo         | `electron/main/db/repositories/signal-events-repo.ts`                    |
| Pipeline selector phase    | `electron/main/services/pipeline/definitions/selector.phase.ts` (gutted) |
| Pipeline fundamental phase | `electron/main/services/pipeline/definitions/fundamental.phase.ts`       |
| Pipeline technical phase   | `electron/main/services/pipeline/definitions/technical.phase.ts`         |
| Worker prompts             | `electron/main/services/pipeline/worker-prompts.ts`                      |
| Orchestrator               | `electron/main/services/orchestration/cycle/agent-orchestrator.ts`       |
| App services               | `electron/main/services/app-services.ts`                                 |
| DB migrations              | `electron/main/db/drizzle/`                                              |
| Signal Sources UI          | `src/pages/Settings/SignalSourcesPage.tsx`                               |
| Add source modal           | `src/components/SignalSources/AddSourceModal.tsx`                        |
| Config panels              | `src/components/SignalSources/ConfigureSourcePanel.tsx`                  |
| IPC endpoints              | `electron/shared/ipc/endpoints.ts`                                       |
| Preload API                | `electron/preload/api.ts`                                                |

---

## 10. Comparison to Pivot Plan

| Dimension            | Pivot Plan                         | Signal-Driven Architecture                         |
| -------------------- | ---------------------------------- | -------------------------------------------------- |
| Scope                | Patch `catalyst_scan` mode         | Full rearchitecture of discovery layer             |
| New signal types     | Add workers + mode branches        | Add a `SignalSource` class                         |
| Pipeline             | Still owns discovery workers       | Pipeline is pure processor                         |
| UI                   | No change                          | New Signal Sources tab + settings                  |
| Backward compat      | Keeps existing workers as fallback | Wraps existing behavior in `WebSearchSignalSource` |
| Time to first signal | 1-2 days (EDGAR workers)           | 1-2 days (Phase 0 → EDGAR source runs)             |
| Time to full         | 1 week                             | 2-3 weeks (with UI)                                |

The pivot plan gets EDGAR in faster. This plan gets _every_ signal source in with the same effort as the first one.
