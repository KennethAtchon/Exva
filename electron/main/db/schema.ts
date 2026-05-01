import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  status: text("status").notNull().default("idle"),
  isFocused: integer("is_focused", { mode: "boolean" }).notNull().default(false),
  selectionMode: text("selection_mode").notNull().default("manual_shortlist"),
  instrumentClasses: text("instrument_classes").notNull(),
  instrumentScope: text("instrument_scope").notNull(),
  defaultSearchProviderId: text("default_search_provider_id"),
  capitalLimitUsd: real("capital_limit_usd").notNull(),
  executionMode: text("execution_mode").notNull().default("paper_only"),
  startedAt: text("started_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessionStrategies = sqliteTable("session_strategies", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  strategy: text("strategy").notNull().default("passive_income"),
  maxPositionUsd: real("max_position_usd").notNull().default(500),
  stopLossPct: real("stop_loss_pct").notNull().default(2),
  takeProfitPct: real("take_profit_pct").notNull().default(4),
  maxConcurrentTrades: integer("max_concurrent_trades").notNull().default(3),
  researchDepth: text("research_depth").notNull().default("balanced"),
  dailyLossLimitUsd: real("daily_loss_limit_usd").notNull().default(200),
  profitTargetUsd: real("profit_target_usd").notNull().default(1000),
  maxApiSpendUsd: real("max_api_spend_usd").notNull().default(5),
  humanApprovalRequired: integer("human_approval_required", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const trades = sqliteTable("trades", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  asset: text("asset").notNull(),
  side: text("side").notNull(),
  entryPrice: real("entry_price"),
  positionSizeUsd: real("position_size_usd").notNull(),
  stopLossPrice: real("stop_loss_price"),
  takeProfitPrice: real("take_profit_price"),
  strategy: text("strategy").notNull(),
  status: text("status").notNull(),
  openedAt: text("opened_at"),
  closedAt: text("closed_at"),
  finalPnlUsd: real("final_pnl_usd"),
  aiCostUsd: real("ai_cost_usd").notNull().default(0),
  confidenceScore: real("confidence_score"),
  brokerOrderId: text("broker_order_id"),
  createdAt: text("created_at").notNull(),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  tradeId: text("trade_id")
    .notNull()
    .references(() => trades.id, { onDelete: "cascade" }),
  agentType: text("agent_type").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costUsd: real("cost_usd").notNull(),
  outputText: text("output_text").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt: text("created_at").notNull(),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  tradeId: text("trade_id").references(() => trades.id, { onDelete: "set null" }),
  level: text("level").notNull(),
  agentType: text("agent_type"),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});

export const adaptations = sqliteTable("adaptations", {
  id: text("id").primaryKey(),
  trigger: text("trigger").notNull(),
  oldParams: text("old_params").notNull(),
  newParams: text("new_params").notNull(),
  winRate: real("win_rate").notNull(),
  tradeCount: integer("trade_count").notNull(),
  createdAt: text("created_at").notNull(),
});
