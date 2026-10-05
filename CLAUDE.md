# Exva: rules for AI agents

Exva is a desktop app that runs paper-trading bots on Alpaca and shows why every bot did or didn't
trade. Read `docs/GLOSSARY.md` and `docs/ARCHITECTURE.md` before changing code. The current work
item is the first unchecked box in `docs/ROADMAP.md`, unless the user names another.

## Non-negotiables

1. **Closed glossary:** Account, Strategy, Bot, Bar, Decision, Guard, Order, Fill, Position, Trade,
   Backtest. Do not introduce new domain nouns (no "sessions", "experiences", "pipelines",
   "presets"...) without updating `docs/GLOSSARY.md` in the same change and saying why.
2. **One engine:** backtests and live trading run the same `Runner`, strategies, guards, sizing and
   exits (`engine/src/core/runner.ts`). Never add live-only or backtest-only decision logic. The
   parity test in `engine/test/engine.test.ts` must keep passing.
3. **One receipt per check:** every (bot, symbol, closed bar) check writes exactly one Decision with
   a reason code from `shared/reasons.ts`. A new way to not trade = a new reason code with human
   text. No silent returns, no swallowed errors.
4. **Strategies are pure:** they see closed bars only and never call the broker, the database, the
   network or `Date.now()`. Use `ctx.now`.
5. **The broker is the source of truth:** orders are keyed by `client_order_id`; fills come from the
   broker's cumulative filled quantity. A filled entry order means a position is OPEN. Positions are
   never inferred from order status.
6. **AI goes through `engine/src/ai/client.ts` only:** schema-validated output, every call logged in
   `ai_calls` with its cost, failures become `ERROR ai_failed` decisions and never stop a bot.
7. **Paper only.** Never add a code path that can place live orders.

## Before you say "done"

- Run `bun run verify` (typecheck, lint, tests, size budgets, UI build) and paste the summary.
- If you touched the UI, also run `bun run test:e2e` (set `EXVA_CHROMIUM` if Playwright's browser
  isn't installed) and say which screens you checked.
- If you touched the engine loop, run `bun run demo` and paste `bun run exva status -- --demo`.
- Update the checkboxes in `docs/ROADMAP.md`. Do not create new planning or investigation docs.

## Don'ts

- No new tables, endpoints, top-level folders or dependencies without a line in
  `docs/ARCHITECTURE.md`. `scripts/budget.ts` enforces the size budgets.
- No plan or ticket IDs in code comments. No "v1/v2", "legacy" or feature-flagged parallel paths.
  Delete instead of deprecating.
- No mocks that redefine broker semantics. Use `SimBroker` or the fake servers in
  `engine/test/fakes.ts`, which mirror Alpaca's documented responses.
- Don't widen scope. New ideas go in the parking lot in `docs/ROADMAP.md`.

## Debugging "it didn't trade"

Look at the receipts first: the bot page's "Why no trades today?" card or `bun run exva status`,
then `bun run exva decisions --bot NAME`, then the Activity feed (`/api/events`). Raw logs last.
