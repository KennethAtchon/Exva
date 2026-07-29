import { z } from "zod";

const instrumentClassSchema = z.enum([
  "stock",
  "crypto",
  "futures",
  "options",
  "prediction_market",
]);

const tradingTimeframeSchema = z.enum([
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
]);

export const signalOriginKindSchema = z.enum(["strategy", "certification"]);
export type SignalOriginKind = z.infer<typeof signalOriginKindSchema>;

export const deterministicSignalLifecycleSchema = z.object({
  initialStopPrice: z.number(),
  firstTarget: z.object({
    price: z.number(),
    closeFraction: z.number().min(0).max(1),
  }),
  sessionEndTs: z.string(),
  sameBarPriority: z.literal("stop_before_target"),
});

export const deterministicSignalFactV1Schema = z.object({
  schemaVersion: z.literal(1),
  signalId: z.string(),
  originKind: signalOriginKindSchema,
  sessionInputGroupKey: z.string(),
  strategyId: z.string(),
  strategyImplementationVersion: z.number().int().positive(),
  strategyParameters: z.record(z.unknown()),
  symbol: z.string(),
  instrumentClass: instrumentClassSchema,
  timeframe: tradingTimeframeSchema,
  evaluatedAt: z.string(),
  newestBarTs: z.string(),
  barWindowHash: z.string(),
  action: z.enum(["buy", "sell"]),
  strength: z.number(),
  evidence: z.record(z.number()),
  lifecycle: deterministicSignalLifecycleSchema.optional(),
});

export type DeterministicSignalFactV1 = z.infer<
  typeof deterministicSignalFactV1Schema
>;
