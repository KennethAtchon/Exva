# 05 — Polymarket Paper Mode (Ghost Trades), Executed

> **Date:** 2026-07-12 · **Status:** Code complete (multi-day soak pending Ken) · **Depends on:** 04 (proof harness exists) · shares `GhostFillSimulator` with doc 03 T3 (Kraken)
> **Goal:** Execute `docs/plans/polymarket-paper-mode.md` (2026-06-24 draft) **in full**, upgraded to the current v2 order contract and generalized so Kraken (doc 03) reuses the fill simulator. When done, the prediction-event experience runs true paper sessions against real Polymarket market data with tracked paper balances, real-outcome resolution, and parity verification. The draft doc then moves to attic.
>
> **PROGRESS (2026-07-13):**
>
> - **T1** — `GhostFillSimulator` already from doc 03; extended with `listOpen()` + marketable/sell-crossing tests. **Verified reused by Kraken.**
> - **T2** — `paper_balances` migration `0011`, `PaperBalancesRepo`, debit/credit + `BROKER_INSUFFICIENT_FUNDS`, reset IPC (`broker-accounts:reset-paper-balance`) + Brokers UI button for Polymarket/Kraken paper rows.
> - **T3** — Polymarket paper path on shared simulator: market mid-fill, resting limits, cancel, `getOpenOrders`, `createOrderEventFeed` ghost emits. Live CLOB path unchanged.
> - **T4** — Ghost positions settle at real gamma resolution (winner→$1 / loser→$0) on status poll / close; TradeMonitor `event_resolution` still drives forced close.
> - **T5** — Post-fill gamma-api parity check → `parity_check_failed` supervisor alarm; Kraken validate-only already on same simulator + now shares `paper_balances`.
> - **T6** — `bun run prove -- --mode=polymarket` (mode 3): fails loud if gamma-api unreachable; ghost place→fill→forced-close. Draft moved to `docs/attic/polymarket-paper-mode.md`. In-app docs/glossary updated.
> - **BLOCKED for Ken (cannot fake multi-day evidence):** overnight prediction-event paper session on daily DB with real dislocation → ghost fill → resolution settle → labeled observation. Commands below.
>
> #### Ken must run (multi-day paper evidence)
>
> ```bash
> # 1) Prove mode 3 (network required; fails loud without gamma-api)
> bun run prove -- --mode=polymarket
>
> # 2) App on daily DB — Polymarket paper account
> #    Brokers → set Polymarket to Paper → Reset paper balance ($1000 default)
> #    Start Prediction Event Edge session (paper_only), loosened edge gate
> #    Leave overnight / multi-day until ≥1 ghost trade opens and later resolves
> #    Confirm: paper_balances row moved; trades lifecycle; signal_labels resolution horizon
>
> # 3) Optional soak note — paste first ghost trade ids into this PROGRESS
> ```

## Current state (verify)

- `polymarket-adapter.ts` implements live CLOB + **paper ghost path** via `GhostFillSimulator`, persisted `paper_balances`, gamma parity + resolution settlement.
- Position tracking keys on `(conditionId, outcome)`; gamma-api reads are free/unauthenticated; paper is session/broker-level (no redundant `trades.paper` column).

## Design deltas vs the 2026-06-24 draft (binding)

1. **`GhostFillSimulator`** lives in `electron/main/services/broker/mock/ghost-fill-simulator.ts`, adapter-agnostic: `simulateFill(order: BrokerOrderV2, quote: {bid, ask, last}): GhostFillReceipt`. Market orders fill at mid; **limit orders** fill immediately only if marketable, else rest and re-check on `getOrderStatus` poll. Cancel works on resting ghosts.
2. **Paper balance is per-account, persisted** — `paper_balances(account_id PK, currency, balance, starting_balance, updated_at)` + "Reset paper balance" on Brokers for Polymarket/Kraken paper. Insufficient → `BROKER_INSUFFICIENT_FUNDS`.
3. **Ghost positions flagged** — computed from session `executionMode` / broker `mode` (no redundant trades column).
4. **Resolution uses reality**: polls for real resolved outcome; ghost bets settle at 0/1.
5. **Parity check** after each ghost fill → warn log + `parity_check_failed` supervisor notification.

## Tasks

1. **T1 — Simulator.** ✅ (doc 03 + extended tests / `listOpen`)
2. **T2 — Paper balances.** ✅
3. **T3 — Adapter integration.** ✅
4. **T4 — Resolution settlement.** ✅
5. **T5 — Parity verification + Kraken reuse.** ✅
6. **T6 — Prove it.** ✅ code/mode 3; ⛔ multi-day soak **Ken**

## Done criteria

- [x] Prediction-event sessions can run in paper mode against real Polymarket data end-to-end (code path: signal → ghost fill → resolution settle).
- [x] Resting ghost limit orders fill when the real market crosses; cancel works.
- [x] Paper balances persist across restarts; reset works; insufficient-funds path tested.
- [x] `bun run prove` mode 3 implemented (fails loud without gamma); multi-day paper run evidence **Ken**.
- [x] Old draft moved to `docs/attic/`; in-app docs explain ghost mode.

### User journey

Ken flips his Polymarket account to Paper, sets a $1,000 paper balance, starts the prediction session. Overnight it ghost-buys 120 contracts of a mispriced market at 0.34. Three days later the market resolves YES; the paper balance credits $79 net of modeled fees, the trade row shows the full lifecycle, and the calibration store gets a real labeled outcome — zero USDC ever moved.

### TLDR: shortcuts taken

- Resting-limit ghost fills use quote-crossing on poll cadence, not an order-book matching sim — fills can be optimistic vs real queue priority; acceptable for paper, stated in in-app docs.
- Fee modeling: live path has no extractable CLOB fee formula; ghost fills currently use full notional (no invented fee haircut).
- Assumed the existing resolution poller can adopt ghost positions with modest changes — TradeMonitor time-based close + adapter settlement at real outcome prices.

### Core decisions (sign-off required)

| #   | Decision                                                                                        | Why                                                                         |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Ghost limit orders can rest and fill on real crossings (beyond the draft's immediate-fill-only) | v2 contract exists now; maker behavior is the prediction edge's core tactic |
| 2   | Paper balance per-account, persisted, resettable (answers draft OQ3)                            | Matches draft recommendation; survives restarts                             |
| 3   | One shared `GhostFillSimulator` for Polymarket + Kraken                                         | Two venues lack sandboxes; one simulator, one test suite                    |
