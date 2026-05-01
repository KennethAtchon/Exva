import type { DbClient } from "../client";
import type { SessionConfig, SessionStatus, WorkspaceSession } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { toSessionConfig, toSessionStatus, toWorkspaceSession } from "./mappers";

export class SessionRepo {
  constructor(private readonly client: DbClient) {}

  listByStatuses(statuses: SessionStatus[]): WorkspaceSession[] {
    if (statuses.length === 0) return [];

    const placeholders = statuses.map(() => "?").join(", ");
    const rows = this.client.sqlite
      .prepare(`SELECT * FROM sessions WHERE status IN (${placeholders}) ORDER BY created_at ASC`)
      .all(...statuses) as Record<string, unknown>[];

    return rows.map(toWorkspaceSession);
  }

  getFocusedSession(): WorkspaceSession {
    const row = this.client.sqlite
      .prepare("SELECT * FROM sessions WHERE is_focused = 1 LIMIT 1")
      .get() as Record<string, unknown> | undefined;

    if (!row) {
      throw new AppError("Focused session was not found", "NOT_FOUND");
    }

    return toWorkspaceSession(row);
  }

  getFocusedSessionId(): string {
    return this.getFocusedSession().id;
  }

  findById(sessionId: string): WorkspaceSession | null {
    const row = this.client.sqlite
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;

    return row ? toWorkspaceSession(row) : null;
  }

  requireById(sessionId: string): WorkspaceSession {
    const session = this.findById(sessionId);
    if (!session) {
      throw new AppError(`Session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }
    return session;
  }

  getConfig(sessionId = this.getFocusedSessionId()): SessionConfig {
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_strategies WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;

    if (!row) {
      throw new AppError(`Strategy config for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }

    return toSessionConfig(row);
  }

  saveConfig(config: SessionConfig, sessionId = this.getFocusedSessionId()): void {
    this.client.sqlite
      .prepare(
        `
        UPDATE session_strategies SET
          strategy = @strategy,
          max_position_usd = @max_position_usd,
          stop_loss_pct = @stop_loss_pct,
          take_profit_pct = @take_profit_pct,
          max_concurrent_trades = @max_concurrent_trades,
          research_depth = @research_depth,
          daily_loss_limit_usd = @daily_loss_limit_usd,
          profit_target_usd = @profit_target_usd,
          max_api_spend_usd = @max_api_spend_usd,
          human_approval_required = @human_approval_required
        WHERE session_id = @session_id
        `,
      )
      .run({
        ...config,
        session_id: sessionId,
        human_approval_required: config.human_approval_required ? 1 : 0,
      });
  }

  getStatus(sessionId = this.getFocusedSessionId()): SessionStatus {
    const row = this.client.sqlite
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;

    return toSessionStatus(row);
  }

  setStatus(status: SessionStatus, sessionId = this.getFocusedSessionId()): SessionStatus {
    const existing = this.requireById(sessionId);
    const startedAt = status === "active" ? existing.startedAt ?? new Date().toISOString() : existing.startedAt;

    this.client.sqlite
      .prepare(
        `
        UPDATE sessions SET
          status = @status,
          started_at = @started_at,
          updated_at = @updated_at
        WHERE id = @session_id
        `,
      )
      .run({
        session_id: sessionId,
        status,
        started_at: startedAt,
        updated_at: new Date().toISOString(),
      });

    return status;
  }

  uptimeMin(sessionId = this.getFocusedSessionId()): number {
    const session = this.requireById(sessionId);
    if (session.status !== "active" || !session.startedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 60000));
  }
}
