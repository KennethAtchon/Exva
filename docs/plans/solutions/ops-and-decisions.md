# Solutions — Ops & Decisions (non-code)

Code gaps from the former `docs/solutions/` set are implemented in the app.
This file is the single checklist for work **code cannot finish**.

Step-by-step setup lives in [`../../USER_BLOCKED_CHECKLIST.md`](../../USER_BLOCKED_CHECKLIST.md).
Use that for install/key/feed procedures; keep acceptance IDs here.

---

## Acceptance still open

### 01 — Paper certification proof

- [ ] Arm one `$10` SPY paper round trip during regular hours.
- [ ] Record Exva run ID, trade ID, entry/exit client IDs, broker IDs.
- [ ] Confirm Exva and Alpaca flat with correlated IDs.
- [ ] Run `bun run prove -- --mode=alpaca` against that DB; audit passes.
- [ ] Save receipt under `docs/reviews/` stating paper-sim limitations (“integration certified,” not strategy validated).

### 04 / 08 — Autostart & credentials

- [ ] Install LaunchAgent: `bash scripts/headless/install-launchd.sh` and verify
      (`launchctl print "gui/$(id -u)/com.exva.headless" | head -20`).
- [ ] Confirm headless reads broker credentials from Settings DB (plist has no secrets).
- [ ] Soak-test: GUI/headless instance lock never dual-owns sessions.
- [ ] Add Mock paper broker in Settings for `FUTURES-INTEGRATION-SENTINEL` only.

### AI primary route (U3)

- [ ] Set direct Anthropic or OpenAI as primary for structured-output roles;
      OpenRouter as fallback only. Configure keys in Settings.

### Market data feed (U1)

- [ ] Decide IEX vs paid SIP for strategy research; accept labeled feed on bars/quotes.

### 06 — Universe after measured rate

- [ ] Confirm every default-matrix scheduled instrument stores ≥ `preferredContextBars` after activate.
- [ ] After measured setup rate on current universe (SPY/QQQ), expand to **20–25**
      liquidity-screened names in one documented set revision.
- [ ] Every added symbol passes EDGAR-style tradability (listed, price floor, dollar-volume floor).

### 07 — Operational AI day

- [ ] One full paper day with zero untyped AI exceptions.

### 10 — Options / futures ops

- [ ] Paper multi-leg round trip with correlated IDs before labeling options `available`.
- [ ] Do **not** create Tradier sandbox until a second options venue is actually needed.
- [ ] Do **not** open/fund Tradovate for Exva until a real futures adapter exists.
- [ ] Product decision: real Tradovate partner integration vs permanent Mock sentinel.

### Funnel acceptance (ops)

- [ ] Planted scheduled fact traverses real cycle → risk → routed order → fill → visible
      certification-origin trade in paper mode (after code path is green).

---

## Open questions

- Cause of all sessions stopping at `04:05Z` on 2026-07-27 — process shutdown is the leading
  hypothesis; `unplannedStops` should record this going forward.
- Whether headless LaunchAgent can use Settings-stored broker credentials has been reasoned, not
  soak-tested.
- Actionable EDGAR 8-K prevalence in Exva’s universe is unmeasured; measure via opportunity-rate /
  EDGAR gate funnel after early filters.
- IEX vs SIP purchase decision for research/live-paper comparison.
- Whether futures are worth a real Tradovate partner integration vs permanent Mock sentinel.

---

## Explicitly deferred (not in this code pass)

- Full Tradovate venue adapter (Tracer B).
- 20–25 liquid-equity universe seed until opportunity-rate gate is measured.
- Polymarket live wallet/allowance/signer work (paper ghost path enough for now).
- Resurrecting `rules-unusual-volume` or new alpha experiences before Lab research-contract promotion passes.
