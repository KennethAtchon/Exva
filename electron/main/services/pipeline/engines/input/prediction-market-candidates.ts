import { fetchPredictionMarketCandidates } from "../../../signal/scoring/prediction-market-candidate-engine";
import { registerEngine, type InputEngine } from "../registry";

const predictionMarketCandidatesInputEngine: InputEngine = {
  id: "prediction-market-candidates",
  kind: "input",
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

registerEngine(predictionMarketCandidatesInputEngine);
