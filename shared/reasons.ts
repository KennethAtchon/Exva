// The closed list of reasons a Decision can carry. Adding a way to not trade means adding a code here.
import type { DecisionKind } from "./types.ts";

interface ReasonDef {
  kind: DecisionKind | "buy|sell";
  text: string;
  hint?: string;
}

export const REASONS = {
  signal: { kind: "buy|sell", text: "Strategy signal" },
  stop_loss: { kind: "sell", text: "Stop-loss hit" },
  take_profit: { kind: "sell", text: "Take-profit hit" },
  max_hold: { kind: "sell", text: "Held for the maximum number of bars" },
  no_signal: { kind: "hold", text: "No signal" },
  low_confidence: { kind: "hold", text: "AI confidence below your minimum" },
  kill_switch: {
    kind: "skip",
    text: "Kill switch is on, all trading stopped",
    hint: "Turn it off from the status bar.",
  },
  paper_only: { kind: "skip", text: "Account is not a paper or simulator account" },
  order_pending: { kind: "skip", text: "An order for this symbol is still working" },
  already_in_position: { kind: "skip", text: "Already holding this symbol" },
  position_gone: {
    kind: "skip",
    text: "The broker no longer holds this position",
    hint: "It was sold outside Exva (or the paper account was reset). Exva closed its record without P&L.",
  },
  market_closed: {
    kind: "skip",
    text: "The market closed before the order could be sent",
  },
  check_overrun: {
    kind: "skip",
    text: "Skipped: the previous check was still running",
    hint: "Use fewer symbols or a longer timeframe for this bot.",
  },
  no_position: { kind: "skip", text: "Nothing to sell" },
  symbol_owned_by_other_bot: {
    kind: "skip",
    text: "Another bot holds this symbol on this account",
    hint: "Use one bot per symbol per account so positions can be told apart.",
  },
  max_positions: { kind: "skip", text: "Bot is at its maximum open positions" },
  insufficient_buying_power: { kind: "skip", text: "Not enough buying power" },
  daily_loss_limit: {
    kind: "skip",
    text: "Daily loss limit reached, no new buys today",
    hint: "Exits still run. New buys resume tomorrow, or raise the limit.",
  },
  ai_budget_exhausted: {
    kind: "skip",
    text: "AI budget used up",
    hint: "Raise the daily AI budget in Settings, or wait until tomorrow.",
  },
  stale_data: {
    kind: "skip",
    text: "No fresh bar from the data provider",
    hint: "Thin symbols on the free IEX feed often have intervals with no trades. Prefer liquid symbols.",
  },
  insufficient_history: {
    kind: "skip",
    text: "Not enough bar history yet",
    hint: "History is backfilled automatically.",
  },
  data_fetch_failed: {
    kind: "error",
    text: "Could not fetch market data",
    hint: "Check the Alpaca account keys and your internet connection.",
  },
  broker_rejected: { kind: "error", text: "Broker rejected the order" },
  broker_unavailable: {
    kind: "error",
    text: "Broker did not respond",
    hint: "Will retry on the next bar.",
  },
  ai_failed: {
    kind: "error",
    text: "AI call failed",
    hint: "Check the AI key and model in Settings.",
  },
  strategy_error: { kind: "error", text: "Strategy crashed" },
} satisfies Record<string, ReasonDef>;

export type ReasonCode = keyof typeof REASONS;

export function reasonText(code: string): string {
  return (REASONS as Record<string, ReasonDef>)[code]?.text ?? code;
}

export function reasonHint(code: string): string | undefined {
  return (REASONS as Record<string, ReasonDef>)[code]?.hint;
}
