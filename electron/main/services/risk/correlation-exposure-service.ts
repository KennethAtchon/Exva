import type { InstrumentClass } from "@/lib/types";

export type AssetGroup =
  | "equities_beta"
  | "crypto"
  | "commodities"
  | "rates"
  | "other";

export type MarketRegime = "low_vol" | "medium_vol" | "high_vol";

const ASSET_GROUP_MAP: Partial<Record<InstrumentClass, AssetGroup>> = {
  stock: "equities_beta",
  crypto: "crypto",
  futures: "commodities",
  prediction_market: "other",
};

const REGIME_EXPOSURE_MULTIPLIER: Record<MarketRegime, number> = {
  low_vol: 1,
  medium_vol: 0.75,
  high_vol: 0.5,
};

export function resolveAssetGroup(
  instrumentClass: InstrumentClass,
  symbol?: string,
): AssetGroup {
  if (symbol?.startsWith("BTC") || symbol?.startsWith("ETH")) return "crypto";
  return ASSET_GROUP_MAP[instrumentClass] ?? "other";
}

export function inferMarketRegime(input: {
  spreadPct?: number | null;
  recentReturnPct?: number | null;
}): MarketRegime {
  const spread = input.spreadPct ?? 0.1;
  const momentum = Math.abs(input.recentReturnPct ?? 0);
  const score = spread * 5 + momentum * 10;
  if (score >= 1.5) return "high_vol";
  if (score >= 0.75) return "medium_vol";
  return "low_vol";
}

export class CorrelationExposureService {
  constructor(
    private readonly deps: {
      listOpenExposureByGroup: (
        sessionId: string,
      ) => Partial<Record<AssetGroup, number>>;
      maxSameGroupExposureUsd: (sessionId: string) => number;
    },
  ) {}

  checkExposure(input: {
    sessionId: string;
    instrumentClass: InstrumentClass;
    symbol: string;
    proposedSizeUsd: number;
    spreadPct?: number | null;
  }): { ok: true } | { ok: false; reason: string } {
    const group = resolveAssetGroup(input.instrumentClass, input.symbol);
    const exposure = this.deps.listOpenExposureByGroup(input.sessionId);
    const current = exposure[group] ?? 0;
    const maxBase = this.deps.maxSameGroupExposureUsd(input.sessionId);
    const regime = inferMarketRegime({ spreadPct: input.spreadPct });
    const maxAllowed = maxBase * REGIME_EXPOSURE_MULTIPLIER[regime];

    if (current + input.proposedSizeUsd > maxAllowed) {
      return {
        ok: false,
        reason: `asset_group_${group}_cap_${regime}`,
      };
    }
    return { ok: true };
  }
}
