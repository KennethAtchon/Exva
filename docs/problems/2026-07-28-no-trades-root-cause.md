# Superseded Draft: Why Exva Is Not Trading

> **Status:** This staged draft used a future-dated filename. It was superseded during the 2026-07-27
> investigation by [`2026-07-27-no-trades-root-cause.md`](./2026-07-27-no-trades-root-cause.md).
>
> This earlier draft contains claims that did not survive code and runtime verification, including
> “every layer works,” a probability estimate extrapolated from one invalidly passing backtest, an
> incorrect z-score bound, and an incomplete account/setup diagnosis. Keep it only as investigation
> history. Do not implement from it.

# Why Exva Is Not Trading — Root Cause Analysis

**Date:** 2026-07-28
**Evidence:** `~/.exva/logs/exva-2026-07-27.log` (11,232 lines, 15:42Z Mon → 04:05Z Tue), production DB
`~/Library/Application Support/exva/exva.db`, and the strategy/executor source at commit `78d59df`.
**Scope:** Monday 2026-07-27, the full-day run referenced in `docs/TODO.md`.

---

## 0. The one-paragraph answer

**The system is not broken in the way you think it is. It is starved.**

Every layer works: the scheduler fires, the scans run, the LLM pipeline completes, Alpaca is
connected with a live $100,000 paper balance, and the backtest engine produces a *passing* verdict.
What does not exist is **enough opportunity for a trade to be statistically possible on a single
day**. Your own validated backtest says the mean-reversion strategy trades **15 times in 5 months on
one symbol**. You ran two symbols for four hours. The mathematically expected number of trades on
Monday was **~0.3**. You got 0. That is the system working as configured.

Layered on top of that are **five genuine bugs** and **two hard blockers** that would have suppressed
trades even if the universe were large enough. Those are itemized below and are, as you said, mine.

**The honest split: ~85% system/design problems, ~15% account problems.** But the account problems
are *not* the ones you thought — see §6, futures is a code stub, not a missing account.

---

## 1. What actually happened on Monday, minute by minute

| Time (UTC) | Time (ET) | Event |
|---|---|---|
| 15:42:07 | 11:42 AM | App boots. DB backup, migration, broker seeding. **Market already open 2h12m.** |
| 15:50:41 | 11:50 AM | Rules sessions report `waiting_scan_tick`. |
| 16:00:30 | 12:00 PM | First `execution step failed`. |
| 16:20:42 | 12:20 PM | All 4 rules sessions flagged `no_signal_stale` — "no input consumed, no execution cycle in 12h". |
| 16:23:11 | 12:23 PM | First `pHat` schema crash (Polymarket path). |
| 17:33:51 | 1:33 PM | **Trade #1 written: CHMG — status `no_trade`.** |
| 17:39:34 | 1:39 PM | **Trade #2 written: PEBO — status `no_trade`.** |
| 19:47–19:57 | 3:47–3:57 PM | Alpaca 404s on `OYCG`, `GRUSF` — OTC tickers with no trades. |
| 19:49:37 | 3:49 PM | Last productive rules scan. SPY/QQQ → `no_setup`. |
| 19:56:43 | 3:56 PM | OpenRouter error rate hits **67% over 15m (4/6 calls)**. |
| 20:00:43 | 4:00 PM | Market closes. Correctly detected. |
| 20:02:48 | 4:02 PM | Market-hours filter begins excluding instruments — **correctly, after the close.** |
| 20:35:16 | 4:35 PM | Last `pHat` crash. Polymarket session → `attention_required`. |
| 04:05:30 | 12:05 AM | All rules sessions auto-stopped. |

### The critical correction

The log is full of 115 × `Signal delivery queued; market is closed` and hundreds of
`exchange_closed` exclusions. **Every one of these is timestamped 20:02Z or later — after the 16:00
ET close.** The market-hours filter did not block you during trading hours. It is not the bug.
Previous debugging sessions almost certainly saw this wall of `exchange_closed` noise and blamed it.
It is a red herring, and it is the single biggest reason this has taken so many iterations.

