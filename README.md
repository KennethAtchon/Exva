# Exva

Local-only autonomous trading desktop app. Tauri 2 (Rust) + React/TypeScript + SQLite.
See [`docs/System_Design.md`](./docs/System_Design.md) for architecture, [`docs/USAGE.md`](./docs/USAGE.md) for how to run, [`docs/CHECKLIST.md`](./docs/CHECKLIST.md) for build status.

## What's here

- `src/` — React/TypeScript frontend. Typed Tauri wrapper in `src/lib/tauri.ts`.
- `src-tauri/` — Rust backend: agents, broker adapter, SQLite persistence, keychain, risk engine, session manager.
- `src-tauri/migrations/` — SQL migrations (run automatically on startup via `refinery`).
- `Exva/` — original inline-JSX prototype UI, kept as reference. Not used by the app.

## Run

Prereqs: Rust toolchain, Node 20+, platform build deps ([tauri.app](https://tauri.app/start/prerequisites/)).

```bash
npm install
npm run start        # = cargo tauri dev — starts Vite + the desktop shell
```

To produce a bundled app, first run `npm run tauri icon <any-square-png>` to
generate platform icons, flip `bundle.active` to `true` in
`src-tauri/tauri.conf.json`, then `npm run bundle`.

## Implementation status

| Area | Status |
|---|---|
| UI (all 7 pages) | complete, wired to Tauri commands via typed `api.*` |
| Tauri IPC surface | all commands + events per System_Design §5 |
| SQLite schema + migrations | complete (System_Design §3) |
| Session state machine | complete (§8) |
| Risk engine (limits + self-adaptation) | complete (§7) |
| Keychain (API keys, broker secrets) | complete |
| Broker adapter trait + `MockBroker` | complete |
| `AlpacaBroker` | scaffold only — REST calls are TODO |
| Claude client + agent prompts | scaffold only — HTTP + parsing TODO |
| Orchestrator / monitor loop | sequence wired, Claude/broker calls TODO |

Search the repo for `TODO` to find every pending piece.

## Architecture notes

- **IPC boundary**: frontend never touches the DB, keychain, or external APIs
  directly. Everything flows through Tauri commands. See `src/lib/tauri.ts`.
- **Live updates**: the Rust monitor tick emits `stats_update` / `agent_event` /
  `trade_opened` / `trade_closed` events. Frontend subscribes via
  `useTauriEvent`. Also polls stats every 5s as a fallback.
- **Secrets**: only ever in the OS keychain (`keyring` crate). SQLite never
  stores keys.
- **Dev without Tauri**: `npm run dev` alone launches Vite in a browser. The
  typed wrapper falls back to mock data so the UI still renders.
