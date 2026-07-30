import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { BrokerRoutingService } from "../broker/broker-routing-service";
import { fetchPredictionMarketCandidates } from "../signals/scoring/prediction-market-candidate-engine";

/**
 * Enumerates real, currently-live prediction-market candidates. Selector
 * discovery workers must call this before `get_quote` — otherwise weak
 * models invent plausible-looking symbols that never resolve
 * (docs/attic/reviews/2026-07-19-overnight-stress-session-review.md Bug 4).
 */
export function createPredictionMarketTools(deps: {
  sessionId: string;
  brokerRouting: BrokerRoutingService;
}): ToolSet {
  return {
    list_markets: tool({
      description:
        "List real, currently-live prediction-market candidates. Returns canonical `symbol` values — the ONLY valid inputs to get_quote for instrumentClass prediction_market. Never guess or invent a symbol.",
      inputSchema: z.object({}),
      execute: async () => {
        const candidates = await fetchPredictionMarketCandidates(
          deps.sessionId,
          deps.brokerRouting,
        );
        return {
          markets: candidates.map((candidate) => ({
            symbol: candidate.symbol,
            instrumentClass: candidate.instrumentClass,
            question: candidate.instrumentDisplayName ?? null,
            predictionOutcome: candidate.predictionOutcome ?? null,
          })),
        };
      },
    }),
  };
}
