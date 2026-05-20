import { isMarketDiscoveryAdapter, type PolymarketMarketRow } from "../../../broker/adapters/broker-adapter";
import type { OrchestratorContext } from "../orchestrator-context";
import type { PredictionToken, ResolvedInstrument } from "../types";
import { predictionResolutionScore } from "../utils";

export async function fetchPredictionMarketCandidates(ctx: OrchestratorContext): Promise<ResolvedInstrument[]> {
  let rows: PolymarketMarketRow[];
  try {
    const { adapter } = await ctx.deps.brokerRouting.resolveAdapter(ctx.sessionId, "prediction_market");
    if (!isMarketDiscoveryAdapter(adapter)) return [];
    rows = await adapter.fetchMarketCandidates();
  } catch {
    ctx.emitEvent("WARN", null, "Polymarket candidate fetch failed: no adapter or fetch error");
    return [];
  }

  const out: Array<ResolvedInstrument & { score: number }> = [];

  for (const row of rows) {
    const conditionId = typeof row.conditionId === "string" ? row.conditionId : null;
    const question = typeof row.question === "string" ? row.question : null;
    const slug = typeof row.slug === "string" ? row.slug : null;
    const category = typeof row.category === "string" ? row.category : null;
    const resolutionTime = typeof row.endDate === "string" ? row.endDate : null;
    const liquidity = Number(row.liquidity ?? row.liquidityClob ?? row.volume ?? 0);
    const tokens = Array.isArray(row.tokens) ? row.tokens : [];
    if (!conditionId || !question || tokens.length === 0) continue;

    const yes = tokens.find(
      (token) => token && typeof token === "object" && (token as PredictionToken).outcome === "Yes",
    );
    const no = tokens.find(
      (token) => token && typeof token === "object" && (token as PredictionToken).outcome === "No",
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

    const timeScore = resolutionTime ? predictionResolutionScore(resolutionTime) : 0;
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
    .map(({ symbol, instrumentClass, instrumentDisplayName, predictionOutcome, instrumentMetadataJson }): ResolvedInstrument => ({
      symbol,
      instrumentClass,
      instrumentDisplayName,
      predictionOutcome,
      instrumentMetadataJson,
    }));
}
