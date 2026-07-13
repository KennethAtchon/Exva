import { desc, eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import { briefings } from "../../schema";

export interface BriefingDoc {
  date: string;
  yesterdayPnlUsd: number;
  openPositions: number;
  tradesOpened: number;
  tradesClosed: number;
  tradeSummaries: Array<{
    symbol: string;
    side: string;
    pnlUsd: number | null;
    reason: string;
  }>;
  ladderNotes: string[];
  calibrationNotes: string[];
  calendarEvents: Array<{
    title: string;
    scheduledAt: string;
    symbol: string | null;
  }>;
  alarms: Array<{ kind: string; message: string }>;
  aiSpendUsd: number;
  aiBudgetUsd: number;
  dataCoverageStatus: string;
  headlineNumbers: {
    pnl: number;
    trades: number;
    open: number;
  };
}

export interface BriefingRow {
  date: string;
  doc: BriefingDoc;
  narrative: string;
  createdAt: string;
}

export class BriefingsRepo {
  constructor(private readonly client: DbClient) {}

  upsert(row: {
    date: string;
    doc: BriefingDoc;
    narrative: string;
    createdAt?: string;
  }): BriefingRow {
    const createdAt = row.createdAt ?? new Date().toISOString();
    this.client.db
      .insert(briefings)
      .values({
        date: row.date,
        docJson: JSON.stringify(row.doc),
        narrative: row.narrative,
        createdAt,
      })
      .onConflictDoUpdate({
        target: briefings.date,
        set: {
          docJson: JSON.stringify(row.doc),
          narrative: row.narrative,
          createdAt,
        },
      })
      .run();
    return {
      date: row.date,
      doc: row.doc,
      narrative: row.narrative,
      createdAt,
    };
  }

  getByDate(date: string): BriefingRow | null {
    const row = this.client.db
      .select()
      .from(briefings)
      .where(eq(briefings.date, date))
      .get();
    return row ? toBriefing(row) : null;
  }

  listRecent(limit = 30): BriefingRow[] {
    return this.client.db
      .select()
      .from(briefings)
      .orderBy(desc(briefings.date))
      .limit(limit)
      .all()
      .map(toBriefing);
  }

  latest(): BriefingRow | null {
    return this.listRecent(1)[0] ?? null;
  }
}

function toBriefing(row: typeof briefings.$inferSelect): BriefingRow {
  let doc: BriefingDoc;
  try {
    doc = JSON.parse(row.docJson) as BriefingDoc;
  } catch {
    doc = {
      date: row.date,
      yesterdayPnlUsd: 0,
      openPositions: 0,
      tradesOpened: 0,
      tradesClosed: 0,
      tradeSummaries: [],
      ladderNotes: [],
      calibrationNotes: [],
      calendarEvents: [],
      alarms: [],
      aiSpendUsd: 0,
      aiBudgetUsd: 0,
      dataCoverageStatus: "unknown",
      headlineNumbers: { pnl: 0, trades: 0, open: 0 },
    };
  }
  return {
    date: row.date,
    doc,
    narrative: row.narrative,
    createdAt: row.createdAt,
  };
}
