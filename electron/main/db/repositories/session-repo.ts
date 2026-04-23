import type { DbClient } from "../client";
import type { SessionConfig, SessionStatus } from "@/lib/types";
import { toSessionConfig, toSessionStatus } from "./mappers";

export class SessionRepo {
  constructor(private readonly client: DbClient) {}

  getConfig(): SessionConfig {
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_config WHERE id = 1")
      .get() as Record<string, unknown>;
    return toSessionConfig(row);
  }

  saveConfig(config: SessionConfig): void {
    this.client.sqlite
      .prepare(
        `
        UPDATE session_config SET
          strategy = @strategy,
          max_position_usd = @max_position_usd,
          stop_loss_pct = @stop_loss_pct,
          take_profit_pct = @take_profit_pct,
          max_concurrent_trades = @max_concurrent_trades,
          research_depth = @research_depth,
          daily_loss_limit_usd = @daily_loss_limit_usd,
          profit_target_usd = @profit_target_usd,
          max_api_spend_usd = @max_api_spend_usd,
          human_approval_required = @human_approval_required,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
        `,
      )
      .run({
        ...config,
        human_approval_required: config.human_approval_required ? 1 : 0,
      });
  }

  getStatus(): SessionStatus {
    const row = this.client.sqlite
      .prepare("SELECT status FROM session_state WHERE id = 1")
      .get() as Record<string, unknown> | undefined;
    return toSessionStatus(row);
  }

  setStatus(status: SessionStatus): SessionStatus {
    const existing = this.client.sqlite
      .prepare("SELECT started_at FROM session_state WHERE id = 1")
      .get() as { started_at?: string | null } | undefined;
    const startedAt = status === "active" ? (existing?.started_at ?? new Date().toISOString()) : existing?.started_at;

    this.client.sqlite
      .prepare(
        `
        INSERT INTO session_state (id, status, started_at, updated_at)
        VALUES (1, @status, @started_at, @updated_at)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          started_at = excluded.started_at,
          updated_at = excluded.updated_at
        `,
      )
      .run({
        status,
        started_at: startedAt ?? null,
        updated_at: new Date().toISOString(),
      });
    return status;
  }

  uptimeMin(): number {
    const row = this.client.sqlite
      .prepare("SELECT status, started_at FROM session_state WHERE id = 1")
      .get() as { status?: string; started_at?: string | null } | undefined;
    if (row?.status !== "active" || !row.started_at) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(row.started_at).getTime()) / 60000));
  }
}
