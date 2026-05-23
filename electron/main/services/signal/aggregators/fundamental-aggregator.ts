import { z } from "zod";
import {
  fundamentalSignalSchema,
  type FundamentalSignal,
} from "@electron/shared/ai/pipeline-signals";

export const earningsOutputSchema = z.object({
  earningsScore: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe(
      "Earnings quality vs expectations (0 = miss/deteriorating, 1 = strong beat), or null if no evidence.",
    ),
  rawSummary: z
    .string()
    .default("")
    .describe("One-to-two sentence observation."),
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
    .default(null)
    .describe("Primary catalyst category, or null if none identified."),
  catalystStrength: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe(
      "How material the catalyst is for near-term price (0 = minor, 1 = major).",
    ),
  catalystFreshness: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe(
      "How recently it emerged (0 = stale/priced-in, 1 = just breaking).",
    ),
  catalystSummary: z
    .string()
    .nullable()
    .default(null)
    .describe("One-to-two sentence catalyst description, or null."),
  contradictionRisk: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe(
      "Probability conflicting signals undermine the catalyst (0 = clean, 1 = heavily contradicted).",
    ),
  rawSummary: z
    .string()
    .default("")
    .describe("One-to-two sentence observation."),
});
export type CatalystOutput = z.infer<typeof catalystOutputSchema>;

export const sentimentOutputSchema = z.object({
  sentimentScore: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe(
      "Aggregate sentiment (0 = bearish consensus, 1 = bullish consensus), or null if no signal.",
    ),
  rawSummary: z
    .string()
    .default("")
    .describe("One-to-two sentence observation."),
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
