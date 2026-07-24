import { fetchPredictionMarketCandidates } from "../../../signals/scoring/prediction-market-candidate-engine";
import { registerEngine, type InputEngine } from "../registry";

const MAX_CANDIDATE_ROWS = 12;
const MAX_CANDIDATE_BLOCK_CHARS = 6_000;

type CandidatePromptRow = {
  symbol: string;
  question: string | null;
  outcome: "YES" | "NO" | null;
  price: number | null;
  liquidity: number | null;
};

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

    return buildPredictionMarketCandidateBlock(candidates);
  },
};

registerEngine(predictionMarketCandidatesInputEngine);

export function buildPredictionMarketCandidateBlock(
  candidates: Awaited<ReturnType<typeof fetchPredictionMarketCandidates>>,
): string {
  const rows = candidates.slice(0, MAX_CANDIDATE_ROWS).map(toPromptRow);
  const header =
    "Prediction-market candidates (return only these canonical rows for prediction_market):";
  const lines: string[] = [];
  let omitted = candidates.length - rows.length;

  for (let index = 0; index < rows.length; index += 1) {
    const line = `- ${JSON.stringify(rows[index])}`;
    const remaining = rows.length - index - 1 + omitted;
    const marker = omissionMarker(remaining);
    const suffixLength = marker ? marker.length + 1 : 0;
    if (
      header.length + 1 + lines.join("\n").length + line.length + suffixLength >
      MAX_CANDIDATE_BLOCK_CHARS
    ) {
      omitted += rows.length - index;
      break;
    }
    lines.push(line);
  }

  const marker = omissionMarker(omitted);
  return [header, ...lines, ...(marker ? [marker] : [])].join("\n");
}

function toPromptRow(
  candidate: Awaited<
    ReturnType<typeof fetchPredictionMarketCandidates>
  >[number],
): CandidatePromptRow {
  const metadata = parseMetadata(candidate.instrumentMetadataJson);
  return {
    symbol: candidate.symbol,
    question: candidate.instrumentDisplayName ?? null,
    outcome: candidate.predictionOutcome ?? null,
    price: readFiniteNumber(metadata.marketMid),
    liquidity: readFiniteNumber(metadata.liquidity),
  };
}

function omissionMarker(omitted: number): string | null {
  return omitted > 0
    ? `...${omitted} more markets omitted (use list_markets for the full set)`
    : null;
}

function parseMetadata(
  raw: string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
