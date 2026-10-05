// Request body schemas for the engine API. The UI uses the same schemas for form validation.
import { z } from "zod";

export const timeframeSchema = z.enum(["5m", "15m", "1h"]);

export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z.]{0,9}(\/[A-Z]{2,5})?$/, "Use tickers like SPY or crypto pairs like BTC/USD");

export const riskSchema = z.object({
  stopLossPct: z.number().positive().max(50).nullable(),
  takeProfitPct: z.number().positive().max(500).nullable(),
  maxHoldBars: z.number().int().positive().max(10_000).nullable(),
  maxPositions: z.number().int().min(1).max(50),
  dailyLossLimitUsd: z.number().min(0),
});

const botFields = {
  name: z.string().trim().min(1).max(60),
  strategyId: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  symbols: z.array(symbolSchema).min(1).max(30),
  timeframe: timeframeSchema,
  accountId: z.string().min(1),
  dollarsPerTrade: z.number().min(10).max(1_000_000),
  risk: riskSchema,
  backtestId: z.string().nullable().optional(),
};

export const botInputSchema = z.object(botFields);
export const botPatchSchema = z.object(botFields).partial();
export type BotInput = z.infer<typeof botInputSchema>;

export const accountInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  broker: z.enum(["alpaca", "sim"]),
  keyId: z.string().trim().optional(),
  secretKey: z.string().trim().optional(),
  startingCash: z.number().positive().optional(),
});
export type AccountInput = z.infer<typeof accountInputSchema>;

export const backtestInputSchema = z.object({
  strategyId: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  symbols: z.array(symbolSchema).min(1).max(30),
  timeframe: timeframeSchema,
  days: z.number().int().min(1).max(730).default(30),
  from: z.number().optional(),
  to: z.number().optional(),
  startingCash: z.number().positive().default(100_000),
  dollarsPerTrade: z.number().min(10).default(1_000),
  slippageBps: z.number().min(0).max(500).default(2),
  feeBps: z.number().min(0).max(500).default(0),
  risk: riskSchema,
  aiMaxCalls: z.number().int().min(0).max(5_000).default(0),
});
export type BacktestInput = z.infer<typeof backtestInputSchema>;

export const settingsPatchSchema = z.object({
  onboarded: z.boolean().optional(),
  ai: z
    .object({
      provider: z.enum(["openrouter", "custom"]),
      baseUrl: z.string().url(),
      model: z.string().min(1),
      inputPricePerM: z.number().min(0),
      cachedInputPricePerM: z.number().min(0),
      outputPricePerM: z.number().min(0),
      dailyBudgetUsd: z.number().min(0),
      journalHour: z.number().int().min(-1).max(23),
    })
    .partial()
    .optional(),
  aiApiKey: z.string().trim().nullable().optional(),
  data: z
    .object({ stockFeed: z.enum(["iex", "sip"]) })
    .partial()
    .optional(),
  defaults: z
    .object({ dollarsPerTrade: z.number().min(10), dailyLossLimitUsd: z.number().min(0) })
    .partial()
    .optional(),
  app: z
    .object({
      launchAtLogin: z.boolean(),
      keepRunningInTray: z.boolean(),
      preventSleep: z.boolean(),
      notifications: z.boolean(),
    })
    .partial()
    .optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const killSwitchSchema = z.object({ on: z.boolean() });

export const explainInputSchema = z
  .object({ decisionId: z.string().optional(), tradeId: z.string().optional() })
  .refine(
    (v) => Boolean(v.decisionId) !== Boolean(v.tradeId),
    "Pass exactly one of decisionId or tradeId",
  );

export const assistantInputSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8_000) }))
    .min(1)
    .max(40),
});
export type AssistantMessage = z.infer<typeof assistantInputSchema>["messages"][number];
