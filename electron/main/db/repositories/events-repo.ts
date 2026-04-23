import type { DbClient } from "../client";
import type { AgentType, EventRow, LogLevel } from "@/lib/types";
import { toEventRow } from "./mappers";

export interface EventFilters {
  minLevel?: LogLevel;
  min_level?: LogLevel;
  agentType?: AgentType;
  agent_type?: AgentType;
  search?: string;
  limit?: number;
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
      trade_id: event.trade_id ?? null,
      level: event.level,
      agent_type: event.agent_type ?? null,
      message: event.message,
      created_at: event.created_at ?? new Date().toISOString(),
    };

    this.client.sqlite
      .prepare(
        `
        INSERT INTO events (id, trade_id, level, agent_type, message, created_at)
        VALUES (@id, @trade_id, @level, @agent_type, @message, @created_at)
        `,
      )
      .run(row);
    return row;
  }

  query(filters: EventFilters = {}): EventRow[] {
    const minLevel = filters.minLevel ?? filters.min_level;
    const agentType = filters.agentType ?? filters.agent_type;
    const limit = Math.min(filters.limit ?? 200, 1000);
    const rows = this.client.sqlite
      .prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT ?")
      .all(limit * 3) as Record<string, unknown>[];

    return rows
      .map(toEventRow)
      .filter((event) => !minLevel || levelRank[event.level] >= levelRank[minLevel])
      .filter((event) => !agentType || event.agent_type === agentType)
      .filter((event) => !filters.search || event.message.toLowerCase().includes(filters.search.toLowerCase()))
      .slice(0, limit);
  }
}
