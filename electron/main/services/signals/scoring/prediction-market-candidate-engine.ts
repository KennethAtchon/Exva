import {
  isMarketDiscoveryAdapter,
  normalizePolymarketMarketTokens,
  type PolymarketNormalizedToken,
} from "../../broker/adapters/broker-adapter";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";

/** Parse a token's mid price into a probability in (0,1), or null if unusable. */
function tokenPrice(token: PolymarketNormalizedToken): number | null {
  const price = Number(token.price);
  return Number.isFinite(price) && price > 0 && price < 1 ? price : null;
}

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
  const { adapter } = await brokerRouting.resolveAdapter(
    sessionId,
    "prediction_market",
  );
  if (!isMarketDiscoveryAdapter(adapter)) {
    throw new Error("Resolved prediction-market broker cannot list markets");
  }
  const rows = await adapter.fetchMarketCandidates();

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
    const tokens = normalizePolymarketMarketTokens(row) ?? [];
    if (!conditionId || !question || tokens.length === 0) continue;

    const yes = tokens.find((token) => token.outcome === "Yes");
    const no = tokens.find((token) => token.outcome === "No");
    const yesTokenId = yes?.token_id ?? null;
    const noTokenId = no?.token_id ?? null;
    if (!yesTokenId || !noTokenId) continue;

    // Market-implied probability (mid) per outcome — the price the forecaster's
    // p_hat is compared against in the deterministic edge gate.
    const yesMid = yes ? tokenPrice(yes) : null;
    const noMid = no ? tokenPrice(no) : yesMid != null ? 1 - yesMid : null;

    const timeScore = resolutionTime
      ? predictionResolutionScore(resolutionTime)
      : 0;
    const categoryScore = category ? 10 : 0;
    const score = Math.min(liquidity / 1000, 100) + timeScore + categoryScore;

    for (const [predictionOutcome, outcomeTokenId, marketMid] of [
      ["YES", yesTokenId, yesMid],
      ["NO", noTokenId, noMid],
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
          // Market-implied probability of this outcome; the edge gate compares
          // the forecaster's p_hat against it.
          marketMid,
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

function predictionResolutionScore(resolutionTime: string): number {
  const ms = new Date(resolutionTime).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const days = ms / (1000 * 60 * 60 * 24);
  if (days <= 1) return 30;
  if (days <= 7) return 20;
  if (days <= 30) return 10;
  return 4;
}
