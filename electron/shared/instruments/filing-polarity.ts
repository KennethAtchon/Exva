export type FilingPolarity = "positive" | "negative" | "mixed" | "unknown";

export type TradeDirection = "long" | "short";

const NEGATIVE_KEYWORDS = [
  "bankruptcy",
  "chapter 11",
  "delisting",
  "restatement",
  "material weakness",
  "going concern",
  "impairment",
  "layoff",
  "termination",
  "resignation",
  "investigation",
  "subpoena",
  "recall",
  "default",
  "breach",
  "litigation",
  "sec enforcement",
];

const POSITIVE_KEYWORDS = [
  "acquisition",
  "partnership",
  "contract award",
  "fda approval",
  "buyback",
  "dividend",
  "guidance raise",
  "beat",
  "record revenue",
  "expansion",
  "licensing agreement",
];

/** Rules-first polarity from item codes and optional filing headline text. */
export function classifyFilingPolarity(input: {
  itemCodes: string[];
  headline?: string;
}): FilingPolarity {
  const text = (input.headline ?? "").toLowerCase();
  const codes = new Set(input.itemCodes);

  if (codes.has("1.03") || codes.has("2.06")) return "negative";
  if (codes.has("2.02") || codes.has("1.01")) {
    const neg = NEGATIVE_KEYWORDS.some((k) => text.includes(k));
    const pos = POSITIVE_KEYWORDS.some((k) => text.includes(k));
    if (neg && pos) return "mixed";
    if (neg) return "negative";
    if (pos) return "positive";
    return "positive";
  }

  const negHits = NEGATIVE_KEYWORDS.filter((k) => text.includes(k)).length;
  const posHits = POSITIVE_KEYWORDS.filter((k) => text.includes(k)).length;
  if (negHits > 0 && posHits > 0) return "mixed";
  if (negHits > posHits) return "negative";
  if (posHits > 0) return "positive";
  return "unknown";
}

/** Map polarity to default trade direction for backtest / rules path. */
export function polarityToDirection(
  polarity: FilingPolarity,
): TradeDirection | null {
  if (polarity === "positive") return "long";
  if (polarity === "negative") return "short";
  return null;
}
