export type EdgarTradabilityFilters = {
  minPriceUsd: number;
  minDollarVolumeUsd: number;
  maxSpreadPct: number;
  allowedMarketCapBuckets: Array<"mega" | "large" | "mid" | "small">;
};

export const DEFAULT_EDGAR_TRADABILITY: EdgarTradabilityFilters = {
  minPriceUsd: 5,
  minDollarVolumeUsd: 500_000,
  maxSpreadPct: 0.5,
  allowedMarketCapBuckets: ["mega", "large", "mid", "small"],
};

export type TradabilityCheckInput = {
  priceUsd: number;
  volumeShares: number;
  spreadPct: number;
  marketCapBucket?: "mega" | "large" | "mid" | "small" | "unknown";
};

export type TradabilityCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

export function checkEdgarTradability(
  input: TradabilityCheckInput,
  filters: EdgarTradabilityFilters = DEFAULT_EDGAR_TRADABILITY,
): TradabilityCheckResult {
  if (input.priceUsd < filters.minPriceUsd) {
    return { ok: false, reason: `price_below_floor_${filters.minPriceUsd}` };
  }
  const dollarVolume = input.priceUsd * input.volumeShares;
  if (dollarVolume < filters.minDollarVolumeUsd) {
    return { ok: false, reason: "dollar_volume_too_low" };
  }
  if (input.spreadPct > filters.maxSpreadPct) {
    return { ok: false, reason: "spread_too_wide" };
  }
  const cap = input.marketCapBucket ?? "unknown";
  if (cap !== "unknown" && !filters.allowedMarketCapBuckets.includes(cap)) {
    return { ok: false, reason: `market_cap_bucket_${cap}_excluded` };
  }
  return { ok: true };
}
