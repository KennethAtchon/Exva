import type { DbClient } from "../client";
import type { SessionConfig, SessionStatus, WorkspaceSession } from "@/lib/types";
import { canTransition, isSessionEditable } from "@electron/shared/domain";
import { AppError } from "@electron/shared/errors";
import { toSessionConfig, toWorkspaceSession } from "./mappers";

export interface SessionFilters {
  statuses?: SessionStatus[];
  includeArchived?: boolean;
}

export interface CreateSessionInput {
  name: string;
  objective: string;
  selectionMode: WorkspaceSession["selectionMode"];
  instrumentClasses: WorkspaceSession["instrumentClasses"];
  instrumentScope: string;
  defaultSearchProviderId?: string | null;
  capitalLimitUsd: number;
  executionMode: WorkspaceSession["executionMode"];
  isFocused?: boolean;
}

export interface TaskBoundaryInput {
  name: string;
  objective: string;
  selectionMode: WorkspaceSession["selectionMode"];
  instrumentClasses: WorkspaceSession["instrumentClasses"];
  instrumentScope: string;
  defaultSearchProviderId: string | null;
  capitalLimitUsd: number;
  executionMode: WorkspaceSession["executionMode"];
}

export class SessionRepo {
  constructor(private readonly client: DbClient) {}

  create(input: CreateSessionInput): WorkspaceSession {
    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();

    this.client.sqlite.transaction(() => {
      this.client.sqlite
        .prepare(
          `
          INSERT INTO sessions (
            id, name, objective, status, is_focused, selection_mode, instrument_classes,
            instrument_scope, default_search_provider_id, capital_limit_usd, execution_mode,
            created_at, updated_at
          ) VALUES (
            @id, @name, @objective, 'draft', @is_focused, @selection_mode, @instrument_classes,
            @instrument_scope, @default_search_provider_id, @capital_limit_usd, @execution_mode,
            @created_at, @updated_at
          )
          `,
        )
        .run({
          id: sessionId,
          name: input.name,
          objective: input.objective,
          is_focused: input.isFocused ? 1 : 0,
          selection_mode: input.selectionMode,
          instrument_classes: JSON.stringify(input.instrumentClasses),
          instrument_scope: input.instrumentScope,
          default_search_provider_id: input.defaultSearchProviderId ?? null,
          capital_limit_usd: input.capitalLimitUsd,
          execution_mode: input.executionMode,
          created_at: now,
          updated_at: now,
        });

      this.client.sqlite
        .prepare(
          `
          INSERT INTO session_selector_settings (session_id, ai_picker_enabled, updated_at)
          VALUES (?, 1, ?)
          `,
        )
        .run(sessionId, now);

      this.client.sqlite
        .prepare(
          `
          INSERT INTO session_strategies (
            session_id, strategy_profile, max_position_usd, stop_loss_pct, take_profit_pct,
            max_concurrent_trades, research_depth, daily_loss_limit_usd, profit_target_usd,
            max_ai_spend_usd, human_approval_required
          ) VALUES (?, 'passive_income', 500, 2, 4, 3, 'balanced', 200, 1000, 5, 0)
          `,
        )
        .run(sessionId);

      // TODO(phase-05/phase-07): Replace these placeholder role rows with canonical defaults
      // from the session AI role setup flow once provider/model configuration exists.
      for (const role of ["researcher_bull", "researcher_bear", "reviewer", "decision_maker", "instrument_selector"]) {
        this.client.sqlite
          .prepare(
            `
            INSERT INTO session_ai_roles (
              id, session_id, role, provider_key, model_id, temperature,
              max_tokens, web_search_enabled, prompt_source, prompt_markdown, prompt_asset_path
            ) VALUES (?, ?, ?, 'provider-anthropic', 'claude-sonnet-4-6', 0.7, 4096, 0, 'default', '', NULL)
            `,
          )
          .run(`${sessionId}:${role}`, sessionId, role);
      }
    })();

    return this.requireById(sessionId);
  }

