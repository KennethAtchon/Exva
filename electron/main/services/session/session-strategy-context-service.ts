import type {
  ProviderAccount,
  SessionResearchPosture,
  SessionRiskConfig,
  SessionAiSettings,
  SessionSelectorSettings,
  SessionStatus,
  SessionStrategyContext,
  SessionTradeRules,
  SessionTimeframeConfig,
  SelectionMode,
} from "@/lib/types";
import type {
  PhaseRuntimeSummary,
  PipelinePhase,
  SessionAiPhase,
  SessionAiPhaseWorker,
} from "@electron/shared/ai/ai-phase";
import {
  isSessionEditable,
  validateSessionStrategyContext,
} from "@electron/shared/domain";
import { AppError } from "@electron/shared/infra/errors";
import type { ProviderAccountsRepo } from "../../db/repositories/workspace/provider-accounts-repo";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { SessionResearchPostureRepo } from "../../db/repositories/sessions/session-research-posture-repo";
import type { SessionRiskConfigRepo } from "../../db/repositories/sessions/session-risk-config-repo";
import type { SessionSelectorSettingsRepo } from "../../db/repositories/sessions/session-selector-settings-repo";
import type { SessionTradeRulesRepo } from "../../db/repositories/sessions/session-trade-rules-repo";
import type { SessionTimeframeConfigRepo } from "../../db/repositories/sessions/session-timeframe-config-repo";
import type { SessionAiSettingsRepo } from "../../db/repositories/sessions/session-ai-settings-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace/workspace-prefs-repo";

export interface StrategyPageData {
  researchPosture: SessionResearchPosture;
  rules: SessionTradeRules;
  riskConfig: SessionRiskConfig;
  timeframe: SessionTimeframeConfig;
  aiSettings: SessionAiSettings;
  selectorSettings: SessionSelectorSettings;
  providers: ProviderAccount[];
  sessionStatus: SessionStatus;
  selectionMode: SelectionMode;
  defaultSearchProviderId: string | null;
  workspaceDefaultSearchProviderId: string | null;
  workspaceDefaultModelProviderKey: string;
  workspaceDefaultModelModelId: string;
  aiPhases: PhaseRuntimeSummary[];
}

export class SessionStrategyContextService {
  constructor(
    private readonly deps: {
      sessionRepo: SessionRepo;
      researchPostureRepo: SessionResearchPostureRepo;
      rulesRepo: SessionTradeRulesRepo;
      riskRepo: SessionRiskConfigRepo;
      timeframeRepo: SessionTimeframeConfigRepo;
      aiSettingsRepo: SessionAiSettingsRepo;
      selectorSettingsRepo: SessionSelectorSettingsRepo;
      providerAccountsRepo: ProviderAccountsRepo;
      workspacePrefsRepo: WorkspacePreferencesRepo;
      sessionAiPhasesRepo: import("../../db/repositories/sessions/session-ai-phases-repo").SessionAiPhasesRepo;
    },
  ) {}

  get(sessionId: string): SessionStrategyContext {
    return {
      researchPosture: this.deps.researchPostureRepo.get(sessionId),
      rules: this.deps.rulesRepo.get(sessionId),
      riskConfig: this.deps.riskRepo.get(sessionId),
      timeframe: this.deps.timeframeRepo.get(sessionId),
      aiSettings: this.deps.aiSettingsRepo.get(sessionId),
    };
  }

  getAiSettings(sessionId: string): SessionAiSettings {
    return this.get(sessionId).aiSettings;
  }

  getResearchPosture(sessionId: string): SessionResearchPosture {
    return this.get(sessionId).researchPosture;
  }

  getRules(sessionId: string): SessionTradeRules {
    return this.get(sessionId).rules;
  }

  getRiskConfig(sessionId: string): SessionRiskConfig {
    return this.get(sessionId).riskConfig;
  }

  getTimeframeConfig(sessionId: string): SessionTimeframeConfig {
    return this.get(sessionId).timeframe;
  }

  getPageData(sessionId: string): StrategyPageData {
    const session = this.deps.sessionRepo.requireById(sessionId);
    const ctx = this.get(sessionId);
    const workspacePrefs = this.deps.workspacePrefsRepo.get();

    return {
      ...ctx,
      selectorSettings: this.deps.selectorSettingsRepo.get(sessionId),
      providers: this.deps.providerAccountsRepo
        .list()
        .filter((provider) => provider.category === "ai"),
      sessionStatus: session.status,
      selectionMode: session.selectionMode,
      defaultSearchProviderId: session.defaultSearchProviderId,
      workspaceDefaultSearchProviderId: workspacePrefs.defaultSearchProviderId,
      workspaceDefaultModelProviderKey: workspacePrefs.defaultModelProviderKey,
      workspaceDefaultModelModelId: workspacePrefs.defaultModelModelId,
      aiPhases: this.deps.sessionAiPhasesRepo
        .listBySession(sessionId)
        .map((phase) => ({
          ...phase,
          workerOverrides: this.deps.sessionAiPhasesRepo
            .listWorkersBySession(sessionId)
            .filter((worker) => worker.phase === phase.phase),
        })),
    };
  }

