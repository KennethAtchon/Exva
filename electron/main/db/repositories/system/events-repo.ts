import type { DbClient } from "../../client";
import type { EventRow, EventSourceType, LogLevel } from "@/lib/types";
import { desc } from "drizzle-orm";
import { events } from "../../schema";
import { toEventRow } from "../system/mappers";

export interface EventFilters {
  minLevel?: LogLevel;
  min_level?: LogLevel;
  agentType?: EventSourceType;
  agent_type?: EventSourceType;
  search?: string;
  limit?: number;
  sessionId?: string;
}

const levelRank: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export class EventsRepo {
  constructor(private readonly client: DbClient) {}

  insert(event: Omit<EventRow, "id" | "created_at"> & Partial<Pick<EventRow, "id" | "created_at">>): EventRow {
    const row: EventRow = {
      id: event.id ?? crypto.randomUUID(),
      session_id: event.session_id ?? null,
      trade_id: event.trade_id ?? null,
      cycle_id: event.cycle_id ?? null,
      level: event.level,
      agent_type: event.agent_type ?? null,
      message: event.message,
      created_at: event.created_at ?? new Date().toISOString(),
    };

    this.client.db
      .insert(events)
      .values({
        id: row.id,
        sessionId: row.session_id,
        tradeId: row.trade_id,
        cycleId: row.cycle_id,
        level: row.level,
        agentType: row.agent_type,
        message: row.message,
        createdAt: row.created_at,
      })
      .run();
    return row;
  }

  query(filters: EventFilters = {}): EventRow[] {
    const minLevel = filters.minLevel ?? filters.min_level;
    const agentType = filters.agentType ?? filters.agent_type;
    const limit = Math.min(filters.limit ?? 200, 1000);
    const rows = this.client.db.select().from(events).orderBy(desc(events.createdAt)).limit(limit * 3).all();

    return rows
      .map(toEventRow)
      .filter((event) => !filters.sessionId || event.session_id === filters.sessionId)
      .filter((event) => !minLevel || levelRank[event.level] >= levelRank[minLevel])
      .filter((event) => !agentType || event.agent_type === agentType)
      .filter((event) => !filters.search || event.message.toLowerCase().includes(filters.search.toLowerCase()))
      .slice(0, limit);
  }
}
