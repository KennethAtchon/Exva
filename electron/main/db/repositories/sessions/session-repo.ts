import type { DbClient } from "../../client";
import type { SessionStatus, WorkspaceSession } from "@/lib/types";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import {
  sessionBrokerAssignments,
  sessionBrokerRoutingOverrides,
  sessionStrategyConfigs,
  sessions,
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
  SessionStrategyContext,
  TimeframePreset,
  TradeRulesPreset,
} from "@electron/shared/domain";
import { SESSION_STRATEGY_CONFIG_SCHEMA_VERSION } from "@electron/shared/domain/session-strategy-config";
import {
  builtInGlobalStrategyPresets,
  findResearchPosturePresetById,
  findRiskPresetById,
  findTimeframePresetById,
  findTradeRulePresetById,
} from "@electron/shared/presets";
import { loadExperiencePresetBundle } from "../../../experiences/session-bootstrap";
import { buildSessionStrategyConfigJson } from "../../../services/session/session-strategy-config";
import { assembleInitialSessionStrategyConfigDoc } from "@electron/shared/domain/session-strategy-config-defaults";
import {
  DEFAULT_RESEARCH_POSTURE_SECTION,
  DEFAULT_RISK_SECTION,
  DEFAULT_TIMEFRAME_SECTION,
  DEFAULT_TRADE_RULES_SECTION,
} from "@electron/shared/domain/session-strategy-config-defaults";
import {
  DEFAULT_REASONING_LEVEL,
  PIPELINE_PHASES,
} from "@electron/shared/ai/ai-phase";
import { toWorkspaceSession } from "../system/mappers";

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
  experienceId?: string;
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

  private loadSessionDefaults(experienceId?: string): {
    posturePreset: ResearchPosturePreset;
    rulesPreset: TradeRulesPreset;
    riskPreset: RiskPreset;
    timeframePreset: TimeframePreset;
  } {
    if (experienceId) {
      return loadExperiencePresetBundle(this.client, experienceId);
    }
    const globalPreset = builtInGlobalStrategyPresets()[0];
    if (!globalPreset) {
      throw new AppError(
        "No built-in global strategy preset found",
        "INTERNAL_ERROR",
      );
    }

    const posturePreset = findResearchPosturePresetById(
      globalPreset.posturePresetId,
    );
    if (!posturePreset) {
      throw new AppError(
        `Research posture preset '${globalPreset.posturePresetId}' not found`,
        "INTERNAL_ERROR",
      );
    }

    const rulesPreset = findTradeRulePresetById(globalPreset.rulesPresetId);
    if (!rulesPreset) {
      throw new AppError(
        `Trade rule preset '${globalPreset.rulesPresetId}' not found`,
        "INTERNAL_ERROR",
      );
    }

    const riskPreset = findRiskPresetById(globalPreset.riskPresetId);
    if (!riskPreset) {
      throw new AppError(
        `Risk preset '${globalPreset.riskPresetId}' not found`,
        "INTERNAL_ERROR",
      );
    }

    const timeframePreset = findTimeframePresetById(
      globalPreset.timeframePresetId,
    );
    if (!timeframePreset) {
      throw new AppError(
        `Timeframe preset '${globalPreset.timeframePresetId}' not found`,
        "INTERNAL_ERROR",
      );
    }

    return {
      posturePreset,
      rulesPreset,
      riskPreset,
      timeframePreset,
    };
  }

  create(input: CreateSessionInput): WorkspaceSession {
    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const roleSeed = this.getDefaultAiRoleSeed();
    const experienceId = input.experienceId ?? "edgar-catalyst";
    const defaults = this.loadSessionDefaults(experienceId);
    const tradeRulesSeed = {
      sessionId,
      ...defaults.rulesPreset.rules,
      tradeRulesMarkdown: "",
      ruleNotes: "",
      updatedAt: now,
    };
    const strategyContext = {
      researchPosture: {
        sessionId,
        ...defaults.posturePreset.posture,
        postureNotes: "",
        updatedAt: now,
      },
      rules: {
        ...tradeRulesSeed,
        tradeRulesMarkdown: buildTradeRulesMarkdown(tradeRulesSeed),
      },
      riskConfig: {
        sessionId,
        riskPresetId: defaults.riskPreset.id,
        ...defaults.riskPreset.values,
        maxPositionUsd: defaults.riskPreset.values.maxPositionUsd ?? 500,
        maxDataSpendUsd: 5,
        updatedAt: now,
      },
      timeframe: {
        sessionId,
        timeframePresetId: defaults.timeframePreset.id,
        ...defaults.timeframePreset.values,
        updatedAt: now,
      },
      aiSettings: {
        sessionId,
        workerGuidanceMarkdown: "",
        updatedAt: now,
      },
    };
    const strategyConfigJson = JSON.stringify(
      buildSessionStrategyConfigJson(strategyContext as SessionStrategyContext),
    );

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
          experienceId,
          strategyConfigJson,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const initialDoc = assembleInitialSessionStrategyConfigDoc({
        strategy: {
          strategyProfile: "passive_income",
          researchDepth: "balanced",
        },
        risk: {
          ...DEFAULT_RISK_SECTION,
          riskPresetId: defaults.riskPreset.id,
          ...defaults.riskPreset.values,
          maxPositionUsd: defaults.riskPreset.values.maxPositionUsd ?? 500,
          maxDataSpendUsd: 5,
        },
        timeframe: {
          ...DEFAULT_TIMEFRAME_SECTION,
          timeframePresetId: defaults.timeframePreset.id,
          ...defaults.timeframePreset.values,
        },
        tradeRules: {
          ...DEFAULT_TRADE_RULES_SECTION,
          ...defaults.rulesPreset.rules,
          tradeRulesMarkdown: buildTradeRulesMarkdown(tradeRulesSeed),
          ruleNotes: "",
        },
        researchPosture: {
          ...DEFAULT_RESEARCH_POSTURE_SECTION,
          ...defaults.posturePreset.posture,
          postureNotes: "",
        },
        ai: {
          settings: { workerGuidanceMarkdown: "" },
          phases: PIPELINE_PHASES.map((phase) => ({
            phase,
            providerKey: roleSeed.providerKey,
            modelId: roleSeed.modelId,
            temperature: 0.7,
            maxTokens: 8192,
            reasoningLevel: roleSeed.reasoningLevel,
            promptSource: "default" as const,
            promptMarkdown: "",
            workers: [],
          })),
        },
        selector: {
          aiPickerEnabled: true,
          noInstrumentRetryMinutes: null,
        },
      });

      tx.insert(sessionStrategyConfigs)
        .values({
          sessionId,
          version: 1,
          schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
          doc: initialDoc,
          updatedAt: now,
        })
        .run();
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

      const strategyConfig = tx
        .select()
        .from(sessionStrategyConfigs)
        .where(eq(sessionStrategyConfigs.sessionId, sourceId))
        .get();
      if (strategyConfig) {
        tx.insert(sessionStrategyConfigs)
          .values({
            sessionId: newId,
            version: 1,
            schemaVersion: strategyConfig.schemaVersion,
            doc: strategyConfig.doc,
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

  getStrategyConfigJson(sessionId: string): string | null {
    const row = this.client.db
      .select({ strategyConfigJson: sessions.strategyConfigJson })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    return row?.strategyConfigJson ?? null;
  }

  updateStrategyConfigJson(sessionId: string, json: string): void {
    this.client.db
      .update(sessions)
      .set({
        strategyConfigJson: json,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sessions.id, sessionId))
      .run();
  }
}
