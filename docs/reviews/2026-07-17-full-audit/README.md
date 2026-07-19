# Exva Full System Audit — 2026-07-17 (completed)

Completed 2026-07-18. Fixer-oriented detail docs were retired after execution; this file is the record of what shipped.

## Scope

Local-first Electron trading workstation: sandboxed renderer → typed preload IPC → privileged main (SQLite, brokers, LLM, session runtime). Audit covered backend money-path safety, control-agent capability parity, UI token/primitive consistency, and assistant chat polish.

## What shipped

### Backend
- IPC `handle(channel, schema, handler)` with Zod at the boundary; raw `ipcMain.handle` banned by ESLint
- `safeJsonParse` for main-process JSON; unguarded `JSON.parse` cleared outside the helper
- Broker adapters fail loud on missing price/qty/balance (`requirePositivePrice` / `requireFiniteNumber`) instead of coercing to `0`
- Kill-switch `isHalted()` last-mile gate before order submit; concurrent `startSession` coalesced
- Timer/feed teardown verified (tickers + streaming ping)
- Unhandled rejection / uncaught exception logging in main entry
- Pino redact expanded for secret-shaped keys; keytar stores secrets, SQLite keeps refs only
- Multi-step capital/approval/paper money writes wrapped in transactions
- Risk engine rejects non-finite/`<=0` prices; exit policy skips invalid mark/entry
- `prove` / smoke scripts state MockAdapter honesty explicitly

### Control agent
- Capability surface expanded (approvals, kill switch, reads, strategy writes, sessions, signals, labs, broker ops)
- Safety: structured live risk, scope force-confirm, 5‑min confirm timeout, tool results in history, token streaming, result summarizers
- Auto-approve keyed per capability (legacy confirmClass still honored)
- App-state snapshot includes pending approvals, kill gauges, and optional UI route/selected session
- Turn budget: 20 steps / $1.00

### UI + assistant
- Shared `ConfirmDialog` / `format.ts` / `Skeleton`+`PanelLoading`; native `window.confirm/prompt/alert` removed
- Primitive consolidation (`EmptyState`, Badge/Card wrappers); app tokens on control surfaces
- AssistantHub full view, Radix slide-over + motion, react-markdown+GFM, history/drafts/rename, scoped open, confirmation error recovery

## Intentionally out of product scope
- Credential entry (broker/API keys) stays UI-only
- Dev-only inject/force-trade tools stay UI/dev-only
