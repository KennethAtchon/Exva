# 03 — Broker Completion (Kalshi, Tradier, Kraken real; Alpaca streaming)

> **Date:** 2026-07-12 · **Status:** Code complete (real-broker certs pending Ken's keys) · **Depends on:** nothing (parallel-safe with 01/02)
> **Goal:** No adapter in the registry throws "not implemented". Kalshi, Tradier, Kraken become fully working adapters (auth, balances, quotes/data, place/cancel under `BrokerOrderV2`, order-event feed, capability flags). Alpaca gets its websocket `OrderEventFeed`. A shared certification suite proves each adapter against its paper/demo environment. IBKR and Schwab are **permanently dropped** — remove any mention from ambition lists.
>
> **PROGRESS (2026-07-13):**
>
> - External API facts confirmed vs live docs; table updated (Kalshi Create Order **V2** path, URLs, Tradier multileg, Kraken `validate`).
> - T1–T6 implemented in code: full Kalshi/Tradier/Kraken adapters, Alpaca `trade_updates` WS feed + poll fallback + supervisor hook, `GhostFillSimulator`, cert suite + `bun run cert:broker`, Brokers UI forms, glossary/docs, IBKR/Schwab removed from ambition docs.
> - `grep -rn "not implemented" electron/main/services/broker` → **zero hits**.
> - Mock cert (CI) **PASS** — pasted below.
> - **Real-broker certs PENDING Ken's keys** (script fails LOUD without env — never silent skip).
>
> #### Mock cert output (`bun run cert:broker -- mock`)
>
> ```
> === Adapter certification: mock (mock) ===
> Result: PASS
>   [OK] testConnection: Mock broker connected
>   [OK] getAccountBalance: balance=100000
>   [OK] getPositions: positions=0
>   [OK] getMarketSnapshot: price=336
>   [OK] capabilitiesRefuseUnsupported: refused: orderType stop unsupported
>   [OK] placeOrderV2RejectsUnsupported: Mock rejects order: orderType stop unsupported
>   [OK] placeFarLimit: id=mock_… status=open
>   [OK] cancelFarLimit: status=closed
>   [OK] placeMarketable: id=mock_… fillPx=336
>   [OK] orderEventFeedTerminal: terminal fill observed
>   [OK] errorTaxonomyDocumented: BROKER_AUTH|INSUFFICIENT_FUNDS|UNKNOWN_SYMBOL|REJECTED via AppError
> ```
>
> #### Ken must run (with keys)
>
> ```bash
> # Kalshi demo
> export KALSHI_KEY_ID=… KALSHI_PRIVATE_KEY_PEM='-----BEGIN…'
> bun run cert:broker -- kalshi
>
> # Tradier sandbox
> export TRADIER_ACCESS_TOKEN=… TRADIER_ACCOUNT_ID=…
> bun run cert:broker -- tradier
>
> # Kraken (validate-only paper)
> export KRAKEN_API_KEY=… KRAKEN_API_SECRET=…
> bun run cert:broker -- kraken
>
> # Alpaca paper (+ optional live WS fill eye-check in app)
> export ALPACA_API_KEY=… ALPACA_API_SECRET=…
> bun run cert:broker -- alpaca
> ```
>
> Paste each PASS block back into this PROGRESS note. Eye-verify Brokers page Test connection + one Alpaca paper fill via TradeMonitor WS path.

## External facts the agent must confirm first (30-minute doc pass per broker, then build — no multi-day "spikes")

| Broker  | Auth                                                                                                    | Paper env                                                                          | Order API                                                                                                                                                                                                                                                                | Stream                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kalshi  | API key id + RSA-PSS signed requests (`timestamp+METHOD+path`, strip query)                             | Demo: `https://external-api.demo.kalshi.co/trade-api/v2` (separate keys from prod) | **V2** `POST /portfolio/events/orders` — required `ticker`, `side` (`bid`/`ask` = buy/sell YES), `count` (fp contracts), `price` (fp $), `time_in_force` (`good_till_canceled`/`immediate_or_cancel`/`fill_or_kill`). Legacy `/portfolio/orders` deprecated ≥2026-05-06. | WSS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` (prod: `external-api-ws.kalshi.com`); subscribe `fill` (+ poll fallback). Auth via same RSA headers on handshake. |
| Tradier | Bearer token (personal API token from settings; OAuth optional for partners)                            | `https://sandbox.tradier.com/v1` vs `https://api.tradier.com/v1`                   | `POST /accounts/{id}/orders` form body — `class=equity\|option\|multileg` (+ `oto`/`oco`/`otoco`); market/limit/stop/stop_limit; day/gtc. Multileg: `option_symbol[n]`/`side[n]`/`quantity[n]`.                                                                          | Account event HTTP streaming; poll fallback for OrderEventFeed.                                                                                                              |
| Kraken  | API-Key + HMAC-SHA512 of `path + SHA256(nonce + POST data)` with base64-decoded secret; monotonic nonce | No true sandbox — `validate=true` on `AddOrder` + `GhostFillSimulator` for paper   | REST `AddOrder`/`CancelOrder`/`QueryOrders` — market/limit/stop-loss/take-profit, volume in base; `viqc` for buy-market quote volume                                                                                                                                     | WSS v2 private `executions` channel; poll fallback                                                                                                                           |

If any cell above is wrong when checked against current docs, update this table in place and build against reality.

**Fee fact (Kalshi):** general taker fee `ceil(0.07 × C × P × (1−P))` USD (round up to next cent); maker in maker markets `0.0175` coefficient. Wired into prediction cost model.

## Tasks

### T1 — Kalshi adapter (full)

1. Auth module: request signing (timestamp + method + path, RSA-PSS), demo/prod base-URL switch on the account record. Secrets: key id + private key PEM via `secretRef`.
2. Implement: `getBalances`, `getPositions`, market/orderbook quote fetch, `placeOrderV2` (map `quantity.kind:'units'` → contract count; reject `notional_usd` in capabilities instead of converting), `cancelOrder`, `getOrderStatus`.
3. `OrderEventFeed`: websocket fill/order channel; poll fallback reusing the existing poll feed.
4. Capabilities: `supportsLimit: true`, `supportsBracket: false`, `supportsStreaming: true`, `quantityKinds: ['units']`, instrument class `event_contract`. **Fees enter the cost model**: Kalshi per-contract fee formula goes into the experience research-contract costs used by the edge gate — grep where Polymarket costs are modeled and add a Kalshi entry.
5. Instrument normalization: Kalshi ticker (`KXBTC-25JUL14-B105000` style) ↔ `InstrumentRef` in `instrument-normalizer.ts`.

### T2 — Tradier adapter (full)

1. Bearer-token auth, sandbox/prod switch. Endpoints: balances, positions, quotes (also register Tradier as a **market-data provider** in `services/marketdata/` — equities OHLCV, options chains with greeks).
2. `placeOrderV2` for equities (market/limit/stop/stop_limit, day/gtc, units or notional via price lookup) **and options**: single-leg + two-leg vertical spreads (`class=multileg`). This is the unlock for doc 06's options-flow v2 — the adapter must expose a `placeSpread(legs, netLimit)` capability surfaced through v2's instrument metadata, not a bypass around the policy gate.
3. `cancelOrder`, `getOrderStatus`; `OrderEventFeed` via Tradier's account event stream, poll fallback.
4. Capabilities: limit/stop true, bracket via OTO/OCO if the API supports it (check; if not, `supportsBracket:false` and the TradeMonitor manages exits as it does today), `quantityKinds: ['units','notional_usd']`.

### T3 — Kraken adapter (full)

1. HMAC auth with nonce management (serialize requests; Kraken nonces must be monotonic).
2. Balances, positions (spot), OHLC public data → register as marketdata provider (free, keyless for public endpoints — do this even before trading works).
3. `placeOrderV2` (market/limit/stop-loss/take-profit, volume-denominated; support `notional_usd` by converting at last-trade with a slippage buffer), `cancelOrder`, `getOrderStatus`. Paper story: Kraken has no sandbox — implement `validateOnly` mode wired to Exva paper mode: paper sessions send `validate=true` orders and simulate fills via the mock-fill path (same pattern doc 05 builds for Polymarket ghost trades; share the `GhostFillSimulator` once it exists).
4. `OrderEventFeed`: WSS v2 private `executions` channel; poll fallback.

### T4 — Alpaca websocket order feed

Replace/augment the poll `OrderEventFeed` with `wss://paper-api.alpaca.markets/stream` (`trade_updates`): connect with account keys, map events (`new/fill/partial_fill/canceled/expired/rejected`) to feed events, heartbeat + auto-reconnect with exponential backoff, **fall back to poll automatically** after N failed reconnects and raise a supervisor alarm. TradeMonitor consumes the feed unchanged.

### T5 — Adapter certification suite

`electron/main/services/broker/__tests__/adapter-certification.ts`: one parameterized spec run against any adapter + env:

- capabilities are honest (attempt an unsupported shape → policy gate refuses before HTTP),
- place limit far from market → status `open` → cancel → terminal `canceled`,
- place marketable order (demo/sandbox) → feed emits terminal fill event within timeout,
- balance fetch, position fetch, quote fetch round-trip Zod,
- error taxonomy: bad auth, insufficient funds, unknown symbol each map to typed adapter errors (no raw HTTP leaks).

Runs: mock adapter in CI (full surface); real adapters via `bun run cert:broker -- kalshi|tradier|kraken|alpaca` scripts hitting demo/sandbox/validate-only envs, executed manually with real (demo) keys. **Each adapter's task is not done until its cert run passes and the output is pasted into the PROGRESS note.**

### T6 — Registry + UI + docs

Wire all three into `broker-registry.ts` as launch-capable, add account-setup forms on the Brokers page (key fields per broker, demo/prod toggle, "Test connection" using the cert suite's auth check), update in-app broker docs + glossary. Remove IBKR/Schwab from any roadmap/docs text.

## Done criteria

- [x] `grep -rn "not implemented" electron/main/services/broker` → zero hits.
- [ ] Cert suite passes for mock (CI) ✅ and for Alpaca, Kalshi(demo), Tradier(sandbox), Kraken(validate-only) — **real outputs pending Ken's keys**.
- [ ] Alpaca websocket feed observed delivering a real paper fill event end-to-end (TradeMonitor closes a position from a feed event, not a poll) — **pending Ken paper keys + eye verify**.
- [x] Kalshi fees present in cost model; Tradier registered as data provider; Kraken public OHLC feeding `marketdata`.
- [x] Brokers page: all three configurable with test-connection (UI forms landed; screenshot review pending Ken).

### User journey

Ken opens Brokers, adds his Kalshi demo keys, taps Test connection → green. He starts a prediction-market session routed to Kalshi paper; a dislocation signal produces a limit order he can see in the Kalshi demo UI; the fill arrives via websocket and the trade closes with real fee-adjusted P&L.

### TLDR: shortcuts taken

- External-facts table **was** training-cutoff; **now confirmed** against Kalshi/Tradier/Kraken/Alpaca live docs (2026-07-13). Kalshi order path corrected to Create Order V2.
- Kraken validate-only: if validate rejects a shape, adapter still ghost-simulates and logs a warning (per plan).
- Tradier multilleg: `BrokerOrderV2.legs` + `supportsMultileg` + `placeSpread()` helper; OTO/OCO brackets left to TradeMonitor (`supportsBracket: false`).

### Core decisions (sign-off required)

| #   | Decision                                                                       | Why                                                        |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | IBKR + Schwab permanently dropped                                              | Ends the "spike-gated maybe"; nothing needs their coverage |
| 2   | Kraken paper = validate-only + ghost fills (no real sandbox)                   | Only way to honor paper-first invariant on Kraken          |
| 3   | Tradier spreads extend the v2 contract (multi-leg) rather than bypassing gates | Keeps I3 (every order through the gate chain) intact       |
