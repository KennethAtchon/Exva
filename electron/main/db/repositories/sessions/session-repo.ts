import type { DbClient } from "../../client";
import type {
  SessionConfig,
  SessionStatus,
  WorkspaceSession,
} from "@/lib/types";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import {
  globalPresets,
  researchPosturePresets,
  riskPresets,
  sessionAiPhases,
  sessionAiSettings,
  sessionBrokerAssignments,
  sessionBrokerRoutingOverrides,
  sessionResearchPosture,
  sessionRiskConfig,
  sessionSelectorSettings,
  sessionTradeRules,
  sessionStrategies,
  sessionTimeframeConfig,
  sessions,
  timeframePresets,
  tradeRulePresets,
  workspacePreferences,
} from "../../schema";
import { AppError } from "@electron/shared/infra/errors";
import {
  buildTradeRulesMarkdown,
  canTransition,
  isSessionEditable,
} from "@electron/shared/domain";
import type {
  ResearchPosturePreset,
  RiskPreset,
  TimeframePreset,
  TradeRulesPreset,
} from "@electron/shared/domain";
import type { GlobalStrategyPreset } from "@electron/shared/presets";
import {
  DEFAULT_REASONING_LEVEL,
  PIPELINE_PHASES,
} from "@electron/shared/ai/ai-phase";
import { toSessionConfig, toWorkspaceSession } from "../system/mappers";

export interface SessionFilters {
  statuses?: SessionStatus[];
  includeArchived?: boolean;
  executionMode?: WorkspaceSession["executionMode"];
}

export interface CreateSessionInput {
  name: string;
  objective: string;
  selectionMode: WorkspaceSession["selectionMode"];
  instrumentClasses: WorkspaceSession["instrumentClasses"];
  instrumentScope: string;
  defaultSearchProviderId?: string | null;
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
  executionMode: WorkspaceSession["executionMode"];
}

export class SessionRepo {
  constructor(private readonly client: DbClient) {}

  private loadSessionDefaults(): {
    posturePreset: ResearchPosturePreset;
    rulesPreset: TradeRulesPreset;
    riskPreset: RiskPreset;
    timeframePreset: TimeframePreset;
  } {
    const globalRow = this.client.db
      .select()
      .from(globalPresets)
      .where(eq(globalPresets.isBuiltIn, true))
      .orderBy(globalPresets.createdAt)
      .limit(1)
      .get();
    if (!globalRow) {
      throw new AppError(
        "No built-in global strategy preset found — run migrations and seed",
        "INTERNAL_ERROR",
      );
    }
    const globalPreset = JSON.parse(
      globalRow.presetJson,
    ) as GlobalStrategyPreset;

    const postureRow = this.client.db
      .select()
      .from(researchPosturePresets)
      .where(eq(researchPosturePresets.id, globalPreset.posturePresetId))
      .get();
    if (!postureRow)
      throw new AppError(
        `Research posture preset '${globalPreset.posturePresetId}' not found`,
        "INTERNAL_ERROR",
      );

    const rulesRow = this.client.db
      .select()
      .from(tradeRulePresets)
      .where(eq(tradeRulePresets.id, globalPreset.rulesPresetId))
      .get();
    if (!rulesRow)
      throw new AppError(
        `Trade rule preset '${globalPreset.rulesPresetId}' not found`,
        "INTERNAL_ERROR",
      );

    const riskRow = this.client.db
      .select()
      .from(riskPresets)
      .where(eq(riskPresets.id, globalPreset.riskPresetId))
      .get();
    if (!riskRow)
      throw new AppError(
        `Risk preset '${globalPreset.riskPresetId}' not found`,
        "INTERNAL_ERROR",
      );

    const timeframeRow = this.client.db
      .select()
      .from(timeframePresets)
      .where(eq(timeframePresets.id, globalPreset.timeframePresetId))
      .get();
    if (!timeframeRow)
      throw new AppError(
        `Timeframe preset '${globalPreset.timeframePresetId}' not found`,
        "INTERNAL_ERROR",
      );

    return {
      posturePreset: JSON.parse(postureRow.presetJson) as ResearchPosturePreset,
      rulesPreset: JSON.parse(rulesRow.presetJson) as TradeRulesPreset,
      riskPreset: JSON.parse(riskRow.presetJson) as RiskPreset,
      timeframePreset: JSON.parse(timeframeRow.presetJson) as TimeframePreset,
    };
  }

  create(input: CreateSessionInput): WorkspaceSession {
    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const roleSeed = this.getDefaultAiRoleSeed();
    const defaults = this.loadSessionDefaults();
    const tradeRulesSeed = {
      sessionId,
      ...defaults.rulesPreset.rules,
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
          ...defaults.posturePreset.posture,
          postureNotes: "",
          updatedAt: now,
        })
        .run();

      tx.insert(sessionTradeRules)
        .values({
          ...tradeRulesSeed,
          tradeRulesMarkdown: buildTradeRulesMarkdown(tradeRulesSeed),
        })
        .run();

      tx.insert(sessionRiskConfig)
        .values({
          sessionId,
          riskPresetId: defaults.riskPreset.id,
          ...defaults.riskPreset.values,
          maxDataSpendUsd: 5,
          updatedAt: now,
        })
        .run();

      tx.insert(sessionTimeframeConfig)
        .values({
          sessionId,
          timeframePresetId: defaults.timeframePreset.id,
          ...defaults.timeframePreset.values,
          updatedAt: now,
        })
        .run();

      tx.insert(sessionAiSettings)
        .values({
          sessionId,
          workerGuidanceMarkdown: "",
          updatedAt: now,
        })
        .run();

