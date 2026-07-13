import { z } from "zod";
import { selectorEvidenceSchema } from "../../electron/shared/ai/selector-candidate";
import { selectorDiagnosticsSchema } from "../../electron/shared/ai/selector-diagnostics";

const agentTypeSchema = z.enum([
  "technical",
  "fundamental",
  "review",
  "decision",
  "selector",
  "session",
  "preflight",
  "approval",
  "orchestrator",
  "broker",
  "capital",
]);
const logLevelSchema = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]);
const instrumentClassSchema = z.enum([
  "stock",
  "crypto",
  "futures",
  "options",
  "prediction_market",
]);

export const eventFiltersSchema = z
  .object({
    minLevel: logLevelSchema.optional(),
    min_level: logLevelSchema.optional(),
    agentType: agentTypeSchema.optional(),
    agent_type: agentTypeSchema.optional(),
    search: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional(),
    sessionId: z.string().optional(),
  })
  .optional();

export const listTradesFiltersSchema = z.object({
  sessionId: z.string().optional(),
  brokerAccountId: z.string().optional(),
  symbolContains: z.string().optional(),
  instrumentType: instrumentClassSchema.optional(),
  executionMode: z.enum(["paper_only", "live_allowed"]).optional(),
  includeAllEnvironments: z.boolean().optional(),
});

const instrumentSelectionCandidateInputSchema = z.object({
  symbol: z.string().min(1).max(160),
  instrumentClass: instrumentClassSchema,
  instrumentDisplayName: z.string().optional(),
  predictionOutcome: z.enum(["YES", "NO"]).nullable().optional(),
  instrumentMetadataJson: z.string().optional(),
  rationale: z.string().optional(),
  selectorEvidence: selectorEvidenceSchema.optional(),
});

export const instrumentSelectionSchema = z.object({
  instruments: z
    .array(
      instrumentSelectionCandidateInputSchema.extend({
        symbol: z
          .string()
          .min(1)
          .max(160)
          .transform((s) => {
            const trimmed = s.trim();
            return trimmed.startsWith("pm:") ? trimmed : trimmed.toUpperCase();
          }),
      }),
    )
    .max(50),
  diagnostics: z.lazy(() => selectorDiagnosticsSchema).optional(),
});

export type InstrumentSelection = z.infer<typeof instrumentSelectionSchema>;

export const tradeIdSchema = z.object({ tradeId: z.string().min(1) });
export const cycleIdSchema = z.object({ cycleId: z.string().min(1) });
export const apiCallLogFiltersSchema = z.object({
  sessionId: z.string().min(1),
  cycleId: z.string().min(1).nullable().optional(),
  tradeId: z.string().min(1).nullable().optional(),
});
export const approveTradeSchema = z.object({
  tradeId: z.string().min(1),
  approved: z.boolean(),
});

export const approvalListFiltersSchema = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]).optional(),
  })
  .optional();

export const approvalDecideSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  decisionNote: z.string().max(2000).optional(),
});

export const apiKeySchema = z.object({
  keyType: z.enum(["anthropic", "brave", "tavily"]),
  value: z.string().min(1),
});

export const providerAccountSaveSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  category: z.enum(["ai", "search"]),
  providerType: z.enum([
    "anthropic",
    "openai",
    "openrouter",
    "brave",
    "tavily",
    "duckduckgo",
    "mcp",
  ]),
  apiKey: z.string().min(1),
  metadata: z
    .object({
      baseUrl: z.string().url().optional(),
      mcpToolName: z.string().min(1).optional(),
      mcpAuthMode: z.enum(["bearer", "query"]).optional(),
      mcpApiKeyQueryParam: z.string().min(1).optional(),
    })
    .optional(),
});

export const providerAccountTestSchema = z.object({
  id: z.string().min(1),
});

export const providerAccountDeleteSchema = z.object({
  id: z.string().min(1),
});

const brokerTypeSchema = z.enum([
  "alpaca",
  "coinbase_advanced_trade",
  "tradovate",
  "polymarket",
  "kalshi",
  "tradier",
  "kraken",
  "mock",
]);

export const brokerAccountAddSchema = z.object({
  id: z.string().min(1).optional(),
  brokerType: brokerTypeSchema,
  name: z.string().min(1),
  mode: z.enum(["paper", "live"]),
  credentials: z.record(z.string()),
  mockScenarioKind: z
    .enum([
      "clean_breakout",
      "failed_breakout",
      "sideways_chop",
      "gap_down_after_entry",
      "news_reversal",
      "stale_quote",
      "wide_spread",
      "partial_fill",
      "broker_reject",
      "rate_limit",
    ])
    .optional(),
  mockExecutionTier: z.enum(["scripted", "rehearsal"]).optional(),
});

export const brokerAccountIdSchema = z.object({
  id: z.string().min(1),
});

export const brokerTestEphemeralSchema = z.object({
  brokerType: brokerTypeSchema,
  mode: z.enum(["paper", "live"]),
  credentials: z.record(z.string()),
});

export const brokerRoutingUpdateSchema = z.object({
  routing: z.array(
    z.object({
      instrumentClass: instrumentClassSchema,
      defaultBrokerAccountId: z.string().min(1),
    }),
  ),
});

export const strategyConfigGetSchema = z.object({
  sessionId: z.string().min(1),
});

export const strategyConfigUpdateSchema = z.object({
  sessionId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  patch: z.record(z.string(), z.unknown()),
});

export const strategyConfigApplyPresetSchema = z.object({
  sessionId: z.string().min(1),
  presetId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
});

export const strategyConfigListPresetsSchema = z
  .object({
    kind: z
      .enum(["full", "risk", "timeframe", "research", "rules", "ai"])
      .optional(),
  })
  .optional();

export const strategyConfigSavePresetSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  kind: z.enum(["full", "risk", "timeframe", "research", "rules", "ai"]),
  doc: z.record(z.string(), z.unknown()),
  builtin: z.boolean().optional(),
});

export const strategyConfigDeletePresetSchema = z.object({
  id: z.string().min(1),
});

export const strategyConfigHistorySchema = z.object({
  sessionId: z.string().min(1),
});

export const strategyConfigRollbackSchema = z.object({
  sessionId: z.string().min(1),
  version: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
});