**The real trading window was 15:42Z–20:00Z — 4 hours 18 minutes.** Everything that matters happened
there.

---

## 2. The universe is seven instruments

```
liquid-us-etfs           SPY, QQQ        → 2 mean-reversion sessions
major-crypto             BTC-USD         → 1 breakout session
options-flow-stocks      AAPL, NVDA      → 1 options session
commodities-front-month  GC, CL          → futures, no session, no broker
```

Seven symbols. Four of them (AAPL, NVDA, GC, CL) never produced a single evaluable signal all day.
The effective tradeable universe on Monday was **three instruments**: SPY, QQQ, BTC-USD.

This is the dominant cause. A strategy that fires on 2% of bars needs either many symbols or many
days. You have neither.

---

## 3. The market data table is nearly empty

```sql
symbol   timeframe   bars   range
SPY      1h          858    2024-01-02 → 2026-07-27   ← the only real history
BTC-USD  4h           22    2026-07-24 → 2026-07-27
QQQ      1h           21    2026-07-23 → 2026-07-27
AAPL     1d            1    2026-07-27
NVDA     1d            1    2026-07-27
```

**QQQ has 21 bars. AAPL and NVDA have one bar each.** You cannot compute a 20-period statistic on one
bar. The options-flow session was structurally incapable of producing a signal all day.

### Why the data is empty — the executor asks for the bare minimum

`electron/main/services/scheduling/scheduled-strategy-executor.ts:218-227`:

```ts
const barsRequired = strategy.warmupBars;
bars = await getBars(
  displaySymbol,
  plan.analysisTimeframe,
  strategy.warmupBars + 1,   // ← asks for exactly warmup + 1. Never more.
  instrumentClass,
  { subscriptionIds: plan.subscriptionIds },
);
```

SPY has **858 bars sitting in the database**. The strategy is handed **21**. The system deliberately
starves its own indicators of history on every single evaluation. There is no warmup buffer, no
margin, no context. This is the highest-leverage single-line bug in the codebase.

---

## 4. `requiredBarCount` is declared nine times and read zero times

Every strategy definition declares a bar requirement:

```
breakout.ts                requiredBarCount: 50
mean-reversion.ts          requiredBarCount: 50
trend-following.ts         requiredBarCount: 50
unusual-volume.ts          requiredBarCount: 25
ny-range-breakout.ts       requiredBarCount: 289
options-flow.ts            requiredBarCount: 0
funding-basis.ts           requiredBarCount: 0
form4-insider-cluster.ts   requiredBarCount: 0
cross-venue-dislocation.ts requiredBarCount: 0
```

`grep -rn "requiredBarCount" electron src` returns **only the declarations and the type definition.
Nothing ever reads the field.** The executor uses `strategy.warmupBars` instead.

The consequence is visible in the persisted scan summaries:

```json
{"symbol":"SPY","kind":"no_setup","barsActual":21,"barsRequired":20}
{"symbol":"BTC-USD","kind":"no_setup","barsActual":22,"barsRequired":21}
{"symbol":"AAPL","kind":"no_setup","barsActual":1,"barsRequired":0}
```

The definition says mean-reversion needs 50 bars. **It ran on 21.** The declared contract of the
system is fiction. Any reasoning you or an AI agent did based on `requiredBarCount: 50` was reasoning
about code that does not execute.

---

## 5. The z-score is mathematically self-defeating

`electron/main/services/signals/strategy/mean-reversion-signal.ts:40-46`:

```ts
const window = closes.slice(-MEAN_REVERSION_WARMUP_BARS);   // last 20 — INCLUDES current bar
const mean = window.reduce((a, b) => a + b, 0) / window.length;
const variance = window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window.length;
const std = Math.sqrt(variance) || 1;
const last = closes[closes.length - 1] ?? mean;
const zScore = (last - mean) / std;                          // current bar scored against itself
```

