# Exva — Usage

How to install, run, and interact with the desktop app.

---

## 1. Prereqs

| Tool                 | Version              | Notes                                                                               |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| Bun                  | 1.3+                 | required package manager and script runner for Electron Forge, Vite, and TypeScript |
| Platform build tools | current OS toolchain | required by Electron native modules such as `better-sqlite3` and `keytar`           |

---

## 2. Install

```bash
bun install
```

That pulls the React/TS frontend deps, Electron Forge, and native modules.

---

## 3. Run in dev

```bash
bun run start
```

Starts Electron Forge with Vite for the main process, preload bridge, and React renderer. Hot reload works for renderer edits; main/preload edits restart the Electron shell.

**Browser fallback.** `bun run dev:renderer` loads the UI in a regular browser tab. The typed Exva wrapper detects no Electron preload API and serves mock data, so you can iterate on UI without spinning the desktop shell.

---

## 4. First-run setup

The app boots into the Dashboard. Before it can place a real trade you need to:

1. **Accounts page** — paste an Anthropic key, then Alpaca API key + secret. Pick **Paper Trading** unless you mean it.
2. **Test Connections** — confirms keys reach the broker. Status pills go green.
3. **Strategy page** — set position size, stop-loss/take-profit, daily loss limit, profit target, and API spend cap. Save.
4. **Top nav → ▶ Start** — flips the session into Active. Risk engine starts checking limits each tick.

Pause / Stop are next to Start. Stop emits `session_stopped` and halts new cycles; open trades keep being monitored.

---

## 5. Pages

| Page                        | Use it for                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| **Dashboard**               | Live stat strip, open + recent trades, real-time agent feed                                |
| **Trades**                  | Full trade history with filter + summary cards                                             |
| **Trade Detail** (slide-in) | Per-trade P&L, stop/target rail, agent traces with token + cost breakdown, **Force Close** |
| **Strategy**                | All risk/sizing knobs. Saving writes to `session_config` table                             |
| **API Usage**               | Today's API spend, donut + 7-day history, per-agent / per-trade cost, projections          |
| **Developer**               | Filterable event log, level + agent filters, click row → detailed agent runs               |
| **Accounts**                | Anthropic + Alpaca + Web Search keys. Stored in OS keychain only                           |

---

## 6. Where data lives

| Thing                     | Location                                                             |
| ------------------------- | -------------------------------------------------------------------- |
| SQLite DB                 | Electron `app.getPath("userData")/exva.db`                           |
| API keys & broker secrets | OS keychain (macOS Keychain, Win Cred Manager, Linux Secret Service) |
| Migrations                | Electron main process runs local SQLite migrations on boot           |
| Logs                      | local Electron process logs; never uploaded by default               |

Wipe the DB during dev:

```bash
rm "$HOME/Library/Application Support/Exva/exva.db"
```

---

## 7. Bundling

```bash
bun run package
bun run make
```

Packaged output lands in `out/`.

---

## 8. Debugging tips

- **Open devtools in the desktop window**: right-click → Inspect (only in dev).
- **IPC command failed?** Errors are normalized by the Electron IPC handler. Check the renderer console and terminal log.
- **Main-process logs**: `EXVA_LOG_LEVEL=debug bun run start`.
- **DB inspection**: `sqlite3 "$HOME/Library/Application Support/com.exva.app/exva.db"`.
- **Mock broker**: default until you save Alpaca creds. Trades execute "successfully" but go nowhere.

---

## 9. Adding a new IPC method

1. Add a channel constant in `electron/shared/channels.ts`.
2. Add or extend a handler in `electron/main/ipc/`.
3. Expose a narrow method in `electron/preload/index.ts`.
4. Add a typed wrapper to `src/lib/exva.ts`, including a mock fallback.
5. Call `api.myCmd(...)` from a page or store.

Same pattern for events: main `eventBus.emit("name", payload)` to frontend `useExvaEvent("name", handler)`.
