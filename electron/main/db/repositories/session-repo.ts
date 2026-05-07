import type { DbClient } from "../client";
import type { SessionConfig, SessionStatus, WorkspaceSession } from "@/lib/types";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import {
  sessionAiRoles,
  sessionBrokerAssignments,
  sessionBrokerRoutingOverrides,
  sessionRiskConfig,
  sessionSelectorSettings,
  sessionStrategies,
  sessionStrategyProfile,
  sessionTimeframeConfig,
  sessions,
} from "../schema";
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

const DEFAULT_ROLES = ["analyst_technical", "analyst_fundamental", "reviewer", "decision_maker", "instrument_selector"] as const;

export class SessionRepo {
  constructor(private readonly client: DbClient) {}

  create(input: CreateSessionInput): WorkspaceSession {
    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();

    this.client.db.transaction((tx) => {
      tx.insert(sessions)
        .values({
          id: sessionId,
          name: input.name,
          objective: input.objective,
          status: "draft",
          isFocused: input.isFocused ?? false,
          selectionMode: input.selectionMode,
          instrumentClasses: JSON.stringify(input.instrumentClasses),
          instrumentScope: input.instrumentScope,
          defaultSearchProviderId: input.defaultSearchProviderId ?? null,
          capitalLimitUsd: input.capitalLimitUsd,
          executionMode: input.executionMode,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      tx.insert(sessionSelectorSettings)
        .values({
          sessionId,
          aiPickerEnabled: true,
          updatedAt: now,
        })
        .run();

      tx.insert(sessionStrategies)
        .values({
          sessionId,
          strategyProfile: "passive_income",
          maxPositionUsd: 500,
          stopLossPct: 2,
          takeProfitPct: 4,
          maxConcurrentTrades: 3,
          researchDepth: "balanced",
          dailyLossLimitUsd: 200,
          profitTargetUsd: 1000,
          maxAiSpendUsd: 5,
          humanApprovalRequired: false,
          primaryTradingTimeframe: "1d",
          holdingStyle: "multi_day_swing",
          targetHoldDays: null,
          maxHoldDays: null,
          timeframeNotes: "",
        })
        .run();

      tx.insert(sessionStrategyProfile)
        .values({
          sessionId,
          strategyType: "custom",
          sideBias: "both",
          entryStyle: "breakout",
          exitStyle: "fixed_pct",
          scalingMode: "single_entry",
          strategyBriefMarkdown: "",
          customInstructions: "",
          updatedAt: now,
        })
        .run();

      tx.insert(sessionRiskConfig)
        .values({
          sessionId,
          maxPositionUsd: 500,
          stopLossPct: 2,
          takeProfitPct: 4,
          stopLossType: "fixed_pct",
          atrStopMultiplier: null,
          kellyFraction: 0.25,
          predictionEdgeThreshold: 0.08,
          maxExposureUsd: null,
          waitForOpenThreshold: 0.8,
          maxConcurrentTrades: 3,
          dailyLossLimitUsd: 200,
          profitTargetUsd: 1000,
          maxAiSpendUsd: 5,
          maxDataSpendUsd: 5,
          humanApprovalRequired: false,
          updatedAt: now,
        })
        .run();

      tx.insert(sessionTimeframeConfig)
        .values({
          sessionId,
          primaryTradingTimeframe: "1d",
          holdingStyle: "multi_day_swing",
          targetHoldDays: null,
          maxHoldDays: null,
          timeframeNotes: "",
          updatedAt: now,
        })
        .run();

      for (const role of DEFAULT_ROLES) {
        tx.insert(sessionAiRoles)
          .values({
            id: `${sessionId}:${role}`,
            sessionId,
            role,
            providerKey: "provider-anthropic",
            modelId: "claude-sonnet-4-6",
            temperature: 0.7,
            maxTokens: 4096,
            promptSource: "default",
            promptMarkdown: "",
            promptAssetPath: null,
          })
          .run();
      }
    });

    return this.requireById(sessionId);
  }

  list(filters: SessionFilters = {}): WorkspaceSession[] {
    const conditions = [];
    if (!filters.includeArchived) {
      conditions.push(ne(sessions.status, "archived"));
    }
    if (filters.statuses?.length) {
      conditions.push(inArray(sessions.status, filters.statuses));
    }

    const query = this.client.db.select().from(sessions).orderBy(asc(sessions.createdAt));
    const rows = conditions.length > 0 ? query.where(and(...conditions)).all() : query.all();
    return rows.map(toWorkspaceSession);
  }

  listByStatuses(statuses: SessionStatus[]): WorkspaceSession[] {
    return this.list({ statuses, includeArchived: true });
  }

  get(id: string): WorkspaceSession | null {
    const row = this.client.db.select().from(sessions).where(eq(sessions.id, id)).get();
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

    this.client.db.transaction((tx) => {
      tx.update(sessions).set({ isFocused: false }).where(eq(sessions.isFocused, true)).run();
      tx.update(sessions).set({ isFocused: true }).where(eq(sessions.id, sessionId)).run();
    });
  }

  clearFocus(): void {
    this.client.db.update(sessions).set({ isFocused: false }).where(eq(sessions.isFocused, true)).run();
  }

  getFocused(): WorkspaceSession | null {
    const row = this.client.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.isFocused, true), ne(sessions.status, "archived")))
      .get();

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

