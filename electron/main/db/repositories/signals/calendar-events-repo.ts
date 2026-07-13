import { and, eq, gte, lte, isNull, or, inArray } from "drizzle-orm";
import type { DbClient } from "../../../db/client";
import { calendarEvents } from "../../../db/schema";
import type { MacroCalendarSeedRow } from "../../../services/signals/sources/macro-calendar-seed";

export interface CalendarEventRow {
  id: string;
  eventType: string;
  scheduledAt: string;
  symbol: string | null;
  title: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export class CalendarEventsRepo {
  constructor(private readonly db: DbClient) {}

  upsert(input: {
    id?: string;
    eventType: string;
    scheduledAt: string;
    symbol?: string | null;
    title?: string | null;
    source: string;
  }): CalendarEventRow {
    const now = new Date().toISOString();
    const existing = this.findDuplicate(input);
    if (existing) {
      this.db.db
        .update(calendarEvents)
        .set({
          title: input.title ?? existing.title,
          updatedAt: now,
        })
        .where(eq(calendarEvents.id, existing.id))
        .run();
      const updated = this.get(existing.id);
      if (!updated) throw new Error("calendar event update vanished");
      return updated;
    }
    const id = input.id ?? crypto.randomUUID();
    this.db.db
      .insert(calendarEvents)
      .values({
        id,
        eventType: input.eventType,
        scheduledAt: input.scheduledAt,
        symbol: input.symbol ?? null,
        title: input.title ?? null,
        source: input.source,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const created = this.get(id);
    if (!created) throw new Error("calendar event insert vanished");
    return created;
  }

  get(id: string): CalendarEventRow | null {
    const row = this.db.db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .get();
    return row ? mapRow(row) : null;
  }

  listUpcoming(opts: {
    withinHours: number;
    symbols?: string[];
    nowMs?: number;
  }): CalendarEventRow[] {
    const nowMs = opts.nowMs ?? Date.now();
    const from = new Date(nowMs - 60_000).toISOString();
    const to = new Date(nowMs + opts.withinHours * 3_600_000).toISOString();
    const rows = this.db.db
      .select()
      .from(calendarEvents)
      .where(
        and(
          gte(calendarEvents.scheduledAt, from),
          lte(calendarEvents.scheduledAt, to),
        ),
      )
      .all()
      .map(mapRow);

    if (!opts.symbols || opts.symbols.length === 0) return rows;
    const want = new Set(opts.symbols.map((s) => s.toUpperCase()));
    return rows.filter(
      (r) =>
        r.symbol == null ||
        want.has(r.symbol.toUpperCase()) ||
        r.eventType === "fomc" ||
        r.eventType === "cpi",
    );
  }

  /**
   * Events that should blackout a symbol within ±hours.
   * Includes symbol-specific events and global macro (FOMC/CPI).
   */
  listForBlackout(opts: {
    symbol: string;
    blackoutHours: number;
    nowMs?: number;
  }): CalendarEventRow[] {
    const nowMs = opts.nowMs ?? Date.now();
    const from = new Date(nowMs - opts.blackoutHours * 3_600_000).toISOString();
    const to = new Date(nowMs + opts.blackoutHours * 3_600_000).toISOString();
    const symbol = opts.symbol.toUpperCase();
    return this.db.db
      .select()
      .from(calendarEvents)
      .where(
        and(
          gte(calendarEvents.scheduledAt, from),
          lte(calendarEvents.scheduledAt, to),
          or(
            eq(calendarEvents.symbol, symbol),
            isNull(calendarEvents.symbol),
            inArray(calendarEvents.eventType, ["fomc", "cpi"]),
          ),
        ),
      )
      .all()
      .map(mapRow)
      .filter((r) => {
        if (r.eventType === "fomc" || r.eventType === "cpi") return true;
        if (r.symbol == null) return true;
        return r.symbol.toUpperCase() === symbol;
      });
  }

  seedMacroEvents(rows: MacroCalendarSeedRow[]): number {
    let inserted = 0;
    for (const row of rows) {
      const before = this.findDuplicate({
        eventType: row.eventType,
        scheduledAt: row.scheduledAt,
        symbol: null,
        source: "macro_seed",
      });
      if (before) continue;
      this.upsert({
        eventType: row.eventType,
        scheduledAt: row.scheduledAt,
        symbol: null,
        title: row.title,
        source: "macro_seed",
      });
      inserted += 1;
    }
    return inserted;
  }

  listAll(): CalendarEventRow[] {
    return this.db.db.select().from(calendarEvents).all().map(mapRow);
  }

  private findDuplicate(input: {
    eventType: string;
    scheduledAt: string;
    symbol?: string | null;
    source: string;
  }): CalendarEventRow | null {
    const rows = this.db.db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.eventType, input.eventType),
          eq(calendarEvents.scheduledAt, input.scheduledAt),
          eq(calendarEvents.source, input.source),
        ),
      )
      .all()
      .map(mapRow);
    const symbol = input.symbol ?? null;
    return rows.find((r) => (r.symbol ?? null) === symbol) ?? null;
  }
}

function mapRow(row: typeof calendarEvents.$inferSelect): CalendarEventRow {
  return {
    id: row.id,
    eventType: row.eventType,
    scheduledAt: row.scheduledAt,
    symbol: row.symbol,
    title: row.title,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
