import { z } from "zod";
import {
  fundamentalSignalSchema,
  type FundamentalSignal,
} from "@electron/shared/ai/pipeline-signals";

export const earningsOutputSchema = z.object({
  earningsScore: z.number().min(0).max(1).nullable().default(null),
  rawSummary: z.string().default(""),
});
export type EarningsOutput = z.infer<typeof earningsOutputSchema>;

export const catalystOutputSchema = z.object({
  catalystType: z
    .enum([
      "earnings",
      "partnership",
      "fda",
      "contract",
      "macro",
      "social_hype",
      "unknown",
    ])
    .nullable()
    .default(null),
  catalystStrength: z.number().min(0).max(1).nullable().default(null),
  catalystFreshness: z.number().min(0).max(1).nullable().default(null),
  catalystSummary: z.string().nullable().default(null),
  contradictionRisk: z.number().min(0).max(1).default(0),
  rawSummary: z.string().default(""),
});
export type CatalystOutput = z.infer<typeof catalystOutputSchema>;

export const sentimentOutputSchema = z.object({
  sentimentScore: z.number().min(0).max(1).nullable().default(null),
  rawSummary: z.string().default(""),
});
export type SentimentOutput = z.infer<typeof sentimentOutputSchema>;

export interface FundamentalWorkerOutputs {
  earnings?: EarningsOutput | null;
  catalyst?: CatalystOutput | null;
  sentiment?: SentimentOutput | null;
}

export function aggregateFundamentalSignal(
  symbol: string,
  workers: FundamentalWorkerOutputs,
): FundamentalSignal {
  const catalystStrength = workers.catalyst?.catalystStrength ?? null;
  const catalystFreshness = workers.catalyst?.catalystFreshness ?? null;
  const contradictionRisk = workers.catalyst?.contradictionRisk ?? 0;

  const catalystScore = deriveCatalystScore(
    catalystStrength,
    catalystFreshness,
    contradictionRisk,
  );
  const rawSummary = buildRawSummary(workers);

  return fundamentalSignalSchema.parse({
    symbol,
    catalystType: workers.catalyst?.catalystType ?? null,
    catalystStrength,
    catalystFreshness,
    catalystScore,
    catalystSummary: workers.catalyst?.catalystSummary ?? null,
    earningsScore: workers.earnings?.earningsScore ?? null,
    sentimentScore: workers.sentiment?.sentimentScore ?? null,
    contradictionRisk,
    rawSummary,
  });
}

function deriveCatalystScore(
  strength: number | null,
  freshness: number | null,
  contradictionRisk: number,
): number | null {
  if (strength == null || freshness == null) return null;
  return strength * freshness * (1 - contradictionRisk);
}

function buildRawSummary(workers: FundamentalWorkerOutputs): string {
  const parts: string[] = [];
  if (workers.catalyst?.rawSummary)
    parts.push(`Catalyst: ${workers.catalyst.rawSummary}`);
  if (workers.earnings?.rawSummary)
    parts.push(`Earnings: ${workers.earnings.rawSummary}`);
  if (workers.sentiment?.rawSummary)
    parts.push(`Sentiment: ${workers.sentiment.rawSummary}`);
  return parts.join(" | ");
}