  list(filters: SessionFilters = {}): WorkspaceSession[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (!filters.includeArchived) {
      clauses.push("status != 'archived'");
    }

    if (filters.statuses && filters.statuses.length > 0) {
      clauses.push(`status IN (${filters.statuses.map(() => "?").join(", ")})`);
      params.push(...filters.statuses);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.client.sqlite
      .prepare(`SELECT * FROM sessions ${whereClause} ORDER BY created_at ASC`)
      .all(...params) as Record<string, unknown>[];

    return rows.map(toWorkspaceSession);
  }

  listByStatuses(statuses: SessionStatus[]): WorkspaceSession[] {
    return this.list({ statuses, includeArchived: true });
  }

  get(id: string): WorkspaceSession | null {
    const row = this.client.sqlite.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? toWorkspaceSession(row) : null;
  }

  findById(sessionId: string): WorkspaceSession | null {
    return this.get(sessionId);
  }

  requireById(sessionId: string): WorkspaceSession {
    const session = this.get(sessionId);
    if (!session) {
      throw new AppError(`Session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }
    return session;
  }

  setFocus(sessionId: string): void {
    this.requireById(sessionId);

    this.client.sqlite.transaction(() => {
      this.client.sqlite.prepare("UPDATE sessions SET is_focused = 0 WHERE is_focused = 1").run();
      this.client.sqlite.prepare("UPDATE sessions SET is_focused = 1 WHERE id = ?").run(sessionId);
    })();
  }

  clearFocus(): void {
    this.client.sqlite.prepare("UPDATE sessions SET is_focused = 0 WHERE is_focused = 1").run();
  }

  getFocused(): WorkspaceSession | null {
    const row = this.client.sqlite
      .prepare("SELECT * FROM sessions WHERE is_focused = 1 AND status != 'archived' LIMIT 1")
      .get() as Record<string, unknown> | undefined;

    return row ? toWorkspaceSession(row) : null;
  }

  getFocusedSession(): WorkspaceSession {
    const session = this.getFocused();
    if (!session) {
      throw new AppError("Focused session was not found", "NOT_FOUND");
    }
    return session;
  }

  getFocusedSessionId(): string {
    return this.getFocusedSession().id;
  }

  setStatus(to: SessionStatus, sessionId = this.getFocusedSessionId()): SessionStatus {
    const session = this.requireById(sessionId);
    if (!canTransition(session.status, to)) {
      throw new AppError(`Cannot transition session from ${session.status} to ${to}`, "INVALID_TRANSITION", {
        sessionId,
        from: session.status,
        to,
      });
    }

    this.client.sqlite
      .prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?")
      .run(to, new Date().toISOString(), sessionId);

    return to;
  }

  updateTaskBoundary(sessionId: string, input: TaskBoundaryInput): void {
    const session = this.requireById(sessionId);
    if (!isSessionEditable(session.status)) {
      throw new AppError(`Session ${sessionId} is locked`, "LOCKED", { sessionId, status: session.status });
    }

    this.client.sqlite
      .prepare(
        `
        UPDATE sessions SET
          name = @name,
          objective = @objective,
          selection_mode = @selection_mode,
          instrument_classes = @instrument_classes,
          instrument_scope = @instrument_scope,
          default_search_provider_id = @default_search_provider_id,
          capital_limit_usd = @capital_limit_usd,
          execution_mode = @execution_mode,
          updated_at = @updated_at
        WHERE id = @id
        `,
      )
      .run({
        id: sessionId,
        name: input.name,
        objective: input.objective,
        selection_mode: input.selectionMode,
        instrument_classes: JSON.stringify(input.instrumentClasses),
        instrument_scope: input.instrumentScope,
        default_search_provider_id: input.defaultSearchProviderId,
        capital_limit_usd: input.capitalLimitUsd,
        execution_mode: input.executionMode,
        updated_at: new Date().toISOString(),
      });
  }

  duplicate(sourceId: string, overrides: { name: string }): WorkspaceSession {
    const source = this.requireById(sourceId);
    // TODO(phase-04): Expand duplication to copy strategy, selector settings, AI roles,
    // broker assignments, and routing overrides instead of only the task-boundary fields.
    return this.create({
      name: overrides.name,
      objective: source.objective,
      selectionMode: source.selectionMode,
      instrumentClasses: source.instrumentClasses,
      instrumentScope: source.instrumentScope,
      defaultSearchProviderId: source.defaultSearchProviderId,
      capitalLimitUsd: source.capitalLimitUsd,
      executionMode: source.executionMode,
    });
  }

  getStatus(sessionId = this.getFocusedSessionId()): SessionStatus {
    return this.requireById(sessionId).status;
  }

  getConfig(sessionId = this.getFocusedSessionId()): SessionConfig {
    // TODO(phase-05): Retire this compatibility accessor after callers move to SessionStrategiesRepo.
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_strategies WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;

    if (!row) {
      throw new AppError(`Strategy config for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }

    return toSessionConfig(row);
  }

  saveConfig(config: SessionConfig, sessionId = this.getFocusedSessionId()): void {
    // TODO(phase-05): Retire this compatibility writer after config saves go through
    // SessionStrategiesRepo and the richer strategy/session edit flows.
    this.client.sqlite
      .prepare(
        `
        UPDATE session_strategies SET
          strategy_profile = @strategy_profile,
          max_position_usd = @max_position_usd,
          stop_loss_pct = @stop_loss_pct,
          take_profit_pct = @take_profit_pct,
          max_concurrent_trades = @max_concurrent_trades,
          research_depth = @research_depth,
          daily_loss_limit_usd = @daily_loss_limit_usd,
          profit_target_usd = @profit_target_usd,
          max_ai_spend_usd = @max_ai_spend_usd,
          human_approval_required = @human_approval_required
        WHERE session_id = @session_id
        `,
      )
      .run({
        session_id: sessionId,
        strategy_profile: config.strategy,
        max_position_usd: config.max_position_usd,
        stop_loss_pct: config.stop_loss_pct,
        take_profit_pct: config.take_profit_pct,
        max_concurrent_trades: config.max_concurrent_trades,
        research_depth: config.research_depth,
        daily_loss_limit_usd: config.daily_loss_limit_usd,
        profit_target_usd: config.profit_target_usd,
        max_ai_spend_usd: config.max_api_spend_usd,
        human_approval_required: config.human_approval_required ? 1 : 0,
      });
  }

  uptimeMin(_sessionId = this.getFocusedSessionId()): number {
    // TODO(phase-00/phase-04): Persist/derive real session uptime from runtime-backed lifecycle timestamps
    // instead of returning a placeholder 0 from the repository layer.
    return 0;
  }
}
