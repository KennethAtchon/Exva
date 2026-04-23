# Exva

Local-only autonomous trading desktop app. Electron + React/TypeScript + SQLite.
See [`docs/System_Design.md`](./docs/System_Design.md) for architecture, [`docs/USAGE.md`](./docs/USAGE.md) for how to run, [`docs/CHECKLIST.md`](./docs/CHECKLIST.md) for build status.

## What's here

- `src/` — React/TypeScript frontend. Typed Electron wrapper in `src/lib/exva.ts`.
- `electron/` — Electron main/preload code: IPC, services, broker adapters, SQLite, keychain, risk, sessions, and AI orchestration.
- `Exva/` — original inline-JSX prototype UI, kept as reference. Not used by the app.

## Run

Prereqs: Node 20+ and platform build tools for Electron native modules.

```bash
npm install
npm run start        # starts Electron Forge + Vite
```

To produce a packaged app, run `npm run package`. To create platform installers, run `npm run make`.

## Implementation status

| Area | Status |
|---|---|
| UI (all 7 pages) | complete, wired to Electron IPC via typed `api.*` |
| Electron IPC surface | dashboard, trades, session, config, accounts, events |
| SQLite schema + migrations | ported to Electron main with Drizzle schema definitions |
| Session state machine | persisted locally with start/pause/stop |
| Risk engine | local TypeScript preflight and decision checks |
| Keychain | API keys and broker secrets via `keytar` |
| Broker adapters | mock default plus isolated Alpaca REST adapter |
| AI runtime | Vercel AI SDK wrapper with direct Anthropic provider |
| Orchestrator / monitor loop | TypeScript service sequence wired with event emission |

Search the repo for `TODO` to find every pending piece.

## Architecture notes

- **IPC boundary**: frontend never touches the DB, keychain, or external APIs directly. Everything flows through the preload-exposed `window.exva` API. See `src/lib/exva.ts`.
- **Live updates**: the Electron main process emits `stats_update`, `agent_event`, `trade_opened`, and `trade_closed` events. Frontend subscribes via `useExvaEvent`. It also polls stats every 5s as a fallback.
- **Secrets**: only ever in the OS keychain through `keytar`. SQLite never stores keys.
- **Browser dev**: `npm run dev:renderer` launches Vite in a browser. The typed wrapper falls back to mock data so the UI still renders.