    this.client.db
      .update(sessions)
      .set({ status: to, updatedAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId))
      .run();

    return to;
  }

  updateTaskBoundary(sessionId: string, input: TaskBoundaryInput): void {
    const session = this.requireById(sessionId);
    if (!isSessionEditable(session.status)) {
      throw new AppError(`Session ${sessionId} is locked`, "LOCKED", { sessionId, status: session.status });
    }

    this.client.db
      .update(sessions)
      .set({
        name: input.name,
        objective: input.objective,
        selectionMode: input.selectionMode,
        instrumentClasses: JSON.stringify(input.instrumentClasses),
        instrumentScope: input.instrumentScope,
        defaultSearchProviderId: input.defaultSearchProviderId,
        capitalLimitUsd: input.capitalLimitUsd,
        executionMode: input.executionMode,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  duplicate(sourceId: string, overrides: { name: string }): WorkspaceSession {
    const source = this.requireById(sourceId);
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();

    this.client.db.transaction((tx) => {
      tx.insert(sessions)
        .values({
          id: newId,
          name: overrides.name,
          objective: source.objective,
          status: "draft",
          isFocused: false,
          selectionMode: source.selectionMode,
          instrumentClasses: JSON.stringify(source.instrumentClasses),
          instrumentScope: source.instrumentScope,
          defaultSearchProviderId: source.defaultSearchProviderId,
          capitalLimitUsd: source.capitalLimitUsd,
          executionMode: source.executionMode,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const selectorSettings = tx
        .select()
        .from(sessionSelectorSettings)
        .where(eq(sessionSelectorSettings.sessionId, sourceId))
        .get();
      if (selectorSettings) {
        tx.insert(sessionSelectorSettings)
          .values({
            sessionId: newId,
            aiPickerEnabled: selectorSettings.aiPickerEnabled,
            updatedAt: now,
          })
          .run();
      }

      const strategy = tx.select().from(sessionStrategies).where(eq(sessionStrategies.sessionId, sourceId)).get();
      if (strategy) {
        tx.insert(sessionStrategies)
          .values({
            ...strategy,
            sessionId: newId,
          })
          .run();
      }

      const strategyProfileRow = tx
        .select()
        .from(sessionStrategyProfile)
        .where(eq(sessionStrategyProfile.sessionId, sourceId))
        .get();
      if (strategyProfileRow) {
        tx.insert(sessionStrategyProfile)
          .values({
            ...strategyProfileRow,
            sessionId: newId,
            updatedAt: now,
          })
          .run();
      }

      const risk = tx.select().from(sessionRiskConfig).where(eq(sessionRiskConfig.sessionId, sourceId)).get();
      if (risk) {
        tx.insert(sessionRiskConfig)
          .values({
            ...risk,
            sessionId: newId,
            updatedAt: now,
          })
          .run();
      }

      const timeframe = tx.select().from(sessionTimeframeConfig).where(eq(sessionTimeframeConfig.sessionId, sourceId)).get();
      if (timeframe) {
        tx.insert(sessionTimeframeConfig)
          .values({
            ...timeframe,
            sessionId: newId,
            updatedAt: now,
          })
          .run();
      }

      const sourceRoles = tx.select().from(sessionAiRoles).where(eq(sessionAiRoles.sessionId, sourceId)).all();
      for (const row of sourceRoles) {
        tx.insert(sessionAiRoles)
          .values({
            ...row,
            id: `${newId}:${row.role}`,
            sessionId: newId,
          })
          .run();
      }

      const brokerAssignments = tx
        .select()
        .from(sessionBrokerAssignments)
        .where(eq(sessionBrokerAssignments.sessionId, sourceId))
        .all();
      for (const row of brokerAssignments) {
        tx.insert(sessionBrokerAssignments)
          .values({
            sessionId: newId,
            brokerAccountId: row.brokerAccountId,
          })
          .run();
      }

      const routingOverrides = tx
        .select()
        .from(sessionBrokerRoutingOverrides)
        .where(eq(sessionBrokerRoutingOverrides.sessionId, sourceId))
        .all();
      for (const row of routingOverrides) {
        tx.insert(sessionBrokerRoutingOverrides)
          .values({
            sessionId: newId,
            instrumentClass: row.instrumentClass,
            brokerAccountId: row.brokerAccountId,
          })
          .run();
      }
    });

    return this.requireById(newId);
  }

  getStatus(sessionId = this.getFocusedSessionId()): SessionStatus {
    return this.requireById(sessionId).status;
  }

  uptimeMin(_sessionId = this.getFocusedSessionId()): number {
    void _sessionId;
    return 0;
  }

  getConfig(sessionId = this.getFocusedSessionId()): SessionConfig {
    const row = this.client.db.select().from(sessionStrategies).where(eq(sessionStrategies.sessionId, sessionId)).get();

    if (!row) {
      throw new AppError(`Strategy config for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }

    return toSessionConfig(row);
  }

  saveConfig(config: SessionConfig, sessionId = this.getFocusedSessionId()): void {
    const updatedAt = new Date().toISOString();
    const existingRisk = this.client.db
      .select({ maxDataSpendUsd: sessionRiskConfig.maxDataSpendUsd })
      .from(sessionRiskConfig)
      .where(eq(sessionRiskConfig.sessionId, sessionId))
      .get();
    const maxDataSpendUsd = existingRisk?.maxDataSpendUsd ?? config.max_api_spend_usd;

    this.client.db.transaction((tx) => {
      tx.update(sessionStrategies)
        .set({
          strategyProfile: config.strategy,
          maxPositionUsd: config.max_position_usd,
          stopLossPct: config.stop_loss_pct,
          takeProfitPct: config.take_profit_pct,
          maxConcurrentTrades: config.max_concurrent_trades,
          researchDepth: config.research_depth,
          dailyLossLimitUsd: config.daily_loss_limit_usd,
          profitTargetUsd: config.profit_target_usd,
          maxAiSpendUsd: config.max_api_spend_usd,
          humanApprovalRequired: config.human_approval_required,
        })
        .where(eq(sessionStrategies.sessionId, sessionId))
        .run();

      tx.update(sessionRiskConfig)
        .set({
          maxPositionUsd: config.max_position_usd,
          stopLossPct: config.stop_loss_pct,
          takeProfitPct: config.take_profit_pct,
          maxConcurrentTrades: config.max_concurrent_trades,
          dailyLossLimitUsd: config.daily_loss_limit_usd,
          profitTargetUsd: config.profit_target_usd,
          maxAiSpendUsd: config.max_api_spend_usd,
          maxDataSpendUsd,
          humanApprovalRequired: config.human_approval_required,
          updatedAt,
        })
        .where(eq(sessionRiskConfig.sessionId, sessionId))
        .run();
    });
  }
}