The bar being tested is included in the mean and standard deviation it is measured against. This
drags the mean toward the current price and inflates the deviation — both shrink `|z|`.

For a window of n, this **hard-caps** the achievable z-score at `(n-1)/√n`. For n=20 that is **4.249**.

I measured it on your real 858 SPY 1h bars:

```
samples: 839
SELF-INCLUSIVE (current code): min z = -3.325   max|z| = 4.354
  fires at z <= -2:  43  (5.13%)
PRIOR-WINDOW (correct):        min z = -5.327   max|z| = 89.905
  fires at z <= -2:  67  (7.99%)
```

**The bug suppresses 36% of valid entry signals** and makes extreme dislocations — exactly the trades
mean-reversion exists to capture — literally unrepresentable. A genuine 8-sigma crash reads as −3.3.

The fix is to compute the baseline from the prior N bars and score the current bar against it.

Note: `breakout-signal.ts` does this **correctly** (`bars.slice(-lookback - 1, -1)` excludes the
current bar). Only mean-reversion is wrong.

---

## 6. Futures cannot trade — and it is not your account

You assumed you hadn't set up a futures account. The truth is worse and it's on the code side.
`electron/main/services/broker/adapters/tradovate-adapter.ts:33-39`, the file's own comment:

```ts
/**
 * Not launch-capable: placeOrder/cancelOrder/closeOrder are stubbed and
 * getPositions returns []. Live-readiness gate must block live sessions
 * using this adapter until real Tradovate integration is built.
 */
readonly launchCapable = false;
```

139 lines, versus 1,421 for the Alpaca adapter. `testConnection()` returns a **hardcoded fake
balance of 250000** with the message "simulated connectivity". Opening a Tradovate account today
would change nothing — the order path does not exist.

Only two brokers are seeded (`electron/main/db/seed.ts`):

```
seed-alpaca-paper       alpaca      ["stock","crypto","options"]   $100,000  ✅ live, working
seed-polymarket-paper   polymarket  ["prediction_market"]          $100,000  ✅ seeded
```

`GC` and `CL` sit in an instrument set with no session, no broker, and no working adapter.

---

## 7. EDGAR: the pipeline works, the AI vetoes everything

**All 4 rows in `trades` have `status = 'no_trade'`.** The pipeline ran end-to-end — instrument
selected, research done, cost incurred (`ai_cost_usd` 0.0058–0.0064), confidence scored (0.55, 0.75)
— and then the adversarial review stage killed it. Verbatim from the log:

> **PEBO** — "Adversarial review skipped: PEBO's earnings beat is stale (6 days old, stock already up
> ~4%). The EDGAR catalyst preset requires document-first entry timing — that window has closed."

> **GRUSF** — "The EDGAR catalyst is stale (~3–4 months old), fully priced, and offers zero
> information edge. Combined with extreme illiquidity (~17,800 shares/day), OTC micro-cap structure…"

> **OYCG** — "No EDGAR filings exist… No quote data (Alpaca 404), no OHLCV bars, and TradingView
> reports 'No trades' — the instrument is illiquid and untradeable… a July 2023 startup headquartered
> in the Dominican Republic trading OTC."

**The reviewer is right every time.** These are genuinely untradeable instruments. The failure is
upstream: the selector is feeding Dominican Republic OTC shells into a pipeline that costs real money
per evaluation, and the veto happens at the *last* stage after all the spend.

There is no liquidity floor, no price floor, no exchange filter, no average-volume gate on the EDGAR
selector. It takes whatever 8-K arrives. The Alpaca 404s (`no trade found for OYCG`) are the market
data layer confirming these tickers do not trade.

Also note `feed=iex` in the 404 URLs — you are on Alpaca's free IEX feed, which covers a fraction of
US volume. Thin names return 404 even when they are technically tradeable.

Session state: `selector_rejecting_all` — "Last 3 selector cycles produced 0 accepted candidates".

