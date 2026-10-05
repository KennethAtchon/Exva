# Exva

A desktop app that runs **paper-trading bots** on your Alpaca account around the clock, shows what every
bot is doing and **why it did or didn't trade**, and lets you test any strategy on history before you
run it.

- **Bots:** EMA Crossover, RSI Dip Buyer, Donchian Breakout, AI Analyst (DeepSeek V4.1 Flash), and a
  Heartbeat test bot that proves the whole pipeline in minutes.
- **Receipts:** every time a bar closes, each bot records one decision per symbol: BUY, SELL, HOLD,
  SKIP or ERROR, with the numbers it compared ("RSI(2) 11.8, buys below 10").
- **Lab:** backtests run through the exact code that trades live: dollar P&L, equity and drawdown,
  trades on a chart, and "create bot from this run".
- **Paper only.** Exva cannot place live orders.

## Run it

Requirements: macOS or Linux, [Bun](https://bun.sh) 1.3+, and an [Alpaca](https://alpaca.markets)
account for its free paper-trading keys (crypto works with the built-in simulator even without keys).

```bash
bun install
bun run start        # builds the UI and opens the desktop app, which starts the engine
```

First run walks you through: Alpaca paper keys (or the simulator) → optional DeepSeek key → a
Heartbeat test bot (first trade within ~10 minutes) → starter bots.

Other ways to run:

```bash
bun run engine       # headless engine; open the printed http://127.0.0.1:7420/?token=… link in a browser
bun run demo         # demo: simulator + synthetic market + a clock running 60× fast; no keys needed
```

## Command line

```bash
bun run exva status                          # health and today's numbers for every bot
bun run exva decisions --bot "ETF Dip Buyer" # the receipts, newest first
bun run exva trades
bun run exva doctor                          # checks keys, broker and data; places nothing
bun run exva paper-smoke                     # one real $10 BTC/USD paper round trip
bun run exva backtest ema-cross BTC/USD,ETH/USD 15m --days 90
bun run exva account add-alpaca --key PK… --secret …
bun run exva bot create --strategy rsi-dip --symbols SPY,QQQ --timeframe 15m --start
bun run exva kill        # kill switch on (bun run exva kill off to resume)
```

## When a bot doesn't trade

Open the bot. The **Why no trades today?** card counts every check by reason and shows the closest the
bot came to trading. Common answers:

- **HOLD, no signal:** working as designed, the market didn't meet the condition. Try looser settings in the Lab.
- **Sleeping until 9:30 ET:** stock symbols only trade during market hours. Nights and weekends are crypto-only.
- **SKIP, stale data:** the data feed had no bar (common for thin stocks on the free IEX feed).
- **ERROR:** the message says what failed and what to do.
- **"Exva wasn't running from 02:10 to 02:40":** the computer slept. A closed laptop lid sleeps it.

## Where things live

- `~/.exva/exva.db`: the database (bots, decisions, orders, trades, backtests).
- `~/.exva/secrets.json`: API keys (permissions 0600, never in the database or the repo).
- `~/.exva/engine.json`: how the desktop app and CLI find a running engine.

## For developers

```bash
bun run verify       # typecheck, lint, 53 engine tests, size budgets, UI build
bun run test:e2e     # Playwright against a demo engine
bun run dev:ui       # Vite with hot reload (EXVA_TOKEN=… points it at a running engine)
```

Read [`CLAUDE.md`](CLAUDE.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/GLOSSARY.md`](docs/GLOSSARY.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md) before changing
anything. The previous version (v1) is in git history at commit `b6d30fd`.