  saveResearchPosture(
    sessionId: string,
    patch: Partial<SessionResearchPosture>,
  ): SessionResearchPosture {
    this.assertEditable(sessionId);
    const current = this.get(sessionId);
    const next = {
      ...current,
      researchPosture: { ...current.researchPosture, ...patch, sessionId },
    };
    this.validate(next);
    return this.deps.researchPostureRepo.upsert(
      sessionId,
      next.researchPosture,
    );
  }

  saveRules(
    sessionId: string,
    patch: Partial<SessionTradeRules>,
  ): SessionTradeRules {
    this.assertEditable(sessionId);
    const current = this.get(sessionId);
    const next = {
      ...current,
      rules: { ...current.rules, ...patch, sessionId },
    };
    this.validate(next);
    return this.deps.rulesRepo.upsert(sessionId, next.rules);
  }

  saveRiskConfig(
    sessionId: string,
    patch: Partial<SessionRiskConfig>,
  ): SessionRiskConfig {
    this.assertEditable(sessionId);
    const current = this.get(sessionId);
    const next = {
      ...current,
      riskConfig: { ...current.riskConfig, ...patch, sessionId },
    };
    this.validate(next);
    return this.deps.riskRepo.upsert(sessionId, next.riskConfig);
  }

  saveTimeframeConfig(
    sessionId: string,
    patch: Partial<SessionTimeframeConfig>,
  ): SessionTimeframeConfig {
    this.assertEditable(sessionId);
    const current = this.get(sessionId);
    const next = {
      ...current,
      timeframe: { ...current.timeframe, ...patch, sessionId },
    };
    this.validate(next);
    return this.deps.timeframeRepo.upsert(sessionId, next.timeframe);
  }

  saveAiSettings(
    sessionId: string,
    patch: Partial<SessionAiSettings>,
  ): SessionAiSettings {
    this.assertEditable(sessionId);
    const current = this.get(sessionId);
    const next = {
      ...current,
      aiSettings: { ...current.aiSettings, ...patch, sessionId },
    };
    this.validate(next);
    return this.deps.aiSettingsRepo.upsert(sessionId, next.aiSettings);
  }

  saveAiPhase(
    sessionId: string,
    patch: Partial<SessionAiPhase> & { phase: PipelinePhase },
  ): SessionAiPhase {
    this.assertEditable(sessionId);
    const current = this.deps.sessionAiPhasesRepo.getByPhase(
      sessionId,
      patch.phase,
    );
    if (!current) {
      throw new AppError(
        `AI phase ${patch.phase} is not configured for this session.`,
        "NOT_FOUND",
        { sessionId, phase: patch.phase },
      );
    }
    if (patch.providerKey?.trim()) {
      const provider = this.deps.providerAccountsRepo.find(patch.providerKey);
      if (!provider || provider.category !== "ai" || !provider.isConfigured) {
        throw new AppError(
          "Select a configured AI provider for this phase.",
          "PROVIDER_NOT_CONFIGURED",
          {
            field: "providerKey",
            providerKey: patch.providerKey,
          },
        );
      }
    }
    const next: SessionAiPhase = {
      ...current,
      ...patch,
      sessionId,
      phase: patch.phase,
    };
    this.deps.sessionAiPhasesRepo.upsertPhase(sessionId, next);
    return next;
  }

  saveAiPhaseWorker(
    sessionId: string,
    patch: SessionAiPhaseWorker,
  ): SessionAiPhaseWorker {
    this.assertEditable(sessionId);
    if (!this.deps.sessionAiPhasesRepo.getByPhase(sessionId, patch.phase)) {
      throw new AppError(
        `AI phase ${patch.phase} is not configured for this session.`,
        "NOT_FOUND",
        { sessionId, phase: patch.phase },
      );
    }
    if (patch.providerKey?.trim()) {
      const provider = this.deps.providerAccountsRepo.find(patch.providerKey);
      if (!provider || provider.category !== "ai" || !provider.isConfigured) {
        throw new AppError(
          "Select a configured AI provider for this worker override.",
          "PROVIDER_NOT_CONFIGURED",
          {
            field: "providerKey",
            providerKey: patch.providerKey,
          },
        );
      }
    }
    const next: SessionAiPhaseWorker = { ...patch, sessionId };
    this.deps.sessionAiPhasesRepo.upsertWorker(sessionId, next);
    return next;
  }

  private validate(context: SessionStrategyContext): void {
    try {
      validateSessionStrategyContext(context, {
        hasSearchProvider: this.hasSearchProvider(
          context.researchPosture.sessionId,
        ),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Invalid strategy configuration.";
      throw new AppError(message, "VALIDATION_FAILED", {
        sessionId: context.researchPosture.sessionId,
      });
    }
  }

  private hasSearchProvider(sessionId: string): boolean {
    const session = this.deps.sessionRepo.requireById(sessionId);
    const workspacePrefs = this.deps.workspacePrefsRepo.get();
    return Boolean(
      session.defaultSearchProviderId || workspacePrefs.defaultSearchProviderId,
    );
  }

  private assertEditable(sessionId: string): void {
    const session = this.deps.sessionRepo.requireById(sessionId);
    if (!isSessionEditable(session.status)) {
      throw new AppError(
        "Stop this session before editing its strategy or AI configuration.",
        "LOCKED",
        { sessionId },
      );
    }
  }
}
