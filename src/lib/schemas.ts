import { z } from "zod";

export const sessionStatusSchema = z.enum(["draft", "idle", "active", "paused", "stopped", "archived"]);
export const tradeSideSchema = z.enum(["BUY", "SELL"]);
export const tradeStatusSchema = z.enum(["pending", "open", "closed", "rejected"]);
export const agentTypeSchema = z.enum([
  "researcher_bull",
  "researcher_bear",
  "reviewer",
  "decision_maker",
  "instrument_selector",
  "session",
  "preflight",
  "approval",
  "orchestrator",
  "broker",
  "capital",
]);
export const logLevelSchema = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]);

export const sessionConfigSchema = z.object({
  strategy: z.string().min(1),
  max_position_usd: z.number().positive(),
  stop_loss_pct: z.number().positive(),
  take_profit_pct: z.number().positive(),
  max_concurrent_trades: z.number().int().positive(),
  research_depth: z.enum(["light", "balanced", "deep"]),
  daily_loss_limit_usd: z.number().positive(),
  profit_target_usd: z.number().positive(),
  max_api_spend_usd: z.number().positive(),
  human_approval_required: z.boolean(),
});

export const brokerCredentialsSchema = z.object({
  provider: z.literal("alpaca"),
  api_key: z.string().min(1),
  secret_key: z.string().min(1),
  mode: z.enum(["paper", "live"]),
});

export const eventFiltersSchema = z
  .object({
    minLevel: logLevelSchema.optional(),
    min_level: logLevelSchema.optional(),
    agentType: agentTypeSchema.optional(),
    agent_type: agentTypeSchema.optional(),
    search: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional(),
  })
  .optional();

export const tradeDecisionSchema = z.object({
  action: z.enum(["trade", "no_trade"]),
  side: tradeSideSchema.optional(),
  asset: z.string().min(1),
  sizeUsd: z.number().positive().optional(),
  confidence: z.number().min(0).max(1),
  stopLossPct: z.number().positive().optional(),
  takeProfitPct: z.number().positive().optional(),
  reasoning: z.string().min(1),
});

export const tradeIdSchema = z.object({ tradeId: z.string().min(1) });
export const approveTradeSchema = z.object({
  tradeId: z.string().min(1),
  approved: z.boolean(),
});

export const apiKeySchema = z.object({
  keyType: z.enum(["anthropic", "brave", "tavily"]),
  value: z.string().min(1),
});
