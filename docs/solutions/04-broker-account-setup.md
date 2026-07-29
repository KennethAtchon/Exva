# Solution 04 - Broker Account and Capability Setup

> **Purpose:** Separate actions Kenneth can perform now from integrations that account creation cannot
> repair.

Implements: docs/engineering/CODING_GUIDELINES.md

## Do This First (Five Minutes, No Code)

Two user actions recover more lost opportunity than any code change in this program, and neither
depends on any other work.

**1. Install the autostart agent.** On July 27 the app booted 2h12m after the open. The repository has
shipped a LaunchAgent installer the entire time and no document has ever mentioned it:

```bash
bash scripts/headless/install-launchd.sh
launchctl print "gui/$(id -u)/com.exva.headless" | head -20
tail -f ~/.exva/logs/headless.stdout.log
```

Caveats, limits, and verification steps are in
[Solution 08 Workstream 1](./08-uptime-and-scan-cadence.md). The short version: it runs at **login**,
not at boot, and `scripts/headless/run.sh` already refuses to start when a GUI instance holds the lock.

**2. Decide the AI provider route.** OpenRouter failed 67% of calls in a 15-minute window on July 27
and Exva has no fallback route (verified: no fallback exists anywhere in `services/llm/`). Adding a
direct Anthropic or OpenAI key as the primary route for structured-output workers is a settings change.
See [Solution 07 Workstream 2](./07-ai-reliability-and-spend.md).

Neither action fixes a code defect. Both stop the code defects from being measured against a system
that was absent or starved.

## Setup Matrix

| Venue                | User action now                                                                                                                        | Code action required                                                                      | Use now                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| Alpaca paper stocks  | No action proved missing in the July 27 run; for a fresh install, add paper keys in Settings or `ALPACA_API_KEY` + `ALPACA_SECRET_KEY` | Account/asset/feed/order capability probes and lifecycle reconciliation                   | Yes, certification and liquid rules  |
| Alpaca paper crypto  | No current action; use the already connected paper account                                                                             | Preserve crypto route and implement truthful close lifecycle                              | Yes, breakout after freshness repair |
| Alpaca paper options | No separate paper approval request                                                                                                     | Chain -> OCC -> whole contract -> buying power -> order -> close composition              | Sentinel only                        |
| Alpaca live options  | Obtain approval in Alpaca UI                                                                                                           | Check approved/enabled level and options buying power                                     | No live use                          |
| Tradier sandbox      | Defer account/token creation until the options tracer reaches broker certification                                                     | Compose chain/vertical/multi-leg/position/close path                                      | No current use                       |
| Tradovate            | Do not open/fund for Exva yet                                                                                                          | Replace simulated adapter with partner auth, market data, orders, fills, positions, close | No; use Mock sentinel                |
| Mock futures         | Add paper Mock account in Settings; no credentials                                                                                     | Keep clearly local/non-external                                                           | Yes, lifecycle sentinel only         |
| Polymarket paper     | None; `seed-polymarket-paper` is credential-free                                                                                       | Fix event catch-up and model output                                                       | Yes after repair                     |
| Polymarket live      | Defer                                                                                                                                  | Wallet type, signer/account wallet, allowance, orders, fills, positions, redeem/close     | No live use                          |

## Alpaca Paper Setup

The July 27 runtime already had a connected `seed-alpaca-paper` account and a `$100,000` paper balance.
The following steps are installation/recovery instructions, not a diagnosed missing action for that
run.

1. Create or open an Alpaca paper account.
2. Generate paper-specific API keys.
3. In Exva Settings -> Accounts -> Add Broker, choose Alpaca and paper mode.
4. Enter key and secret; never paste them into docs or source.
5. Run connection and account-state checks.
6. Confirm account base URL is `https://paper-api.alpaca.markets`.
7. Confirm supported classes and current data entitlement.
8. Assign the account to the certification and repaired rules sessions with conservative allocation.

The seed path expects `ALPACA_SECRET_KEY`, as do `electron/main/config/env.ts:71` and
`scripts/test/prove-trade-loop.ts:84`. Only `scripts/broker/cert-broker.ts:128` expects
`ALPACA_API_SECRET`. Unify on `ALPACA_SECRET_KEY` — it is the majority and the one the app itself
reads — before relying on certification scripts.

### IEX Versus SIP

Alpaca paper-only users receive IEX stock data by default. IEX is one exchange; SIP consolidates US
exchanges. Exva must display which feed produced bars and quotes.

Decision:

- Initial certification: IEX is sufficient for liquid SPY integration proof.
- Strategy research/live-paper comparison: choose whether to buy SIP entitlement or explicitly accept
  and label IEX-only coverage.
- Never interpret a missing IEX print on an illiquid name as proof the security does not trade anywhere.

## Alpaca Options

Current Alpaca documentation says paper options are enabled by default. Live options require approval.
Code must inspect:

```text
options_approved_level
options_trading_level
options_buying_power
contract active/tradable status
whole-contract quantity
```

No account setting can fix the current Exva path where the scheduled producer emits nothing and no
OCC contract/legs reach placement.

## Tradier Sandbox

Tradier documents paper sandbox access and separate sandbox tokens. It supports options chains and
multi-leg orders, but Kenneth should not create credentials merely to populate an unreachable
sentinel. When the options implementation reaches broker certification, use these setup steps:

1. Create a Tradier account.
2. Generate a sandbox token at `https://web.tradier.com/user/api`.
3. Enter sandbox token and account ID in Exva Settings.
4. Run account balance and option-chain probes.
5. Keep the account assigned only to the options sentinel until production composes spread preview,
   placement, fills, positions, and close.

A green connection does not prove options level or end-to-end multi-leg lifecycle.

## Futures

The current Tradovate adapter is a development simulator. It does not call official demo/live/market-
data environments and cannot provide a real futures lifecycle.

Immediate setup:

1. Add a paper Mock broker in Settings.
2. Assign it only to `FUTURES-INTEGRATION-SENTINEL`.
3. Label results local simulation, not Tradovate proof.

Real Tradovate work is a separate project requiring API key/CID access, access-token renewal, market-
data WebSocket charts/quotes, contract lookup, order/fill sync, positions, liquidation, reconnection,
and conformance tests.

## Polymarket

Paper mode uses public Gamma/CLOB data and local ghost fills. It needs no wallet credentials.

Live mode must not launch until Exva supports current wallet types, signer versus account wallet,
allowances for standard/neg-risk exchanges, token-specific sell allowance, signed orders, fill ledger,
aggregate positions, and resolution/redeem lifecycle. The current hard-coded signature type `0` is not
valid for every current account type.

## Capability Certification

A broker is usable for a class only when all rows pass:

| Capability        | Proof                                                            |
| ----------------- | ---------------------------------------------------------------- |
| Authentication    | Real account endpoint responds                                   |
| Account state     | Active and not trading-blocked                                   |
| Market data       | Current quote/bar for representative asset                       |
| Asset eligibility | Active/tradable and correct class                                |
| Buying power      | Class-specific available amount                                  |
| Place             | Minimum paper order accepted                                     |
| Fill              | Partial/full events reconciled                                   |
| Positions         | Broker position matches Exva                                     |
| Close             | Filled position is actually flattened, not merely order-canceled |
| Restart           | Open order/position is recovered                                 |

Static `supportedInstrumentClasses` and `launchCapable` are routing hints, not certification.