---

## 8. The `pHat` schema crash kills Polymarket — 62 times

`electron/shared/ai/prediction-research.ts:33`:

```ts
export const predictionForecastSchema = z.object({
  pHat: z.number().min(0).max(1),          // ← required, no default, no repair
  uncertaintyBps: z.number().min(0).default(1500),
  ...
```

Every other field has a `.default()`. `pHat` does not. When the LLM omits it, the entire
`fundamental` phase throws:

```
Stage 'workers' in phase 'fundamental' failed worker execution. Rejections: [
  { "code": "invalid_type", "expected": "number", "received": "undefined", "path": ["pHat"] }]
```

**62 occurrences.** This is what put `POLYMARKET-DISCOVERY-RESOLUTION` into `attention_required` —
the "polymarket session being broken for some reason idk" from your TODO. That is the reason.

Contributing cause: OpenRouter was failing **67% of calls in a 15-minute window**
(`openrouter provider request failed after 5 attempt(s) (timeout)`, 146 × `provider request attempt
failed`). Truncated/empty responses hit a schema with no tolerance and no repair pass, and the whole
phase dies rather than degrading.

Related crashes in the same run:
- `Cannot destructure property 'rawSummary' of 'signal' as it is undefined` — 6× (null-safety bug,
  `review` phase)
- `executionStrategy`, `action`, `confidence`, `entryTiming`, `reasoning` all `undefined` — 2×
  (the model returned an empty object; same no-repair failure mode)

**Pipeline health: 78 of 260 execution steps failed (30%).** 71 failures inside the 4-hour trading
window alone.

---

## 9. The math: zero trades was the expected outcome

Your own backtest run (`backtest_runs`, verdict **`pass`**):

```json
{"strategyId":"mean-reversion","symbols":["SPY"],"timeframe":"1h",
 "window":"2024-01-01 → 2024-06-01",
 "tradeCount":15,"expectancyBps":79.86,"sharpe":0.797,"maxDrawdownPct":1.52,
 "folds":[{"tradeCount":5,"winRate":1.0},{"tradeCount":7,"winRate":0.714},{"tradeCount":3,"winRate":0.667}]}
```

**15 trades in 5 months on one symbol.** That is ~683 hourly bars → a **2.2% per-bar entry rate**.

Monday's actual opportunity:

| Session | Symbols | New bars in the 4.3h window | Entry rate | Expected trades |
|---|---|---|---|---|
| ETF-REVERSION ×2 | SPY, QQQ | ~4 × 1h bars each | 2.2% | **0.18** |
| CRYPTO-BREAKOUT | BTC-USD | ~3 × 4h bars (12h uptime) | ~5% | **0.15** |
| OPTIONS-FLOW | AAPL, NVDA | 1 bar total, warmup 0 | n/a | **0.00** |
| **Total** | | | | **≈ 0.33** |

**P(zero trades) ≈ e^−0.33 ≈ 72%.**

The most likely outcome of Monday — with a perfectly functioning system, no bugs, everything
connected — was **zero trades**. You then also had a 36% signal suppression from the z-score bug and
a 30% pipeline failure rate on top of that, pushing the real expectation to roughly **0.15**, i.e.
**~86% chance of seeing nothing.**

This is the thing no previous iteration told you. You have been debugging a system whose configured
behavior is to trade about **three times a month**, while expecting to watch trades appear on a
dashboard within hours.

---

## 10. The Lab shows nothing because nothing was built

`src/hubs/panels/backtest-lab-panel.tsx` — 449 lines. It renders:

```tsx
{run.experienceId} · {run.verdict}
{String(metrics.tradeCount ?? "—")} · sharpe {String(metrics.sharpe ?? "—")}
```

That is the entire results surface: a line of text.

`grep -rn "recharts|lightweight-charts|d3|visx" package.json` → **no matches. There is no charting
library in the project at all.**

