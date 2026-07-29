# User-Blocked Recovery Checklist

> **Date:** 2026-07-29  
> **Purpose:** Everything in `docs/problems` that **code cannot finish** — you must do these in settings / broker / OS.  
> **Not in this doc:** unfinished code work (that is being fixed in the app).

Implements: docs/solutions/04-broker-account-setup.md, docs/solutions/07-ai-reliability-and-spend.md, docs/solutions/08-uptime-and-scan-cadence.md

---

## Quick status

| #   | Item                                           | Blocks                                       | Effort   | Do now?                 |
| --- | ---------------------------------------------- | -------------------------------------------- | -------- | ----------------------- |
| 1   | Install headless autostart                     | Missing first ~2h of every trading day       | 5 min    | **Yes**                 |
| 2   | Prefer direct Anthropic/OpenAI over OpenRouter | AI cycles fail ~67% under OpenRouter outages | 10 min   | **Yes**                 |
| 3   | Decide IEX vs SIP (Alpaca US stocks)           | Thin-name 404s / incomplete prints on IEX    | 5–15 min | Yes (decide)            |
| 4   | Alpaca paper keys present                      | Certification + live paper sessions          | 5 min    | If missing              |
| 5   | Alpaca options trading level (paper)           | Options OCC/multileg orders                  | 5 min    | Only if trading options |
| 6   | Tradier sandbox (optional)                     | Real multileg verticals                      | 15 min   | Optional                |
| 7   | Do **not** open Tradovate for Exva yet         | —                                            | —        | Skip                    |

---

## 1. Install headless autostart (U4)

**Why:** On 2026-07-27 the app booted 2h12m after the open. ~⅓ of the day was unreachable no matter how correct the code was.

**Steps:**

1. On the Mac that should run Exva overnight / before open, open Terminal.
2. From the Exva repo root:

```bash
bash scripts/headless/install-launchd.sh
```

3. Verify the agent loaded:

```bash
launchctl print "gui/$(id -u)/com.exva.headless" | head -20
```

4. Confirm it is writing logs:

```bash
tail -f ~/.exva/logs/headless.stdout.log
```

**Rules / caveats:**

- Runs at **login**, not cold boot. Machine asleep / logged out at 09:30 ET ⇒ Exva is not running.
- `KeepAlive` only restarts on **non-zero** exit. A clean quit stays down.
- Do not run GUI and headless owning sessions at once. Check:

```bash
cat ~/.exva/instance.lock
```

- Broker keys live in the app DB (Settings), not in the LaunchAgent plist. No secrets needed in the plist.

**Done when:** After a fresh login (or `launchctl kickstart`), headless starts before the equity open and sessions are active.

---

## 2. Prefer a reliable AI provider (U5 / U3 in solutions)

**Why:** OpenRouter failed most calls in a 15-minute window on July 27. Circuit breaking helps, but a dead primary still hurts until fallback.

**Steps:**

1. Open Exva → **Settings → AI / Providers**.
2. Add a **direct** Anthropic and/or OpenAI API key (not only OpenRouter).
3. For structured-output roles (forecast / decision / fundamental / review), set the **primary** route to Anthropic Sonnet (or OpenAI `gpt-4o`), and keep OpenRouter only as fallback if you want it.
4. Confirm a smoke call from Dev / cost panel succeeds against the direct provider.

**Env alternative (scripts / headless):**

```bash
# example — use whatever your Settings already store; prefer Settings over shell secrets
export ANTHROPIC_API_KEY=...
# or
export OPENAI_API_KEY=...
```

**Done when:** A prediction/fundamental worker completes against the direct provider with circuit closed.

---

## 3. Decide IEX vs SIP (U1)

**Why:** Alpaca paper stock data defaults to **IEX**. Thin names 404 / look dead. That is not “the market never traded.”

**Decision options:**

| Choice      | When                                    | Action                                                                                   |
| ----------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Stay on IEX | Liquid names only (SPY, QQQ, mega-caps) | No purchase. Accept IEX label in certification panel.                                    |
| Buy SIP     | Broader US equity / research parity     | Alpaca dashboard → market data subscription → SIP. Confirm Exva still shows feed source. |

**Steps if buying SIP:**

1. Log into [Alpaca](https://app.alpaca.markets).
2. Open market data subscriptions; enable **SIP** (or “unlimited” US equities as Alpaca names it).
3. Confirm paper keys still point at `https://paper-api.alpaca.markets`.
4. In Exva, start or resume its scheduled session; activation automatically provisions the pinned symbol/timeframe history.

**Done when:** You either (a) stay liquid-only on IEX with eyes open, or (b) SIP is active and a previously-404 symbol returns bars.

---

## 4. Alpaca paper keys

**Why:** Certification and paper sessions need a connected paper account.

**Steps:**

1. Alpaca → Paper → API keys → create key + secret.
2. Exva → **Settings → Accounts → Add Broker** → Alpaca → **paper**.
3. Paste key/secret. Never commit them to git or paste into docs.
4. Confirm base URL is `https://paper-api.alpaca.markets`.
5. Optional env for scripts (unify on these names):

```bash
export ALPACA_API_KEY=...
export ALPACA_SECRET_KEY=...
```

6. Prove the order path when the regular session is open:

```bash
bun run prove -- --mode=certification
# then audit:
bun run prove -- --mode=alpaca
```

**Done when:** One `$10` SPY round-trip shows correlated IDs in Exva and Alpaca.

---

## 5. Alpaca options level (only if you want options live-paper)

**Why:** Pipeline can compose chain → OCC → vertical. Account still needs options permission.

**Steps:**

1. Alpaca paper account → enable **options trading** / set options level (Level 2+ for long verticals as Alpaca requires).
2. Confirm `options_approved_level` / buying power in account checks (Settings or cert scripts).
3. Prefer **Tradier sandbox** for true multileg if you have it; Alpaca path may fall back to single OCC leg when multileg is unsupported.
4. Assign `OPTIONS-INTEGRATION-SENTINEL` / `options-flow-edge` to the paper options-capable account.

**Done when:** A paper options order (vertical or single OCC) opens and closes with correlated IDs.

---

## 6. Tradier sandbox (optional)

**Why:** Best path for `placeSpread` / multileg verticals today.

**Steps:**

1. Create Tradier sandbox account + token when you are ready to certify options.
2. Exva → Settings → Add Broker → Tradier → sandbox credentials.
3. Route options sentinel to that account.
4. Do **not** treat Alpaca underlying-stock scans as options-class proof.

---

## 7. Futures / Tradovate — do nothing yet

**Why:** Tradovate adapter is **quarantined** (throws; no fake $250k). Opening a real Tradovate account does not help Exva today.

**What to do instead:**

1. Add a **Mock paper** broker in Settings (no credentials).
2. Assign it only to `FUTURES-INTEGRATION-SENTINEL`.
3. Read Mock results as **local simulation**, never Tradovate proof.
4. Real Tradovate partner integration is a separate project.

---

## Suggested order for today

```text
1. install-launchd.sh
2. Direct Anthropic/OpenAI key as primary
3. Confirm Alpaca paper keys
4. Decide IEX vs SIP
5. (Optional) options level / Tradier
6. During regular hours: bun run prove -- --mode=certification
```

## What “fixed” looks like after these steps

- App is up before the equity open (uptime coverage ≥ 90% before you trust setup-rate claims).
- AI workers degrade to typed skips / one fallback hop instead of session death.
- Starting or resuming a session automatically provisions every scheduled symbol/timeframe to the strategy's required depth before preflight.
- Certification proves the order path once; then primary sessions can be judged on real funnels.
