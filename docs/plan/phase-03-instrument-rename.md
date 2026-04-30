# Phase 3 — Asset → Instrument Rename

> Systematic find-and-replace across the entire codebase.
> Pure rename — no behavioral changes.

## Goal

Eliminate all stock-centric naming (`asset`, `stock`) from shared types, DB columns, repositories, services, and UI. Replace with `instrument_symbol`, `instrument_type`, `InstrumentClass`. This unblocks multi-class support in later phases.

## Hard Problems

None — this is mechanical. The risk is **incomplete replacement** leaving stale `asset` references that silently pass TypeScript because `string` is compatible everywhere. The acceptance criteria section enforces completeness with grep.

## Rename Map

| Old | New | Scope |
|-----|-----|-------|
| `Trade.asset` | `Trade.instrumentSymbol` | `src/lib/types.ts` |
| `trades.asset` | `trades.instrument_symbol` | `schema.ts`, `migrations.ts` |
| `AgentType` | `AgentRole` | `electron/shared/domain.ts`, all imports |
| `SessionConfig` | removed (per-session strategy fields) | `src/lib/types.ts` |
| `"stock"` hardcoded strings | `InstrumentClass` enum | `agent-orchestrator.ts`, `ai-sdk-service.ts` |
| `watchlistFor()` hardcoded `["SPY","QQQ"]` | `session.instrumentScope` | `agent-orchestrator.ts` |
| `modelByAgent` fixed map | per-session AI role config | `ai-sdk-service.ts` (Phase 7) |
| `asset` param in `ResearcherInput` | `instrumentSymbol` | `ai-sdk-service.ts` |
| `asset` in `TradeDecisionPayload` | `instrumentSymbol` | `electron/preload/exva-api.ts` |
| `asset` column reference in `stats-repo.ts` | `instrument_symbol` | `stats-repo.ts` |
| `asset` in `mappers.ts` | `instrumentSymbol` | `mappers.ts` |

## File-by-File Changes

### `src/lib/types.ts`

```typescript
// Before
export interface Trade {
  asset: string;
  ...
}

// After
export interface Trade {
  instrumentSymbol: string;
  instrumentType: InstrumentClass;
  sessionId: string;
  brokerAccountId: string | null;
  ...
}
```

Remove `SessionConfig` interface — replaced by `SessionStrategy` in `domain.ts`.
Re-export `AgentRole`, `InstrumentClass`, `SessionStatus` from `electron/shared/domain.ts`.

### `electron/main/db/repositories/mappers.ts`

Update all row-to-domain mappers to use new column names:

```typescript
// Before
function rowToTrade(row: TradeRow): Trade {
  return { asset: row.asset, ... };
}

// After
function rowToTrade(row: TradeRow): Trade {
  return { instrumentSymbol: row.instrument_symbol, instrumentType: row.instrument_type, ... };
}
```

### `electron/main/services/agent-orchestrator.ts`

Remove `watchlistFor()` — instruments come from `session.instrumentScope`:

```typescript
// Before (hardcoded)
private watchlistFor(config: SessionConfig): string[] {
  if (config.strategy.toLowerCase().includes("income")) return ["SPY"];
  return ["SPY", "QQQ"].slice(0, config.max_concurrent_trades);
}

// After (session-scoped)
private getInstruments(session: WorkspaceSession): string[] {
  // Phase 3: parse manual_shortlist as newline/comma-separated symbols
  // Phase 9: AI selector flow replaces this
  return session.instrumentScope
    .split(/[\n,]+/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, session.maxConcurrentTrades ?? 3);
}
```

### `electron/main/services/ai-sdk-service.ts`

```typescript
// Before
async runResearcher(input: ResearcherInput, stance: "bull" | "bear"): Promise<AgentResult<string>> {
  // input.asset

// After
async runResearcher(input: ResearcherInput, stance: "bull" | "bear"): Promise<AgentResult<string>> {
  // input.instrumentSymbol
```

