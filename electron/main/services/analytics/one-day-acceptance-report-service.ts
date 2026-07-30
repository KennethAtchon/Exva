import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import {
  cycleFunnelOutcomes,
  form4Transactions,
  paperCertificationRuns,
  scanEvaluationOutcomes,
  signalSourceRuntimeStates,
  trades,
} from "../../db/schema";
import type { OpportunityRateService } from "./opportunity-rate-service";
import type { SessionUptimeService } from "../session/session-uptime-service";
import type { ScanFunnelService } from "../scheduling/scan-funnel-service";
import type { AdapterCertificationService } from "../broker/adapter-certification-service";
import { dayKeyEt } from "../scheduling/schedule-grid";

export interface OneDayAcceptanceReport {
  sessionId: string;
  dayKey: string;
  generatedAt: string;
  uptime: {
    coveragePct: number;
    liveMinutes: number;
    eligibleWindowMinutes: number;
    sufficient: boolean;
    firstEligibleScanAt: string | null;
    minutesLateAtOpen: number | null;
    unplannedStops: number;
  } | null;
  setupRate: {
    included: boolean;
    refusalReason?: string;
    eligibleEvaluations: number;
    setups: number;
    setupRate: number;
    blockedByHistory: number;
    blockedByHistoryRate: number;
    repeatEvaluations: number;
    expectedSetupsPerDay: number;
  };
  certification: {
    paperCertRunIds: string[];
    adapterCertRunIds: string[];
  };
  freshInputs: {
    signalSources: Array<{
      sourceId: string;
      detected: number;
      passed: number;
      dropped: number;
      lastOutcome: string | null;
    }>;
    edgarForm4Rows: number;
  };
  barsVsMin: {
    insufficientHistoryEvals: number;
    totalEvals: number;
  };
  aiFailures: {
    totalCycles: number;
    failedCycles: number;
    failureRate: number;
    topReasons: Array<{ reasonCode: string; count: number }>;
  };
  polymarketCatchUp: {
    polymarketSources: number;
    consecutiveFailures: number;
  };
  orders: {
    placed: number;
    filled: number;
    closed: number;
    certificationTrades: number;
  };
  sentinelBlockers: string[];
  scanFunnel: ReturnType<ScanFunnelService["forSession"]> | null;
  opportunityRate: ReturnType<OpportunityRateService["summarize"]>;
}

export interface OneDayAcceptanceReportDeps {
  db: DbClient;
  sessionUptime: SessionUptimeService;
  opportunityRate: OpportunityRateService;
  scanFunnel: ScanFunnelService;
  adapterCertification?: AdapterCertificationService;
  listAssignedBrokerAccountIds: (sessionId: string) => string[];
  isSentinelSession: (sessionId: string, sessionName: string) => boolean;
  getSessionName: (sessionId: string) => string;
  getExperienceSupportState: (experienceId: string) => string;
  getExperienceBlocker: (experienceId: string) => string | null;
}

export class OneDayAcceptanceReportService {
  constructor(private readonly deps: OneDayAcceptanceReportDeps) {}

