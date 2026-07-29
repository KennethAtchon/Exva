import {
  checkEdgarTradability,
  DEFAULT_EDGAR_TRADABILITY,
  type EdgarTradabilityFilters,
  type TradabilityCheckResult,
} from "@electron/shared/instruments/edgar-tradability";

export type EdgarCandidateGate =
  | "issuer_resolved"
  | "broker_asset_active"
  | "listed_exchange"
  | "price_floor"
  | "dollar_volume_floor"
  | "spread_ceiling"
  | "filing_freshness"
  | "material_item";

export interface EdgarCandidateIdentity {
  cik: string;
  accession: string;
  filingUrl: string;
  acceptedAt: string;
  form: string;
  items: string[];
  ticker: string | null;
  companyName: string | null;
}

export interface EdgarCandidateMarket {
  priceUsd: number;
  avgDollarVolume20d: number;
  spreadBps: number;
  listedExchange: string | null;
  isOtc: boolean;
  assetActive: boolean;
}

export interface EdgarGateCounts {
  evaluated: number;
  passed: number;
  rejectedBy: Partial<Record<EdgarCandidateGate, number>>;
}

const DEFAULT_MATERIAL_ITEMS = new Set([
  "1.01",
  "2.01",
  "2.02",
  "5.02",
  "8.01",
]);

const MAX_FILING_AGE_MS = 6 * 60 * 60_000;

/**
 * Deterministic pre-AI EDGAR screening (Solution 02 WS7).
 * Preserves filing identity; counts every gate.
 */
export class EdgarCandidateScreeningService {
  private readonly counts: EdgarGateCounts = {
    evaluated: 0,
    passed: 0,
    rejectedBy: {},
  };

  constructor(
    private readonly opts: {
      tradability?: EdgarTradabilityFilters;
      materialItems?: Set<string>;
      maxFilingAgeMs?: number;
      now?: () => Date;
    } = {},
  ) {}

  getCounts(): EdgarGateCounts {
    return {
      evaluated: this.counts.evaluated,
      passed: this.counts.passed,
      rejectedBy: { ...this.counts.rejectedBy },
    };
  }

  screen(input: {
    identity: EdgarCandidateIdentity;
    market: EdgarCandidateMarket | null;
  }):
    | { ok: true; identity: EdgarCandidateIdentity }
    | { ok: false; gate: EdgarCandidateGate; reason: string } {
    this.counts.evaluated += 1;
    const { identity, market } = input;

    if (!identity.cik || !identity.accession || !identity.filingUrl) {
      return this.reject("issuer_resolved", "missing_filing_identity");
    }
    if (!identity.ticker) {
      return this.reject("issuer_resolved", "ticker_unresolved");
    }

    const now = this.opts.now?.() ?? new Date();
    const ageMs = now.getTime() - Date.parse(identity.acceptedAt);
    const maxAge = this.opts.maxFilingAgeMs ?? MAX_FILING_AGE_MS;
    if (!Number.isFinite(ageMs) || ageMs > maxAge) {
      return this.reject("filing_freshness", "filing_older_than_six_hours");
    }

    const material = this.opts.materialItems ?? DEFAULT_MATERIAL_ITEMS;
    const hasMaterial = identity.items.some((item) =>
      material.has(normalizeItem(item)),
    );
    if (identity.items.length > 0 && !hasMaterial) {
      return this.reject("material_item", "no_material_item_codes");
    }

    // Identity/freshness/material can reject before quotes. Market gates apply
    // only when a snapshot is supplied — missing market does not hard-fail here
    // so the selector can still request a quote later in the cycle.
    if (!market) {
      this.counts.passed += 1;
      return { ok: true, identity };
    }
    if (!market.assetActive) {
      return this.reject("broker_asset_active", "asset_inactive");
    }
    if (market.isOtc || !market.listedExchange) {
      return this.reject("listed_exchange", "otc_or_unlisted");
    }

    const tradability: TradabilityCheckResult = checkEdgarTradability(
      {
        priceUsd: market.priceUsd,
        // checkEdgarTradability multiplies price * volumeShares — pass shares
        // such that price * shares ≈ avgDollarVolume20d.
        volumeShares:
          market.priceUsd > 0
            ? market.avgDollarVolume20d / market.priceUsd
            : 0,
        spreadPct: market.spreadBps / 100,
      },
      this.opts.tradability ?? DEFAULT_EDGAR_TRADABILITY,
    );
    if (!tradability.ok) {
      if (tradability.reason.startsWith("price_below")) {
        return this.reject("price_floor", tradability.reason);
      }
      if (tradability.reason === "dollar_volume_too_low") {
        return this.reject("dollar_volume_floor", tradability.reason);
      }
      if (tradability.reason === "spread_too_wide") {
        return this.reject("spread_ceiling", tradability.reason);
      }
      return this.reject("broker_asset_active", tradability.reason);
    }

    this.counts.passed += 1;
    return { ok: true, identity };
  }

  private reject(
    gate: EdgarCandidateGate,
    reason: string,
  ): { ok: false; gate: EdgarCandidateGate; reason: string } {
    this.counts.rejectedBy[gate] = (this.counts.rejectedBy[gate] ?? 0) + 1;
    return { ok: false, gate, reason };
  }
}

function normalizeItem(raw: string): string {
  return raw.replace(/^item\s*/i, "").trim();
}