```typescript
// ResearcherInput
export interface ResearcherInput {
  instrumentSymbol: string;   // was: asset
  context?: string;
}
```

### `electron/preload/exva-api.ts`

```typescript
// TradeDecisionPayload
export interface TradeDecisionPayload {
  trade_id: string;
  instrumentSymbol: string;    // was: asset
  side: "BUY" | "SELL";
  size_usd: number;
  confidence: number;
  reasoning: string;
}
```

### `electron/shared/channels.ts`

Add new channel constants needed by Phase 4:

```typescript
export const CHANNELS = {
  // existing
  SESSION_START: "session:start",
  SESSION_PAUSE: "session:pause",
  SESSION_STOP:  "session:stop",
  SESSION_STATUS:"session:status",
  // new in Phase 4
  SESSION_LIST:          "session:list",
  SESSION_CREATE:        "session:create",
  SESSION_UPDATE:        "session:update",
  SESSION_FOCUS:         "session:focus",
  SESSION_GO_GLOBAL:     "session:go-global",
  SESSION_ARCHIVE:       "session:archive",
  SESSION_DUPLICATE:     "session:duplicate",
  WORKSPACE_VIEW_GET:    "workspace:view:get",
  WORKSPACE_PREFS_PATCH: "workspace:prefs:patch",
  TEMPLATE_LIST:         "template:list",
  TEMPLATE_CREATE:       "template:create",
  TEMPLATE_DELETE:       "template:delete",
  TEMPLATE_USE:          "template:use",
  APPROVAL_LIST:         "approval:list",
  APPROVAL_DECIDE:       "approval:decide",
  // existing
  ...
} as const;
```

## Grep Checklist — Zero Remaining References

After this phase, the following greps must return zero results:

```bash
grep -r "\.asset\b" src/ electron/ --include="*.ts" --include="*.tsx"
grep -r '"asset"' src/ electron/ --include="*.ts" --include="*.tsx"
grep -r 'AssetType\|StockSymbol' src/ electron/ --include="*.ts" --include="*.tsx"
grep -r '"SPY"\|"QQQ"' electron/main/ --include="*.ts"
grep -r 'AgentType' src/ electron/ --include="*.ts" --include="*.tsx"
```

## UI Rename

| File | Change |
|------|--------|
| `src/pages/TradesPage.tsx` | `trade.asset` → `trade.instrumentSymbol` |
| `src/pages/TradeDetail.tsx` | `trade.asset` → `trade.instrumentSymbol` |
| `src/pages/Dashboard.tsx` | any `asset` display references |
| `src/lib/mock.ts` | update mock data field names |
| `src/lib/formatters.ts` | update any formatter that references `asset` |

## Files Modified in This Phase

| File | Change |
|------|--------|
| `electron/shared/domain.ts` | primary source of truth (Phase 1) |
| `electron/shared/channels.ts` | add new channel constants |
| `src/lib/types.ts` | update `Trade`, remove `SessionConfig`, re-export domain types |
| `electron/main/db/repositories/mappers.ts` | update all row mappers |
| `electron/main/db/repositories/trades-repo.ts` | update column references |
| `electron/main/db/repositories/stats-repo.ts` | update column references |
| `electron/main/services/agent-orchestrator.ts` | remove `watchlistFor`, add `getInstruments` |
| `electron/main/services/ai-sdk-service.ts` | rename `asset` → `instrumentSymbol` in inputs |
| `electron/preload/exva-api.ts` | rename payload fields |
| `src/pages/TradesPage.tsx` | display field rename |
| `src/pages/TradeDetail.tsx` | display field rename |
| `src/pages/Dashboard.tsx` | display field rename |
| `src/lib/mock.ts` | mock data field rename |

## Acceptance Criteria

- All greps in the checklist above return zero results.
- TypeScript compilation passes with no errors.
- The app renders the trades list and trade detail correctly with renamed fields.
- No behavioral change: the session still starts, runs agent cycles, and records trades.
