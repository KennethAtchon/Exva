import type {
  BriefingsRepo,
  BriefingDoc,
  BriefingRow,
} from "../../db/repositories/system/briefings-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { SupervisorService } from "../supervisor/supervisor-service";
import type { NotificationService } from "../infra/notification-service";
import type { DataDoctorService } from "./data-doctor-service";
import type { DbClient } from "../../db/client";
import { calendarEvents } from "../../db/schema";
import { and, gte, lte } from "drizzle-orm";

export interface MorningBriefingDeps {
  briefings: BriefingsRepo;
  trades: TradesRepo;
  sessions: SessionRepo;
  apiCallLog: ApiCallLogRepo;
  db: DbClient;
  supervisor: SupervisorService;
  notifications: NotificationService;
  dataDoctor: DataDoctorService;
  /** Optional LLM narrative; when omitted, a deterministic template is used. */
  narrate?: (doc: BriefingDoc) => Promise<string>;
  /** Deliver to phone sinks (ntfy/telegram). */
  deliverSink?: (title: string, body: string) => Promise<void> | void;
  getAiBudgetUsd?: () => number;
  /** Promotion-ladder notes for the briefing. */
  getLadderNotes?: () => string[];
  /** Calibration status notes for the briefing. */
  getCalibrationNotes?: () => string[];
}

/**
 * Nightly morning briefing assembly (finish-line 08 T4).
 * Deterministic doc + optional LLM 3-sentence narrative.
 */
export class MorningBriefingService {
  constructor(private readonly deps: MorningBriefingDeps) {}

  async assemble(forDate = yesterdayUtcDate()): Promise<BriefingRow> {
    const dayStart = `${forDate}T00:00:00.000Z`;
    const dayEnd = `${forDate}T23:59:59.999Z`;
    const closed = this.deps.trades.listClosedInWindow({
      windowStart: dayStart,
      windowEnd: dayEnd,
    });
    const openNow = this.deps.trades.listOpenAndPending();
    const opened = this.deps.trades
      .listAllFiltered({})
      .filter(
        (t) => t.opened_at && t.opened_at >= dayStart && t.opened_at <= dayEnd,
      );
    const yesterdayPnlUsd = closed.reduce(
      (sum, t) => sum + (t.final_pnl_usd ?? 0),
      0,
    );

    const tradeSummaries = [...opened, ...closed].slice(0, 20).map((t) => ({
      symbol: t.instrumentSymbol,
      side: t.side,
      pnlUsd: t.final_pnl_usd ?? t.unrealized_pnl ?? null,
      reason: t.exit_reason ?? t.status,
    }));

    const sessions = this.deps.sessions.list({ includeArchived: false });
    let aiSpendUsd = 0;
    for (const s of sessions) {
      aiSpendUsd += this.deps.apiCallLog.dailyDataSpendUsd(s.id, forDate);
    }
    const aiBudgetUsd = this.deps.getAiBudgetUsd?.() ?? 25;

    const alarms = this.deps.supervisor.getAlarms().map((a) => ({
      kind: a.kind,
      message: a.message,
    }));

    const matrix = this.deps.dataDoctor.coverageMatrix();
    const stale = matrix.filter((c) => c.freshness !== "fresh").length;
    const gaps = matrix.reduce((n, c) => n + c.gapCount, 0);
    const dataCoverageStatus =
      matrix.length === 0
        ? "no coverage rows"
        : `${matrix.length} cells · ${stale} stale/dead · ${gaps} gaps`;

    const heldSymbols = new Set(
      openNow.map((t) => t.instrumentSymbol).filter(Boolean),
    );

    const upcoming = this.deps.db.db
      .select({
        title: calendarEvents.title,
        scheduledAt: calendarEvents.scheduledAt,
        symbol: calendarEvents.symbol,
      })
      .from(calendarEvents)
      .where(
        and(
          gte(calendarEvents.scheduledAt, dayEnd),
          lte(
            calendarEvents.scheduledAt,
            new Date(
              Date.parse(dayEnd) + 7 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          ),
        ),
      )
      .limit(40)
      .all()
      .filter(
        (r) =>
          r.symbol == null ||
          heldSymbols.size === 0 ||
          heldSymbols.has(r.symbol),
      )
      .slice(0, 12)
      .map((r) => ({
        title: r.title ?? "Event",
        scheduledAt: r.scheduledAt,
        symbol: r.symbol,
      }));

    const ladderNotes = this.deps.getLadderNotes?.() ?? [];
    const calibrationNotes = this.deps.getCalibrationNotes?.() ?? [];

    const doc: BriefingDoc = {
      date: forDate,
      yesterdayPnlUsd,
      openPositions: openNow.length,
      tradesOpened: opened.length,
      tradesClosed: closed.length,
      tradeSummaries,
      ladderNotes,
      calibrationNotes,
      calendarEvents: upcoming,
      alarms: alarms.slice(0, 10),
      aiSpendUsd,
      aiBudgetUsd,
      dataCoverageStatus,
      headlineNumbers: {
        pnl: yesterdayPnlUsd,
        trades: opened.length + closed.length,
        open: openNow.length,
      },
    };

    let narrative: string;
    try {
      narrative =
        (await this.deps.narrate?.(doc)) ?? buildDeterministicNarrative(doc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.notifications.notify("Briefing narrative failed", msg, "WARN");
      narrative = buildDeterministicNarrative(doc);
    }

    const row = this.deps.briefings.upsert({
      date: forDate,
      doc,
      narrative,
    });

    const title = `Exva briefing ${forDate}`;
    const body = [
      narrative,
      "",
      `P&L ${fmtUsd(yesterdayPnlUsd)} · ${opened.length} opened / ${closed.length} closed · ${openNow.length} open`,
      `AI $${aiSpendUsd.toFixed(2)} / $${aiBudgetUsd.toFixed(2)} · ${dataCoverageStatus}`,
      ladderNotes.length > 0 ? `Ladder: ${ladderNotes.join("; ")}` : null,
      calibrationNotes.length > 0
        ? `Calibration: ${calibrationNotes.join("; ")}`
        : null,
      "",
      "Open Exva → Dashboard for full briefing.",
    ]
      .filter((line) => line != null)
      .join("\n");

    this.deps.notifications.notify(title, body, "INFO");
    try {
      await this.deps.deliverSink?.(title, body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.notifications.notify("Briefing delivery failed", msg, "ERROR");
      throw err;
    }

    return row;
  }

  latest(): BriefingRow | null {
    return this.deps.briefings.latest();
  }

  list(limit = 30): BriefingRow[] {
    return this.deps.briefings.listRecent(limit);
  }

  get(date: string): BriefingRow | null {
    return this.deps.briefings.getByDate(date);
  }
}

function yesterdayUtcDate(now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function buildDeterministicNarrative(doc: BriefingDoc): string {
  const pnl = fmtUsd(doc.yesterdayPnlUsd);
  const cal =
    doc.calendarEvents[0] != null
      ? ` Next up: ${doc.calendarEvents[0].title}${doc.calendarEvents[0].symbol ? ` (${doc.calendarEvents[0].symbol})` : ""}.`
      : "";
  const alarm =
    doc.alarms.length > 0
      ? ` ${doc.alarms.length} supervisor alarm(s) need a look.`
      : " Calibration and coverage look stable.";
  return `${pnl} yesterday; ${doc.tradesOpened} opened / ${doc.tradesClosed} closed; ${doc.openPositions} still open.${cal}${alarm}`;
}

function fmtUsd(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(0)}`;
}

export { yesterdayUtcDate };
