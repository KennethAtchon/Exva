/**
 * Form 4 insider transaction parsing + cluster detection.
 * Open-market buys (code P) by officers/directors, clustered by ticker/window.
 */

export interface Form4Transaction {
  accessionNumber: string;
  cik: string;
  ticker: string | null;
  companyName: string | null;
  insiderName: string;
  role: string;
  transactionCode: string;
  shares: number;
  pricePerShare: number | null;
  totalValueUsd: number | null;
  isOpenMarketBuy: boolean;
  filedAt: string;
  transactionDate: string;
  documentUrl: string | null;
}

export interface Form4ClusterThresholds {
  /** Minimum distinct insiders in the window. */
  minInsiders: number;
  /** Minimum aggregate open-market buy value (USD). */
  minTotalValueUsd: number;
  /** Lookback window in days. */
  windowDays: number;
}

export const DEFAULT_FORM4_CLUSTER_THRESHOLDS: Form4ClusterThresholds = {
  minInsiders: 2,
  minTotalValueUsd: 100_000,
  windowDays: 7,
};

export interface Form4Cluster {
  ticker: string;
  companyName: string | null;
  insiderCount: number;
  clusterValueUsd: number;
  transactions: Form4Transaction[];
  filedAt: string;
  windowStart: string;
  windowEnd: string;
}

/** Transaction code P = open market / private purchase. */
export function isOpenMarketBuyCode(code: string): boolean {
  return code.trim().toUpperCase() === "P";
}

/**
 * Parse a Form 4 ownership XML / ownershipDocument fragment.
 * Tolerates partial documents; returns empty array on parse failure.
 */
export function parseForm4Xml(
  xml: string,
  meta: {
    accessionNumber: string;
    cik: string;
    filedAt: string;
    documentUrl?: string | null;
    ticker?: string | null;
    companyName?: string | null;
  },
): Form4Transaction[] {
  const issuerName =
    meta.companyName ??
    firstTag(xml, "issuerName") ??
    firstTag(xml, "companyName");
  const issuerTradingSymbol =
    meta.ticker ?? firstTag(xml, "issuerTradingSymbol");

  const reportingOwnerName =
    firstTag(xml, "rptOwnerName") ??
    firstTag(xml, "reportingOwnerId") ??
    "unknown";
  const officerTitle = firstTag(xml, "officerTitle");
  const isDirector = /<isDirector>\s*1\s*<\/isDirector>/i.test(xml);
  const isOfficer = /<isOfficer>\s*1\s*<\/isOfficer>/i.test(xml);
  const role =
    officerTitle ??
    (isDirector ? "Director" : isOfficer ? "Officer" : "Insider");

  const nonDerivBlocks = xml.match(
    /<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/gi,
  );
  if (!nonDerivBlocks || nonDerivBlocks.length === 0) {
    // Fallback: single-transaction style documents
    const code = firstTag(xml, "transactionCode");
    if (!code) return [];
    return [
      buildTx(xml, meta, {
        insiderName: reportingOwnerName,
        role,
        ticker: issuerTradingSymbol,
        companyName: issuerName,
        transactionCode: code,
      }),
    ].filter((t): t is Form4Transaction => t != null);
  }

  const out: Form4Transaction[] = [];
  for (const block of nonDerivBlocks) {
    const code = firstTag(block, "transactionCode");
    if (!code) continue;
    const tx = buildTx(block, meta, {
      insiderName: reportingOwnerName,
      role,
      ticker: issuerTradingSymbol,
      companyName: issuerName,
      transactionCode: code,
    });
    if (tx) out.push(tx);
  }
  return out;
}

function buildTx(
  fragment: string,
  meta: {
    accessionNumber: string;
    cik: string;
    filedAt: string;
    documentUrl?: string | null;
  },
  fields: {
    insiderName: string;
    role: string;
    ticker: string | null;
    companyName: string | null;
    transactionCode: string;
  },
): Form4Transaction | null {
  const shares = parseNumber(
    firstTag(fragment, "transactionShares") ??
      firstValueTag(fragment, "transactionShares"),
  );
  const price = parseNumber(
    firstTag(fragment, "transactionPricePerShare") ??
      firstValueTag(fragment, "transactionPricePerShare"),
  );
  const transactionDate =
    firstTag(fragment, "transactionDate") ??
    firstValueTag(fragment, "transactionDate") ??
    meta.filedAt.slice(0, 10);
  if (shares == null || shares <= 0) return null;

  const isBuy = isOpenMarketBuyCode(fields.transactionCode);
  const totalValueUsd = price != null && shares > 0 ? price * shares : null;

  return {
    accessionNumber: meta.accessionNumber,
    cik: meta.cik,
    ticker: fields.ticker,
    companyName: fields.companyName,
    insiderName: fields.insiderName,
    role: fields.role,
    transactionCode: fields.transactionCode.toUpperCase(),
    shares,
    pricePerShare: price,
    totalValueUsd,
    isOpenMarketBuy: isBuy,
    filedAt: meta.filedAt,
    transactionDate,
    documentUrl: meta.documentUrl ?? null,
  };
}

/**
 * Cluster open-market buys by ticker within a rolling window.
 * As-of `asOf` (ISO), consider buys with filedAt in [asOf - windowDays, asOf].
 */
export function detectForm4Clusters(
  transactions: readonly Form4Transaction[],
  thresholds: Form4ClusterThresholds = DEFAULT_FORM4_CLUSTER_THRESHOLDS,
  asOf: string = new Date().toISOString(),
): Form4Cluster[] {
  const asOfMs = Date.parse(asOf);
  const windowMs = thresholds.windowDays * 86_400_000;
  const windowStartMs = asOfMs - windowMs;

  const byTicker = new Map<string, Form4Transaction[]>();
  for (const tx of transactions) {
    if (!tx.isOpenMarketBuy) continue;
    if (!tx.ticker) continue;
    const filedMs = Date.parse(tx.filedAt);
    if (!Number.isFinite(filedMs)) continue;
    if (filedMs < windowStartMs || filedMs > asOfMs) continue;
    const list = byTicker.get(tx.ticker) ?? [];
    list.push(tx);
    byTicker.set(tx.ticker, list);
  }

  const clusters: Form4Cluster[] = [];
  for (const [ticker, txs] of byTicker) {
    const insiders = new Set(txs.map((t) => t.insiderName.toLowerCase()));
    const clusterValueUsd = txs.reduce(
      (sum, t) => sum + (t.totalValueUsd ?? 0),
      0,
    );
    if (insiders.size < thresholds.minInsiders) continue;
    if (clusterValueUsd < thresholds.minTotalValueUsd) continue;

    const filedAts = txs.map((t) => Date.parse(t.filedAt));
    const windowStart = new Date(Math.min(...filedAts)).toISOString();
    const windowEnd = new Date(Math.max(...filedAts)).toISOString();

    clusters.push({
      ticker,
      companyName: txs[0]?.companyName ?? null,
      insiderCount: insiders.size,
      clusterValueUsd,
      transactions: txs,
      filedAt: windowEnd,
      windowStart,
      windowEnd,
    });
  }
  return clusters;
}

function firstTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const m = xml.match(re);
  return m?.[1]?.trim() || null;
}

/** nested <tag><value>X</value></tag> */
function firstValueTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>\\s*<value>([^<]*)</value>`, "i");
  const m = xml.match(re);
  return m?.[1]?.trim() || null;
}

function parseNumber(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