Confirmed missing, exactly as you described:
- No equity curve
- No P&L in dollars (only `expectancyBps`)
- No trade markers on a price chart
- No entry/exit visualization
- No drawdown plot
- No per-fold breakdown UI (the data exists in `metrics_json` and is discarded)

The backtest **engine** is genuinely good — walk-forward folds, cost model, per-fold win rates,
Sharpe, drawdown, a pass/fail verdict. It computed all of this and then threw it away because the
frontend renders two numbers.

---

## 11. Problem inventory

### YOURS (~15%) — account/config, real but small

| # | Problem | Reality check |
|---|---|---|
| U1 | Alpaca on free **IEX feed** | Causes 404s on thin names. SIP subscription (~$99/mo) fixes; or just stop trading illiquid tickers (free). |
| U2 | No Tradovate/futures account | **Blocked by U-code anyway** — adapter is a stub. Do not spend money here yet. |
| U3 | No options-approved account | Alpaca paper supports options but the account needs the options level enabled. |
| U4 | App started 2h12m after the open | Cost ~⅓ of Monday's opportunity. Needs autostart. |
| U5 | OpenRouter reliability | 67% error rate in a 15m window. A direct Anthropic/OpenAI key would be far more stable. |

### MINE (~85%) — code and design

| # | Problem | Severity | Location |
|---|---|---|---|
| S1 | Universe is 7 instruments; 3 tradeable | **CRITICAL** | `instrument_set_members` |
| S2 | Executor requests only `warmupBars + 1` bars | **CRITICAL** | `scheduled-strategy-executor.ts:218` |
| S3 | No historical backfill (QQQ 21 bars, AAPL 1 bar) | **CRITICAL** | market data ingest |
| S4 | Expected trade rate ~3/month vs. expectation of "today" | **CRITICAL** | design mismatch |
| S5 | `requiredBarCount` declared 9×, read 0× | HIGH | `strategy-definition-registry.ts` |
| S6 | z-score self-inclusion caps \|z\| at 4.25, suppresses 36% of signals | HIGH | `mean-reversion-signal.ts:40` |
| S7 | `pHat` required with no default/repair — 62 crashes | HIGH | `prediction-research.ts:33` |
| S8 | Tradovate adapter is a stub with a fake balance | HIGH | `tradovate-adapter.ts` |
| S9 | EDGAR selector has no liquidity/price/exchange floor | HIGH | selector stage |
| S10 | Veto happens after full LLM spend, not before | HIGH | pipeline ordering |
| S11 | 30% execution-step failure rate | HIGH | pipeline runtime |
| S12 | Lab has no charts, no P&L, no equity curve | HIGH | `backtest-lab-panel.tsx` |
| S13 | `rawSummary` destructure of undefined | MEDIUM | review phase |
| S14 | `exchange_closed` log spam buries real failures | MEDIUM | logging |
| S15 | No "why no trade today" diagnostic surface | MEDIUM | — |
| S16 | Sessions auto-stop on `no_signal_stale` after 12h | MEDIUM | activity tracker |
| S17 | Alpha scan `arm()` waits a full interval before first tick | LOW | `alpha-source-scan-service.ts:88` |

---

## 12. What this means

Stop debugging. Nothing here is a mystery bug hiding in a log. The system is a well-built machine
pointed at an empty room:

1. **Three tradeable instruments** with almost no price history,
2. running strategies that fire on **~2% of bars**,
3. for **four hours**,
4. with a **36% signal suppression bug**,
5. and a **30% pipeline failure rate**,
6. behind an **AI veto** that correctly rejects the garbage the selector feeds it.

To see trades today you do not need better strategies. You need **more instruments, more bars, looser
gates, and a deterministic path to the broker that no LLM can veto.**

The solutions are in `docs/solutions/`. Start with `01-prove-the-broker-works.md` — it puts a real
fill on your Alpaca dashboard in under an hour, with zero AI in the path, so you have a known-good
baseline before anything else is touched.
