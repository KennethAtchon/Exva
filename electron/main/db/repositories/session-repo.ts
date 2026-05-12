import type { DbClient } from "../client";
import type { SessionConfig, SessionStatus, WorkspaceSession } from "@/lib/types";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import {
  sessionAiRoleProfile,
  sessionAiRoles,
  sessionBrokerAssignments,
  sessionBrokerRoutingOverrides,
  sessionResearchPosture,
  sessionRiskConfig,
  sessionSelectorSettings,
  sessionTradeRules,
  sessionStrategies,
  sessionTimeframeConfig,
  sessions,
  workspacePreferences,
} from "../schema";
import { AppError } from "@electron/shared/errors";
import {
  buildTradeRulesMarkdown,
  canTransition,
  isSessionEditable,
  RESEARCH_POSTURE_PRESETS,
  RISK_PRESETS,
  TIMEFRAME_PRESETS,
  TRADE_RULE_PRESETS,
} from "@electron/shared/domain";
import { GLOBAL_STRATEGY_PRESETS } from "@electron/shared/presets";
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
const DEFAULT_GLOBAL_PRESET = GLOBAL_STRATEGY_PRESETS[0];
const DEFAULT_RESEARCH_POSTURE_PRESET = requirePreset(
  RESEARCH_POSTURE_PRESETS.find((preset) => preset.id === DEFAULT_GLOBAL_PRESET.posturePresetId),
  "research posture",
);
const DEFAULT_TRADE_RULES_PRESET = requirePreset(
  TRADE_RULE_PRESETS.find((preset) => preset.id === DEFAULT_GLOBAL_PRESET.rulesPresetId),
  "trade rules",
);
const DEFAULT_RISK_PRESET = requirePreset(
  RISK_PRESETS.find((preset) => preset.id === DEFAULT_GLOBAL_PRESET.riskPresetId),
  "risk",
);
const DEFAULT_TIMEFRAME_PRESET = requirePreset(
  TIMEFRAME_PRESETS.find((preset) => preset.id === DEFAULT_GLOBAL_PRESET.timeframePresetId),
  "timeframe",
);

export class SessionRepo {
  constructor(private readonly client: DbClient) {}

  create(input: CreateSessionInput): WorkspaceSession {
    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const roleSeed = this.getDefaultAiRoleSeed();
    const tradeRulesSeed = {
      sessionId,
      ...DEFAULT_TRADE_RULES_PRESET.rules,
      tradeRulesMarkdown: "",
      ruleNotes: "",
      updatedAt: now,
    };

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

      tx.insert(sessionResearchPosture)
        .values({
          sessionId,
          ...DEFAULT_RESEARCH_POSTURE_PRESET.posture,
          postureNotes: "",
          updatedAt: now,
        })
        .run();

      for (const role of DEFAULT_ROLES) {
        tx.insert(sessionAiRoleProfile)
          .values({
            sessionId,
            role,
            profileJson: JSON.stringify({ version: 1 }),
            updatedAt: now,
          })
          .run();
      }

      tx.insert(sessionTradeRules)
        .values({
          ...tradeRulesSeed,
          tradeRulesMarkdown: buildTradeRulesMarkdown(tradeRulesSeed),
        })
        .run();

      tx.insert(sessionRiskConfig)
        .values({
          sessionId,
          riskPresetId: DEFAULT_RISK_PRESET.id,
          ...DEFAULT_RISK_PRESET.values,
          maxDataSpendUsd: 5,
          updatedAt: now,
        })
        .run();

      tx.insert(sessionTimeframeConfig)
        .values({
          sessionId,
          timeframePresetId: DEFAULT_TIMEFRAME_PRESET.id,
          ...DEFAULT_TIMEFRAME_PRESET.values,
          updatedAt: now,
        })
        .run();

      for (const role of DEFAULT_ROLES) {
        tx.insert(sessionAiRoles)
          .values({
            id: `${sessionId}:${role}`,
            sessionId,
            role,
            providerKey: roleSeed.providerKey,
            modelId: roleSeed.modelId,
            temperature: 0.7,
            maxTokens: 8192,
            promptSource: "default",
            promptMarkdown: "",
            promptAssetPath: null,
          })
          .run();
      }
    });

    return this.requireById(sessionId);
  }

  private getDefaultAiRoleSeed(): { providerKey: string; modelId: string } {
    const row = this.client.db
      .select({
        providerKey: workspacePreferences.defaultModelProviderKey,
        modelId: workspacePreferences.defaultModelModelId,
      })
      .from(workspacePreferences)
      .where(eq(workspacePreferences.id, 1))
      .get();

    return {
      providerKey: row?.providerKey ?? "",
      modelId: row?.modelId ?? "",
    };
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

      const researchPostureRow = tx
        .select()
        .from(sessionResearchPosture)
        .where(eq(sessionResearchPosture.sessionId, sourceId))
        .get();
      if (researchPostureRow) {
        tx.insert(sessionResearchPosture)
          .values({
            ...researchPostureRow,
            sessionId: newId,
            updatedAt: now,
          })
          .run();
      }

      const aiProfiles = tx.select().from(sessionAiRoleProfile).where(eq(sessionAiRoleProfile.sessionId, sourceId)).all();
      for (const row of aiProfiles) {
        tx.insert(sessionAiRoleProfile)
          .values({
            ...row,
            sessionId: newId,
            updatedAt: now,
          })
          .run();
      }

      const tradeRulesRow = tx
        .select()
        .from(sessionTradeRules)
        .where(eq(sessionTradeRules.sessionId, sourceId))
        .get();
      if (tradeRulesRow) {
        tx.insert(sessionTradeRules)
          .values({
            ...tradeRulesRow,
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

function requirePreset<T>(preset: T | undefined, kind: string): T {
  if (!preset) {
    throw new Error(`Default global preset references missing ${kind} preset.`);
  }
  return preset;
}
