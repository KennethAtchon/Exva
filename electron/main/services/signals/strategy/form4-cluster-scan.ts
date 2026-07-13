import {
  computeDedupeKey,
  DEFAULT_SIGNAL_TTL,
  type MarketSignal,
} from "@electron/shared/domain/market-signal";
import {
  detectForm4Clusters,
  type Form4Cluster,
  type Form4ClusterThresholds,
  type Form4Transaction,
  DEFAULT_FORM4_CLUSTER_THRESHOLDS,
} from "../form4/form4-parser";

export function form4ClusterToMarketSignal(
  cluster: Form4Cluster,
  opts?: { sourceId?: string; now?: string },
): MarketSignal {
  const now = opts?.now ?? new Date().toISOString();
  const sourceId = opts?.sourceId ?? "schedule:form4-insider-cluster";
  const accession =
    cluster.transactions.map((t) => t.accessionNumber).sort()[0] ?? "cluster";
  return {
    id: crypto.randomUUID(),
    sourceId,
    kind: "filing",
    instrumentClass: "stock",
    symbols: [cluster.ticker],
    occurredAt: cluster.filedAt,
    detectedAt: now,
    ttl: DEFAULT_SIGNAL_TTL.filing,
    dedupeKey: computeDedupeKey("filing", {
      form: "4",
      ticker: cluster.ticker,
      windowStart: cluster.windowStart.slice(0, 10),
      windowEnd: cluster.windowEnd.slice(0, 10),
      insiders: String(cluster.insiderCount),
    }),
    provenance: {
      url: cluster.transactions[0]?.documentUrl ?? undefined,
      raw: { accession, clusterValueUsd: cluster.clusterValueUsd },
    },
    payload: {
      filingType: "4",
      accessionNumber: accession,
      itemCodes: ["FORM4_CLUSTER"],
      companyName: cluster.companyName,
      documentUrl:
        cluster.transactions[0]?.documentUrl ??
        `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=&type=4`,
      filedAt: cluster.filedAt,
      polarityHint: "positive",
      form4: {
        transactionCode: "P",
        role: "cluster",
        shares: cluster.transactions.reduce((s, t) => s + t.shares, 0),
        pricePerShare: null,
        totalValueUsd: cluster.clusterValueUsd,
        isOpenMarketBuy: true,
        clusterSize: cluster.transactions.length,
        clusterValueUsd: cluster.clusterValueUsd,
        insiderCount: cluster.insiderCount,
      },
    },
  };
}

export function scanForm4Clusters(
  transactions: readonly Form4Transaction[],
  thresholds: Form4ClusterThresholds = DEFAULT_FORM4_CLUSTER_THRESHOLDS,
  asOf?: string,
): MarketSignal[] {
  return detectForm4Clusters(transactions, thresholds, asOf).map((c) =>
    form4ClusterToMarketSignal(c, { now: asOf }),
  );
}