  generate(sessionId: string, dayKey?: string): OneDayAcceptanceReport {
    const key = dayKey ?? dayKeyEt(new Date());
    const uptime = this.deps.sessionUptime.coverage(sessionId, key);
    const opportunity = this.deps.opportunityRate.summarize(sessionId, key);

    let setupRateIncluded = false;
    let setupRateRefusal: string | undefined;
    if (!uptime) {
      setupRateRefusal = "no uptime row — refuse setup-rate conclusions";
    } else if (!uptime.sufficient) {
      setupRateRefusal = `uptime coverage ${uptime.coveragePct.toFixed(1)}% below 90%`;
    } else {
      setupRateIncluded = true;
    }

    const paperCerts = this.deps.db.db
      .select({ id: paperCertificationRuns.id })
      .from(paperCertificationRuns)
      .where(
        and(
          eq(paperCertificationRuns.sessionId, sessionId),
          gte(paperCertificationRuns.armedAt, `${key}T00:00:00.000Z`),
          lt(paperCertificationRuns.armedAt, nextDayIso(key)),
        ),
      )
      .all();

    const brokerIds = this.deps.listAssignedBrokerAccountIds(sessionId);
    const adapterCertRunIds: string[] = [];
    if (this.deps.adapterCertification) {
      for (const brokerId of brokerIds) {
        const latest = this.deps.adapterCertification.getLatest(brokerId);
        if (latest && latest.certifiedAt.startsWith(key)) {
          adapterCertRunIds.push(latest.certRunId);
        }
      }
    }

    const signalSources = this.deps.db.db
      .select()
      .from(signalSourceRuntimeStates)
      .all()
      .map((row) => ({
        sourceId: row.sourceId,
        detected: row.detected,
        passed: row.passed,
        dropped: row.dropped,
        lastOutcome: row.lastOutcome,
      }));

    const edgarForm4Rows = this.deps.db.db
      .select({ count: sql<number>`count(*)` })
      .from(form4Transactions)
      .where(
        and(
          gte(form4Transactions.filedAt, `${key}T00:00:00.000Z`),
          lt(form4Transactions.filedAt, nextDayIso(key)),
        ),
      )
      .get()?.count ?? 0;

    const evalRows = this.deps.db.db
      .select()
      .from(scanEvaluationOutcomes)
      .where(
        and(
          eq(scanEvaluationOutcomes.sessionId, sessionId),
          eq(scanEvaluationOutcomes.dayKey, key),
        ),
      )
      .all();

    const insufficientHistoryEvals = evalRows.filter(
      (r) => r.outcome === "insufficient_history",
    ).length;

    const cycleRows = this.deps.db.db
      .select()
      .from(cycleFunnelOutcomes)
      .where(
        and(
          eq(cycleFunnelOutcomes.sessionId, sessionId),
          gte(cycleFunnelOutcomes.occurredAt, `${key}T00:00:00.000Z`),
          lt(cycleFunnelOutcomes.occurredAt, nextDayIso(key)),
        ),
      )
      .all();

    const failedCycles = cycleRows.filter(
      (r) => r.outcome === "failed" || r.outcome === "rejected",
    );
    const reasonCounts = new Map<string, number>();
    for (const row of failedCycles) {
      const code = row.reasonCode ?? "unknown";
      reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
    }
    const topReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([reasonCode, count]) => ({ reasonCode, count }));

    const polymarketSources = signalSources.filter((s) =>
      s.sourceId.toLowerCase().includes("polymarket"),
    );
    const pmFailures = this.deps.db.db
      .select()
      .from(signalSourceRuntimeStates)
      .where(sql`lower(${signalSourceRuntimeStates.sourceId}) like '%polymarket%'`)
      .all()
      .reduce((max, row) => Math.max(max, row.consecutiveFailures), 0);

    const dayTrades = this.deps.db.db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.sessionId, sessionId),
          gte(trades.openedAt, `${key}T00:00:00.000Z`),
          lt(trades.openedAt, nextDayIso(key)),
        ),
      )
      .all();

    const sessionName = this.deps.getSessionName(sessionId);
    const sentinelBlockers: string[] = [];
    if (this.deps.isSentinelSession(sessionId, sessionName)) {
      sentinelBlockers.push("sentinel session — excluded from promotion metrics");
    }

    let scanFunnelReport: ReturnType<ScanFunnelService["forSession"]> | null =
      null;
    try {
      scanFunnelReport = this.deps.scanFunnel.forSession(sessionId);
    } catch {
      scanFunnelReport = null;
    }

    return {
      sessionId,
      dayKey: key,
      generatedAt: new Date().toISOString(),
      uptime,
      setupRate: {
        included: setupRateIncluded,
        refusalReason: setupRateRefusal,
        eligibleEvaluations: opportunity.eligibleEvaluations,
        setups: opportunity.setups,
        setupRate: setupRateIncluded ? opportunity.setupRate : 0,
        blockedByHistory: opportunity.blockedByHistory,
        blockedByHistoryRate: opportunity.blockedByHistoryRate,
        repeatEvaluations: opportunity.repeatEvaluations,
        expectedSetupsPerDay: setupRateIncluded
          ? opportunity.expectedSetupsPerDay
          : 0,
      },
      certification: {
        paperCertRunIds: paperCerts.map((r) => r.id),
        adapterCertRunIds,
      },
      freshInputs: {
        signalSources,
        edgarForm4Rows,
      },
      barsVsMin: {
        insufficientHistoryEvals,
        totalEvals: evalRows.length,
      },
      aiFailures: {
        totalCycles: cycleRows.length,
        failedCycles: failedCycles.length,
        failureRate:
          cycleRows.length > 0 ? failedCycles.length / cycleRows.length : 0,
        topReasons,
      },
      polymarketCatchUp: {
        polymarketSources: polymarketSources.length,
        consecutiveFailures: pmFailures,
      },
      orders: {
        placed: dayTrades.length,
        filled: dayTrades.filter((t) => t.entryPrice != null).length,
        closed: dayTrades.filter((t) => t.closedAt != null).length,
        certificationTrades: dayTrades.filter(
          (t) => t.originKind === "certification",
        ).length,
      },
      sentinelBlockers,
      scanFunnel: scanFunnelReport,
      opportunityRate: opportunity,
    };
  }
}