      for (const phase of PIPELINE_PHASES) {
        tx.insert(sessionAiPhases)
          .values({
            sessionId,
            phase,
            providerKey: roleSeed.providerKey,
            modelId: roleSeed.modelId,
            temperature: 0.7,
            maxTokens: 8192,
            reasoningLevel: roleSeed.reasoningLevel,
            promptSource: "default",
            promptMarkdown: "",
            updatedAt: now,
          })
          .run();
      }
    });

    return this.requireById(sessionId);
  }

  private getDefaultAiRoleSeed(): {
    providerKey: string;
    modelId: string;
    reasoningLevel: typeof DEFAULT_REASONING_LEVEL;
  } {
    const row = this.client.db
      .select({
        providerKey: workspacePreferences.defaultModelProviderKey,
        modelId: workspacePreferences.defaultModelModelId,
        reasoningLevel: workspacePreferences.defaultModelReasoningLevel,
      })
      .from(workspacePreferences)
      .where(eq(workspacePreferences.id, 1))
      .get();

    return {
      providerKey: row?.providerKey ?? "",
      modelId: row?.modelId ?? "",
      reasoningLevel:
        (row?.reasoningLevel as typeof DEFAULT_REASONING_LEVEL) ??
        DEFAULT_REASONING_LEVEL,
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
    if (filters.executionMode) {
      conditions.push(eq(sessions.executionMode, filters.executionMode));
    }

    const query = this.client.db
      .select()
      .from(sessions)
      .orderBy(asc(sessions.createdAt));
    const rows =
      conditions.length > 0
        ? query.where(and(...conditions)).all()
        : query.all();
    return rows.map(toWorkspaceSession);
  }

  listByStatuses(statuses: SessionStatus[]): WorkspaceSession[] {
    return this.list({ statuses, includeArchived: true });
  }

  get(id: string): WorkspaceSession | null {
    const row = this.client.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .get();
    return row ? toWorkspaceSession(row) : null;
  }

  findById(sessionId: string): WorkspaceSession | null {
    return this.get(sessionId);
  }

  requireById(sessionId: string): WorkspaceSession {
    const session = this.get(sessionId);
    if (!session) {
      throw new AppError(`Session ${sessionId} was not found`, "NOT_FOUND", {
        sessionId,
      });
    }
    return session;
  }

  setFocus(sessionId: string): void {
    this.requireById(sessionId);

    this.client.db.transaction((tx) => {
      tx.update(sessions)
        .set({ isFocused: false })
        .where(eq(sessions.isFocused, true))
        .run();
      tx.update(sessions)
        .set({ isFocused: true })
        .where(eq(sessions.id, sessionId))
        .run();
    });
  }

  clearFocus(): void {
    this.client.db
      .update(sessions)
      .set({ isFocused: false })
      .where(eq(sessions.isFocused, true))
      .run();
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

  setStatus(
    to: SessionStatus,
    sessionId = this.getFocusedSessionId(),
  ): SessionStatus {
    const session = this.requireById(sessionId);
    if (!canTransition(session.status, to)) {
      throw new AppError(
        `Cannot transition session from ${session.status} to ${to}`,
        "INVALID_TRANSITION",
        {
          sessionId,
          from: session.status,
          to,
        },
      );
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
      throw new AppError(`Session ${sessionId} is locked`, "LOCKED", {
        sessionId,
        status: session.status,
      });
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

      const strategy = tx
        .select()
        .from(sessionStrategies)
        .where(eq(sessionStrategies.sessionId, sourceId))
        .get();
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

      const risk = tx
        .select()
        .from(sessionRiskConfig)
        .where(eq(sessionRiskConfig.sessionId, sourceId))
        .get();
      if (risk) {
        tx.insert(sessionRiskConfig)
          .values({
            ...risk,
            sessionId: newId,
            updatedAt: now,
          })
          .run();
      }

      const timeframe = tx
        .select()
        .from(sessionTimeframeConfig)
        .where(eq(sessionTimeframeConfig.sessionId, sourceId))
        .get();
      if (timeframe) {
        tx.insert(sessionTimeframeConfig)
          .values({
            ...timeframe,
            sessionId: newId,
            updatedAt: now,
          })
          .run();
      }

      const aiSettings = tx
        .select()
        .from(sessionAiSettings)
        .where(eq(sessionAiSettings.sessionId, sourceId))
        .get();
      if (aiSettings) {
        tx.insert(sessionAiSettings)
          .values({
            ...aiSettings,
            sessionId: newId,
            updatedAt: now,
          })
          .run();
      }

      const sourcePhases = tx
        .select()
        .from(sessionAiPhases)
        .where(eq(sessionAiPhases.sessionId, sourceId))
        .all();
      for (const row of sourcePhases) {
        tx.insert(sessionAiPhases)
          .values({
            ...row,
            sessionId: newId,
            updatedAt: now,
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
            allocatedUsd: row.allocatedUsd,
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
    const row = this.client.db
      .select()
      .from(sessionStrategies)
      .where(eq(sessionStrategies.sessionId, sessionId))
      .get();

    if (!row) {
      throw new AppError(
        `Strategy config for session ${sessionId} was not found`,
        "NOT_FOUND",
        { sessionId },
      );
    }

    return toSessionConfig(row);
  }

  saveConfig(
    config: SessionConfig,
    sessionId = this.getFocusedSessionId(),
  ): void {
    const updatedAt = new Date().toISOString();
    const existingRisk = this.client.db
      .select({ maxDataSpendUsd: sessionRiskConfig.maxDataSpendUsd })
      .from(sessionRiskConfig)
      .where(eq(sessionRiskConfig.sessionId, sessionId))
      .get();
    const maxDataSpendUsd =
      existingRisk?.maxDataSpendUsd ?? config.max_api_spend_usd;

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
