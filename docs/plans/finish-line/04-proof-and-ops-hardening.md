# 04 — Proof of Life & Ops Hardening

> **Date:** 2026-07-12 · **Status:** Code complete; operator blockers remain · **Depends on:** nothing (parallel-safe)
> **Goal:** The one thing every plan demanded and none delivered: **verified evidence the machine trades**, made repeatable as an automated harness instead of a one-off operator ritual. Plus the operational spine for hands-free running: DB backups, headless nightly jobs, richer notification sinks, and supervisor completeness.

> **PROGRESS (2026-07-13):** T1, T2 (mock), T4, T5, T6 code landed; `bun run check` green (includes `check:proof` mock ≈0.8s).  
> **BLOCKED for Ken (cannot fake):**
>
> - **T3 real G1** — no daily DB at `~/.exva/exva.sqlite` / Application Support on this agent machine; needs Ken's daily DB + Alpaca paper keys + live sessions.
> - **T2 Alpaca prove** — `bun run prove -- --mode=alpaca` fails loud without keys / without a real paper fill (by design).
> - **T7 72h soak** — start on Ken's Mac after T1–T6 + phone sinks configured.  
>   See operator commands at the bottom of this PROGRESS block.

## Current state (verify — updated 2026-07-13)

- `scripts/db-backup.sh` **exists** (upgraded: `sqlite3 .backup` preferred, prune 30, same DB path resolution as the app / `db-reset`).
- Supervisor now covers §9.9 alarm set + `websocket_feed_degraded` + `backup_failed`; Telegram + digest routing + Dev Panel / Accounts UI.
- Headless + launchd install/uninstall scripts land; GUI↔headless handoff documented in `electron/main/instance-lock.ts`.
- Mock prove harness wired into CI via `bun run check` → `check:proof`.

## Tasks

### T1 — `scripts/db-backup.sh` + auto-snapshot — ✅ code

1. Script: `sqlite3 "$DB" ".backup '…'"` with app-aligned path resolution; prune to last 30.
2. In-app: backup before Drizzle migrations at boot; nightly via `NightlyResearchJobDeps.runDbBackup`; last-backup surfaced in Dev Panel footer + Accounts → Ops.

### T2 — Automated proof harness (`bun run prove`) — ✅ mock / ⛔ Alpaca needs Ken

- `scripts/prove-trade-loop.ts` + `bun run prove` / `bun run check:proof`.
- Mock mode: golden-path mock rehearsal (scratch harness, never daily DB) — **in CI** (<2 min).
- Alpaca mode: fails loud without keys; with keys still fails until a real paper fill on daily DB (see Ken commands).

### T3 — The real G1 run — ⛔ BLOCKED (no daily DB here)

Cannot execute. Ken must run on the daily DB (see commands below).

### T4 — Headless mode + launchd — ✅ code

- `bun run headless` / `scripts/run-headless.sh` (`EXVA_HEADLESS=1`).
- `scripts/install-launchd.sh` / `uninstall-launchd.sh`.
- Single-instance: GUI signals headless to exit via `~/.exva/instance.lock` then takes over (`instance-lock.ts`).

### T5 — Notification sinks: Telegram + digest routing — ✅ code

- Telegram sink beside ntfy; Keychain `notify:telegram` or `EXVA_TELEGRAM_BOT_TOKEN` + `EXVA_TELEGRAM_CHAT_ID`.
- Severity routing + 08:00 local digest flush; Accounts test buttons.

### T6 — Supervisor completeness — ✅ code

All §9.9 alarms + `websocket_feed_degraded` + `backup_failed`: unit tests + Dev Panel trigger buttons.

### T7 — 72h unattended soak — ⛔ BLOCKED (Ken's machine)

See start command + pass criteria below.

## Done criteria

- [x] `bun run prove` mock passes; wired into CI (`check:proof`).
- [ ] `bun run prove -- --mode=alpaca` / daily DB real opened+closed paper trade; baseline scorecard exported. **Ken**
- [ ] Headless + launchd verified (job rows while GUI closed). **Ken**
- [ ] Telegram + ntfy + digest routing fire (phone evidence). **Ken**
- [x] All §9.9 alarms implemented with tests + Dev Panel triggers.
- [ ] 72h soak completed and summarized. **Ken**

---

## Ken: what to run (T3 / T2 Alpaca / T7)

### T2 Alpaca prove (keys + real paper path)

```bash
# Fails loud if missing:
bun run prove -- --mode=alpaca

# With keys set in .env (ALPACA_API_KEY / ALPACA_SECRET_KEY), that command still
# exits non-zero until a real Alpaca-paper fill exists — by design.
# Then run G1 on the daily DB (T3).
```

### T3 — Real G1 on daily DB

```bash
# 1. Backup first
bun run db:backup

# 2. Start app (GUI or headless) on the daily DB
#    Default path: ~/Library/Application Support/exva/exva.db
#    Or: EXVA_DB_PATH=/path/to/exva.db bun run headless
bun run headless   # or: bun run dev

# 3. Ensure Alpaca paper account + AI provider are configured (Accounts / Brokers).
# 4. Run normal paper sessions + one BTC breakout session (1m cadence).
#    If nothing triggers in 3 market days: temporarily loosen thresholds via
#    strategy config, note that in this PROGRESS, restore after fill.
# 5. Done when daily DB has ≥1 row with trades.opened_at AND closed_at from
#    Alpaca paper, and first-week baseline scorecard is exported (attach path here).
```

### T7 — 72h soak

```bash
# After T1–T6 + phone sinks tested:
bun run scripts/install-launchd.sh
# Confirm headless is alive: tail -f ~/.exva/logs/headless.stdout.log

# Pass criteria (record results in this PROGRESS when done):
# - Zero silent stalls: every stall/anomaly produced a notification
# - Nightly jobs ran all three nights (job log / digest evidence)
# - Backups exist under ~/.exva/backups for those nights
# - Phone sinks received kill-switch samples + at least one morning digest
```

### User journey

Ken installs the launchd agent once. His Mac now runs Exva headless from login. At 08:00 his phone gets one Telegram digest: yesterday's P&L, trades, ladder status. When the BTC session trips its drawdown limit at 2am, the phone buzzes immediately with "session paused: drawdown −3.1%". He opens the GUI when he wants — headless yields, and the dashboard shows everything the headless run did.

### TLDR: shortcuts taken

- Single-instance GUI↔headless handoff design ("GUI signals headless to exit") chosen for simplicity without prototyping; if session-runtime handover proves messy, the acceptable fallback is "GUI refuses to start while headless runs, with a Stop Headless button" — equally complete, choose and document.
- CI-embedding threshold for the proof harness (2 min) is a guess — mock prove is ~0.8s so it is inside `bun run check`.
- T3 allows threshold-loosening to force a real fill — a judgment call that pipeline-proof matters more than natural-setup purity for G1.

### Core decisions (sign-off required)

| #   | Decision                                                                  | Why                                                                      |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Proof harness becomes a standing regression gate for all later docs       | Prevents ever re-entering "beautiful machine, never runs"                |
| 2   | Headless-first autonomy via launchd (answers 50→100 open question 7: yes) | Nightly jobs must not depend on a window being open                      |
| 3   | Telegram added as second push sink                                        | ntfy alone is fine, but Telegram gives replies/history on phone for free |