export function formatOneDayAcceptanceReport(
  report: OneDayAcceptanceReport,
): string {
  const lines = [
    `=== One-day acceptance report: ${report.sessionId} (${report.dayKey}) ===`,
    `Generated: ${report.generatedAt}`,
    "",
    "## Uptime (first)",
  ];
  if (report.uptime) {
    lines.push(
      `  coverage: ${report.uptime.coveragePct.toFixed(1)}% (${report.uptime.liveMinutes}/${report.uptime.eligibleWindowMinutes} min)`,
      `  late-at-open: ${report.uptime.minutesLateAtOpen ?? "n/a"} min`,
      `  unplanned stops: ${report.uptime.unplannedStops}`,
      `  first eligible scan: ${report.uptime.firstEligibleScanAt ?? "none"}`,
    );
  } else {
    lines.push("  NO UPTIME ROW — refuse downstream conclusions");
  }

  lines.push("", "## Setup rate / opportunity");
  if (report.setupRate.included) {
    lines.push(
      `  eligible evals: ${report.setupRate.eligibleEvaluations}`,
      `  setups: ${report.setupRate.setups}`,
      `  setup rate: ${(report.setupRate.setupRate * 100).toFixed(1)}%`,
      `  blocked by history: ${report.setupRate.blockedByHistory} (${(report.setupRate.blockedByHistoryRate * 100).toFixed(1)}%)`,
    );
  } else {
    lines.push(`  REFUSED: ${report.setupRate.refusalReason}`);
  }

  lines.push(
    "",
    "## Certification IDs",
    `  paper cert runs: ${report.certification.paperCertRunIds.join(", ") || "none"}`,
    `  adapter cert runs: ${report.certification.adapterCertRunIds.join(", ") || "none"}`,
    "",
    "## Fresh inputs",
    `  EDGAR Form4 rows: ${report.freshInputs.edgarForm4Rows}`,
    `  signal sources tracked: ${report.freshInputs.signalSources.length}`,
    "",
    "## Bars vs min",
    `  insufficient_history evals: ${report.barsVsMin.insufficientHistoryEvals} / ${report.barsVsMin.totalEvals}`,
    "",
    "## AI / cycle failures",
    `  failed cycles: ${report.aiFailures.failedCycles}/${report.aiFailures.totalCycles}`,
  );
  for (const r of report.aiFailures.topReasons) {
    lines.push(`    ${r.reasonCode}: ${r.count}`);
  }

  lines.push(
    "",
    "## Polymarket catch-up",
    `  sources: ${report.polymarketCatchUp.polymarketSources}`,
    `  max consecutive failures: ${report.polymarketCatchUp.consecutiveFailures}`,
    "",
    "## Orders / fills",
    `  placed: ${report.orders.placed} · filled: ${report.orders.filled} · closed: ${report.orders.closed} · certification: ${report.orders.certificationTrades}`,
  );

  if (report.sentinelBlockers.length > 0) {
    lines.push("", "## Sentinel blockers", ...report.sentinelBlockers.map((b) => `  - ${b}`));
  }

  return lines.join("\n");
}

function nextDayIso(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
