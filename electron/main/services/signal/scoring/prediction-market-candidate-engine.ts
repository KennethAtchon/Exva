import { z } from "zod";
import {
  isMarketDiscoveryAdapter,
  type PolymarketMarketRow,
} from "../../broker/adapters/broker-adapter";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";

type PredictionToken = { outcome?: unknown; token_id?: unknown };

export type PredictionMarketCandidateRow = {
  symbol: string;
  instrumentClass: "prediction_market";
  instrumentDisplayName?: string;
  predictionOutcome?: "YES" | "NO" | null;
  instrumentMetadataJson?: string | null;
};

export async function fetchPredictionMarketCandidates(
  sessionId: string,
  brokerRouting: BrokerRoutingService,
): Promise<PredictionMarketCandidateRow[]> {
  let rows: PolymarketMarketRow[];
  try {
    const { adapter } = await brokerRouting.resolveAdapter(
      sessionId,
      "prediction_market",
    );
    if (!isMarketDiscoveryAdapter(adapter)) return [];
    rows = await adapter.fetchMarketCandidates();
  } catch {
    return [];
  }

  const out: Array<PredictionMarketCandidateRow & { score: number }> = [];

  for (const row of rows) {
    const conditionId =
      typeof row.conditionId === "string" ? row.conditionId : null;
    const question = typeof row.question === "string" ? row.question : null;
    const slug = typeof row.slug === "string" ? row.slug : null;
    const category = typeof row.category === "string" ? row.category : null;
    const resolutionTime = typeof row.endDate === "string" ? row.endDate : null;
    const liquidity = Number(
      row.liquidity ?? row.liquidityClob ?? row.volume ?? 0,
    );
    const tokens = Array.isArray(row.tokens) ? row.tokens : [];
    if (!conditionId || !question || tokens.length === 0) continue;

    const yes = tokens.find(
      (token) =>
        token &&
        typeof token === "object" &&
        (token as PredictionToken).outcome === "Yes",
    );
    const no = tokens.find(
      (token) =>
        token &&
        typeof token === "object" &&
        (token as PredictionToken).outcome === "No",
    );
    const yesTokenId =
      typeof (yes as PredictionToken | undefined)?.token_id === "string"
        ? (yes as { token_id: string }).token_id
        : null;
    const noTokenId =
      typeof (no as PredictionToken | undefined)?.token_id === "string"
        ? (no as { token_id: string }).token_id
        : null;
    if (!yesTokenId || !noTokenId) continue;

    const timeScore = resolutionTime
      ? predictionResolutionScore(resolutionTime)
      : 0;
    const categoryScore = category ? 10 : 0;
    const score = Math.min(liquidity / 1000, 100) + timeScore + categoryScore;

    for (const [predictionOutcome, outcomeTokenId] of [
      ["YES", yesTokenId],
      ["NO", noTokenId],
    ] as const) {
      out.push({
        symbol: `pm:${conditionId}`,
        instrumentClass: "prediction_market",
        instrumentDisplayName: question,
        predictionOutcome,
        instrumentMetadataJson: JSON.stringify({
          slug,
          conditionId,
          outcomeTokenId,
          yesOutcomeTokenId: yesTokenId,
          noOutcomeTokenId: noTokenId,
          category,
          liquidity,
          resolutionTime,
        }),
        score,
      });
    }
  }

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(
      ({
        symbol,
        instrumentClass,
        instrumentDisplayName,
        predictionOutcome,
        instrumentMetadataJson,
      }) => ({
        symbol,
        instrumentClass,
        instrumentDisplayName,
        predictionOutcome,
        instrumentMetadataJson,
      }),
    );
}

export const predictionMarketCandidateInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const predictionMarketCandidateOutputSchema = z.array(
  z.object({
    symbol: z.string(),
    instrumentClass: z.literal("prediction_market"),
    instrumentDisplayName: z.string().optional(),
    predictionOutcome: z.enum(["YES", "NO"]).nullable().optional(),
    instrumentMetadataJson: z.string().nullable().optional(),
  }),
);

function predictionResolutionScore(resolutionTime: string): number {
  const ms = new Date(resolutionTime).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const days = ms / (1000 * 60 * 60 * 24);
  if (days <= 1) return 30;
  if (days <= 7) return 20;
  if (days <= 30) return 10;
  return 4;
}
