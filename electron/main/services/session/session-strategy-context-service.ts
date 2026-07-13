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
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace/workspace-prefs-repo";
import {
  docToAiPhaseWorkers,
  docToAiPhases,
  docToSelectorSettings,
  type SessionStrategyConfigService,
} from "./session-strategy-config-service";

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
      strategyConfig: SessionStrategyConfigService;
      providerAccountsRepo: ProviderAccountsRepo;
      workspacePrefsRepo: WorkspacePreferencesRepo;
    },
  ) {}

  get(sessionId: string): SessionStrategyContext {
    this.deps.sessionRepo.requireById(sessionId);
    return this.deps.strategyConfig.getContext(sessionId);
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

  getSelectorSettings(sessionId: string): SessionSelectorSettings {
    this.deps.sessionRepo.requireById(sessionId);
    return this.deps.strategyConfig.getSelectorSettings(sessionId);
  }

  listAiPhases(sessionId: string): SessionAiPhase[] {
    this.deps.sessionRepo.requireById(sessionId);
    return this.deps.strategyConfig.listAiPhases(sessionId);
  }

  getAiPhase(sessionId: string, phase: PipelinePhase): SessionAiPhase | null {
    this.deps.sessionRepo.requireById(sessionId);
    return this.deps.strategyConfig.getAiPhase(sessionId, phase);
  }

  listAiPhaseWorkers(sessionId: string): SessionAiPhaseWorker[] {
    this.deps.sessionRepo.requireById(sessionId);
    return this.deps.strategyConfig.listAiPhaseWorkers(sessionId);
  }

  getAiPhaseWorker(
    sessionId: string,
    phase: PipelinePhase,
    workerId: string,
  ): SessionAiPhaseWorker | null {
    this.deps.sessionRepo.requireById(sessionId);
    return this.deps.strategyConfig.getAiPhaseWorker(
      sessionId,
      phase,
      workerId,
    );
  }

  getPageData(sessionId: string): StrategyPageData {
    const session = this.deps.sessionRepo.requireById(sessionId);
    const record = this.deps.strategyConfig.get(sessionId);
    const ctx = this.get(sessionId);
    const workspacePrefs = this.deps.workspacePrefsRepo.get();
    const phases = docToAiPhases(sessionId, record.doc, record.updatedAt);
    const workers = docToAiPhaseWorkers(
      sessionId,
      record.doc,
      record.updatedAt,
    );

    return {
      ...ctx,
      selectorSettings: docToSelectorSettings(
        sessionId,
        record.doc,
        record.updatedAt,
      ),
      providers: this.deps.providerAccountsRepo
        .list()
        .filter((provider) => provider.category === "ai"),
      sessionStatus: session.status,
      selectionMode: session.selectionMode,
      defaultSearchProviderId: session.defaultSearchProviderId,
      workspaceDefaultSearchProviderId: workspacePrefs.defaultSearchProviderId,
      workspaceDefaultModelProviderKey: workspacePrefs.defaultModelProviderKey,
      workspaceDefaultModelModelId: workspacePrefs.defaultModelModelId,
      aiPhases: phases.map((phase) => ({
        ...phase,
        workerOverrides: workers.filter(
          (worker) => worker.phase === phase.phase,
        ),
      })),
    };
  }

  saveResearchPosture(
    sessionId: string,
    patch: Partial<SessionResearchPosture>,
  ): SessionResearchPosture {
    this.assertEditable(sessionId);
    const next = {
      ...this.get(sessionId),
      researchPosture: {
        ...this.get(sessionId).researchPosture,
        ...patch,
        sessionId,
      },
    };
    this.validate(next);
    return this.deps.strategyConfig.patchResearchPosture(sessionId, patch);
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
    return this.deps.strategyConfig.patchRules(sessionId, patch);
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
    return this.deps.strategyConfig.patchRiskConfig(sessionId, patch);
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
    return this.deps.strategyConfig.patchTimeframe(sessionId, patch);
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
    return this.deps.strategyConfig.patchAiSettings(sessionId, patch);
  }

  saveSelectorSettings(
    sessionId: string,
    patch: Partial<SessionSelectorSettings>,
  ): SessionSelectorSettings {
    this.assertEditable(sessionId);
    return this.deps.strategyConfig.patchSelectorSettings(sessionId, patch);
  }

  saveAiPhase(
    sessionId: string,
    patch: Partial<SessionAiPhase> & { phase: PipelinePhase },
  ): SessionAiPhase {
    this.assertEditable(sessionId);
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
    return this.deps.strategyConfig.patchAiPhase(sessionId, patch);
  }

  saveAiPhaseWorker(
    sessionId: string,
    patch: SessionAiPhaseWorker,
  ): SessionAiPhaseWorker {
    this.assertEditable(sessionId);
    if (!this.deps.strategyConfig.getAiPhase(sessionId, patch.phase)) {
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
    return this.deps.strategyConfig.patchAiPhaseWorker(sessionId, patch);
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

/** A posture that hunts for / requires a material EDGAR 8-K catalyst. */
export function postureRequiresEdgarCatalyst(
  posture: Pick<SessionResearchPosture, "catalystMode" | "processingMode">,
): boolean {
  return (
    posture.catalystMode === "required" ||
    posture.processingMode === "catalyst" ||
    posture.processingMode === "contract"
  );
}

/**
 * True when a research posture can be satisfied by the session's subscribed
 * signal sources. A catalyst-required posture needs the EDGAR 8-K signal; any
 * other signal (e.g. mock) can never deliver an 8-K, so the combination
 * is incompatible. Non-catalyst postures are always compatible.
 */
export function postureSignalCompatible(
  posture: Pick<SessionResearchPosture, "catalystMode" | "processingMode">,
  signalTypes: readonly string[],
): boolean {
  if (!postureRequiresEdgarCatalyst(posture)) return true;
  return signalTypes.includes("edgar_8k");
}
