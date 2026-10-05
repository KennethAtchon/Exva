# Glossary

This list is closed. Adding a term means editing this file in the same change, with a one-line reason.

| Term         | Meaning                                                                                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account**  | A broker connection: an Alpaca **paper** account or the built-in **Simulator**.                                                                                                                            |
| **Strategy** | A TypeScript module (`engine/src/strategies/`) that looks at closed bars and returns buy, sell or hold with a reason. It has typed settings. The AI Analyst strategy asks the AI model.                     |
| **Bot**      | A strategy running with settings: symbols, timeframe, account, dollars per trade, risk limits. Started and stopped by you.                                                                                 |
| **Bar**      | One OHLCV candle for a symbol and timeframe (5m, 15m or 1h). Only closed bars are stored or used.                                                                                                          |
| **Decision** | The receipt for one check of one symbol on one closed bar: `BUY`, `SELL`, `HOLD`, `SKIP` or `ERROR`, with a reason code and the numbers behind it. Exactly one per bot, symbol and bar.                    |
| **Guard**    | A hard safety rule checked before any order (kill switch, max positions, daily loss limit…). A blocked trade becomes a `SKIP` decision with that guard's reason.                                          |
| **Order**    | A request sent to the broker, tracked from `pending_submit` to `filled`, `canceled`, `rejected` or `expired`.                                                                                             |
| **Fill**     | The broker executing all or part of an order.                                                                                                                                                              |
| **Position** | What a bot currently holds in a symbol. It is the bot's open Trade.                                                                                                                                        |
| **Trade**    | One round trip (entry fills to exit fills) with realized P&L.                                                                                                                                              |
| **Backtest** | Running a strategy over historical bars with the Simulator, through the same code that trades live.                                                                                                        |

## Decision reason codes

Defined once, with the text the UI shows, in `shared/reasons.ts`.

| Kind       | Codes                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BUY / SELL | `signal`, `stop_loss`, `take_profit`, `max_hold`                                                                                                                                                 |
| HOLD       | `no_signal`, `low_confidence`                                                                                                                                                                     |
| SKIP       | `kill_switch`, `paper_only`, `order_pending`, `already_in_position`, `no_position`, `position_gone`, `market_closed`, `check_overrun`, `symbol_owned_by_other_bot`, `max_positions`, `insufficient_buying_power`, `daily_loss_limit`, `ai_budget_exhausted`, `stale_data`, `insufficient_history` |
| ERROR      | `data_fetch_failed`, `broker_rejected`, `broker_unavailable`, `ai_failed`, `strategy_error`                                                                                                     |

## Words that are gone (and what replaced them)

| v1                                                                   | Now                         |
| -------------------------------------------------------------------- | --------------------------- |
| session                                                              | Bot                         |
| experience, template, preset, pipeline, prompt variant               | Strategy + bot settings     |
| instrument set, universe                                             | the bot's symbol list       |
| signal source, delivery, subscription, scan hit                      | (gone) the bot checks each closed bar |
| cycle, phase, stage, worker, engine, entry mode, finalizer, selector | `strategy.decide()`         |
| decision trace, execution step, funnel outcome                       | Decision                    |
| risk engine, policy gates, capital reservation, routing              | Guards + the bot's account  |
