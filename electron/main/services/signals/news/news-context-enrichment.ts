/**
 * News context enrichment for the evidence engine.
 * News signals never create candidates — they attach headlines and run a
 * freshness cross-check against coincident filing/scan polarity.
 */

import type { NewsPayload } from "@electron/shared/domain/market-signal";
import { newsContradictionFlag } from "../sources/news-source";

export interface NewsContextItem {
  headline: string;
  url: string;
  publishedAt: string;
  sourceQuality: NewsPayload["sourceQuality"];
  tickersMentioned: string[];
  polarityHint: NewsPayload["polarityHint"];
}

export interface NewsEnrichmentResult {
  headlines: NewsContextItem[];
  contradiction: {
    contradicted: boolean;
    detail: string | null;
  };
}

/**
 * Filter recent news for a symbol and attach to a decision/evidence bundle.
 * `maxAgeMs` defaults to 4h (news TTL).
 */
export function enrichWithNewsContext(input: {
  symbol: string;
  news: NewsContextItem[];
  primaryPolarity?: "positive" | "negative" | "unclear" | null;
  nowMs?: number;
  maxAgeMs?: number;
}): NewsEnrichmentResult {
  const nowMs = input.nowMs ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? 4 * 3_600_000;
  const symbol = input.symbol.toUpperCase();

  const headlines = input.news.filter((n) => {
    const age = nowMs - Date.parse(n.publishedAt);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return false;
    return (
      n.tickersMentioned.length === 0 ||
      n.tickersMentioned.some((t) => t.toUpperCase() === symbol)
    );
  });

  const contradiction = newsContradictionFlag({
    primaryPolarity: input.primaryPolarity,
    newsPolarities: headlines.map(
      (h) =>
        (h.polarityHint ?? "unclear") as "positive" | "negative" | "unclear",
    ),
  });

  return { headlines, contradiction };
}
