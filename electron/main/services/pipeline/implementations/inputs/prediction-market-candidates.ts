import { fetchPredictionMarketCandidates } from "../../../signal/scoring/prediction-market-candidate-engine";
import type { InputBuilder } from "../registry/input-builder-registry";

export const predictionMarketCandidatesInputBuilder: InputBuilder = {
  id: "prediction-market-candidates",
  async build(ctx) {
    if (!ctx.instrumentClasses.includes("prediction_market")) {
      return null;
    }

    const candidates = await fetchPredictionMarketCandidates(
      ctx.sessionId,
      ctx.services.brokerRouting,
    );
    if (candidates.length === 0) {
      return null;
    }

    return `Prediction-market candidates (return only these canonical rows for prediction_market):\n${candidates
      .map((candidate) => `- ${JSON.stringify(candidate)}`)
      .join("\n")}`;
  },
};
