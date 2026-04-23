# Exva — Usage

How to install, run, and interact with the desktop app.

---

## 1. Prereqs

| Tool | Version | Notes |
|---|---|---|
| Node | 20+ | for Vite + Tauri CLI |
| Rust | 1.77+ (stable) | `rustup default stable` |
| Platform deps | macOS: Xcode CLT · Linux: webkit2gtk · Windows: WebView2 + MSVC | see https://tauri.app/start/prerequisites/ |

---

## 2. Install

```bash
npm install
```

That pulls the React/TS frontend deps **and** Tauri CLI. The Rust deps fetch on first `cargo` run.

---

## 3. Run in dev

```bash
npm run start
```

Equivalent to `cargo tauri dev`. Vite serves the frontend on `http://localhost:1420`; the Tauri shell loads it in a desktop window. Hot-reload works for both sides — edit a `.tsx` and the WebView refreshes; edit a `.rs` and the Rust process rebuilds and the window reopens.

**Browser fallback.** `npm run dev` (Vite only) loads the UI in a regular browser tab. The typed Tauri wrapper detects no Tauri runtime and serves mock data, so you can iterate on UI without spinning the Rust shell.

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

| Page | Use it for |
|---|---|
| **Dashboard** | Live stat strip, open + recent trades, real-time agent feed |
| **Trades** | Full trade history with filter + summary cards |
| **Trade Detail** (slide-in) | Per-trade P&L, stop/target rail, agent traces with token + cost breakdown, **Force Close** |
| **Strategy** | All risk/sizing knobs. Saving writes to `session_config` table |
| **API Usage** | Today's API spend, donut + 7-day history, per-agent / per-trade cost, projections |
| **Developer** | Filterable event log, level + agent filters, click row → detailed agent runs |
| **Accounts** | Anthropic + Alpaca + Web Search keys. Stored in OS keychain only |

---

## 6. Where data lives

| Thing | Location |
|---|---|
| SQLite DB | `$APPDATA/com.exva.app/exva.db` (macOS: `~/Library/Application Support/com.exva.app/`) |
| API keys & broker secrets | OS keychain (macOS Keychain, Win Cred Manager, Linux Secret Service) |
| Migrations | `src-tauri/migrations/V*__*.sql` — applied on every boot via `refinery` |
| Tauri logs | platform log dir (see Tauri docs) — never uploaded |

Wipe the DB during dev:
```bash
rm "$HOME/Library/Application Support/com.exva.app/exva.db"
```

---

## 7. Bundling

```bash
npm run tauri icon path/to/your-square-1024.png   # generates icons/* in src-tauri/icons
# then edit src-tauri/tauri.conf.json: "bundle.active": true
npm run bundle
```

Output bundles land in `src-tauri/target/release/bundle/`.

---

## 8. Debugging tips

- **Open devtools in the desktop window**: right-click → Inspect (only in dev).
- **Tauri command failed?** Errors come back as plain strings (`AppError::Display`). Check the WebView console.
- **Rust logs**: `RUST_LOG=exva_lib=debug npm run start`.
- **DB inspection**: `sqlite3 "$HOME/Library/Application Support/com.exva.app/exva.db"`.
- **Mock broker**: default until you save Alpaca creds. Trades execute "successfully" but go nowhere.

---

## 9. Adding a new Tauri command

1. Add `#[tauri::command] pub async fn my_cmd(...)` in `src-tauri/src/commands/<group>_commands.rs`.
2. Register it in `src-tauri/src/lib.rs` inside `tauri::generate_handler![...]`.
3. Add a typed wrapper to `src/lib/tauri.ts` under `api.*`, including a mock fallback.
4. Call `api.myCmd(...)` from a page or store.

Same pattern for events (backend `handle.emit("name", payload)` ↔ frontend `useTauriEvent("name", handler)`).
