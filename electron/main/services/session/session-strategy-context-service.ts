import type {
  AgentRole,
  ProviderAccount,
  SessionAiRole,
  SessionAiRoleProfile,
  SessionResearchPosture,
  SessionRiskConfig,
  SessionSelectorSettings,
  SessionStatus,
  SessionStrategyContext,
  SessionTradeRules,
  SessionTimeframeConfig,
  SelectionMode,
} from "@/lib/types";
import { isSessionEditable, validateSessionStrategyContext } from "@electron/shared/domain";
import { AppError } from "@electron/shared/errors";
import type { ProviderAccountsRepo } from "../../db/repositories/provider-accounts-repo";
import type { SessionAiRoleProfileRepo } from "../../db/repositories/session-ai-role-profile-repo";
import type { SessionAiRolesRepo } from "../../db/repositories/session-ai-roles-repo";
import type { SessionRepo } from "../../db/repositories/session-repo";
import type { SessionResearchPostureRepo } from "../../db/repositories/session-research-posture-repo";
import type { SessionRiskConfigRepo } from "../../db/repositories/session-risk-config-repo";
import type { SessionSelectorSettingsRepo } from "../../db/repositories/session-selector-settings-repo";
import type { SessionTradeRulesRepo } from "../../db/repositories/session-trade-rules-repo";
import type { SessionTimeframeConfigRepo } from "../../db/repositories/session-timeframe-config-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace-prefs-repo";
import type { PromptAssetLoader } from "../ai/prompt-asset-loader";

export interface StrategyPageData {
  researchPosture: SessionResearchPosture;
  rules: SessionTradeRules;
  riskConfig: SessionRiskConfig;
  timeframe: SessionTimeframeConfig;
  aiRoles: SessionAiRole[];
  aiRoleProfiles: SessionAiRoleProfile[];
  selectorSettings: SessionSelectorSettings;
  providers: ProviderAccount[];
  sessionStatus: SessionStatus;
  selectionMode: SelectionMode;
  defaultSearchProviderId: string | null;
  workspaceDefaultSearchProviderId: string | null;
  workspaceDefaultModelProviderKey: string;
  workspaceDefaultModelModelId: string;
}

export class SessionStrategyContextService {
  constructor(
    private readonly deps: {
      sessionRepo: SessionRepo;
      researchPostureRepo: SessionResearchPostureRepo;
      aiRoleProfileRepo: SessionAiRoleProfileRepo;
      rulesRepo: SessionTradeRulesRepo;
      riskRepo: SessionRiskConfigRepo;
      timeframeRepo: SessionTimeframeConfigRepo;
      aiRolesRepo: SessionAiRolesRepo;
      selectorSettingsRepo: SessionSelectorSettingsRepo;
      providerAccountsRepo: ProviderAccountsRepo;
      workspacePrefsRepo: WorkspacePreferencesRepo;
      promptAssetLoader: PromptAssetLoader;
    },
  ) {}

  get(sessionId: string): SessionStrategyContext {
    return {
      researchPosture: this.deps.researchPostureRepo.get(sessionId),
      rules: this.deps.rulesRepo.get(sessionId),
      riskConfig: this.deps.riskRepo.get(sessionId),
      timeframe: this.deps.timeframeRepo.get(sessionId),
      aiRoleProfiles: this.deps.aiRoleProfileRepo.list(sessionId),
    };
  }

  getResearchPosture(sessionId: string): SessionResearchPosture {
    return this.get(sessionId).researchPosture;
  }

  getAiRoleProfile(sessionId: string, role: AgentRole): SessionAiRoleProfile {
    return this.deps.aiRoleProfileRepo.get(sessionId, role);
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
    const aiRoles = this.deps.aiRolesRepo.listBySession(sessionId).map((role) => {
      if (role.promptSource !== "default") return role;
      return {
        ...role,
        promptMarkdown: this.deps.promptAssetLoader.load(role.role),
        promptAssetPath: this.deps.promptAssetLoader.assetPath(role.role),
      };
    });

    const ctx = this.get(sessionId);

    return {
      ...ctx,
      aiRoles,
      selectorSettings: this.deps.selectorSettingsRepo.get(sessionId),
      providers: this.deps.providerAccountsRepo.list().filter((provider) => provider.category === "ai"),
      sessionStatus: session.status,
      selectionMode: session.selectionMode,
      defaultSearchProviderId: session.defaultSearchProviderId,
      workspaceDefaultSearchProviderId: this.deps.workspacePrefsRepo.get().defaultSearchProviderId,
      workspaceDefaultModelProviderKey: this.deps.workspacePrefsRepo.get().defaultModelProviderKey,
      workspaceDefaultModelModelId: this.deps.workspacePrefsRepo.get().defaultModelModelId,
    };
  }

  saveResearchPosture(sessionId: string, patch: Partial<SessionResearchPosture>): SessionResearchPosture {
    this.assertEditable(sessionId);
    const current = this.get(sessionId);
    const next = {
      ...current,
      researchPosture: { ...current.researchPosture, ...patch, sessionId },
    };
    this.validate(next);
    return this.deps.researchPostureRepo.upsert(sessionId, next.researchPosture);
  }

  saveRules(sessionId: string, patch: Partial<SessionTradeRules>): SessionTradeRules {
    this.assertEditable(sessionId);
    const current = this.get(sessionId);
    const next = { ...current, rules: { ...current.rules, ...patch, sessionId } };
    this.validate(next);
    return this.deps.rulesRepo.upsert(sessionId, next.rules);
  }

  saveRiskConfig(sessionId: string, patch: Partial<SessionRiskConfig>): SessionRiskConfig {
    this.assertEditable(sessionId);
    const current = this.get(sessionId);
    const next = { ...current, riskConfig: { ...current.riskConfig, ...patch, sessionId } };
    this.validate(next);
    return this.deps.riskRepo.upsert(sessionId, next.riskConfig);
  }

  saveTimeframeConfig(sessionId: string, patch: Partial<SessionTimeframeConfig>): SessionTimeframeConfig {
    this.assertEditable(sessionId);
    const current = this.get(sessionId);
    const next = { ...current, timeframe: { ...current.timeframe, ...patch, sessionId } };
    this.validate(next);
    return this.deps.timeframeRepo.upsert(sessionId, next.timeframe);
  }

  saveAiRoleProfiles(
    sessionId: string,
    patches: Array<{
      role: AgentRole;
      profileJson?: SessionAiRoleProfile["profileJson"];
    }>,
  ): void {
    this.assertEditable(sessionId);
    for (const patch of patches) {
      this.deps.aiRoleProfileRepo.upsert(sessionId, patch.role, patch);
    }
    this.validate(this.get(sessionId));
  }

  saveAiRoles(sessionId: string, aiRoles: SessionAiRole[]): void {
    this.assertEditable(sessionId);

    const session = this.deps.sessionRepo.requireById(sessionId);
    const selectorSettings = this.deps.selectorSettingsRepo.get(sessionId);

    for (const role of aiRoles) {
      if (role.role === "instrument_selector") {
        if (session.selectionMode === "manual_shortlist") continue;
        if (!selectorSettings.aiPickerEnabled) continue;
      }
      const provider = this.deps.providerAccountsRepo.find(role.providerKey);
      if (!provider || !provider.isConfigured) {
        throw new AppError("Connect this provider in Accounts before assigning it to a role.", "PROVIDER_NOT_CONFIGURED", {
          role: role.role,
        });
      }
      if (!role.modelId.trim()) {
        throw new AppError(`Select a model for ${role.role}.`, "VALIDATION_FAILED", { role: role.role, field: "modelId" });
      }
      if (role.promptSource === "session_override" && !role.promptMarkdown.trim()) {
        throw new AppError("Prompt cannot be empty. Reset to default or add content.", "VALIDATION_FAILED", {
          role: role.role,
          field: "promptMarkdown",
        });
      }
    }

    this.deps.aiRolesRepo.replaceAll(sessionId, aiRoles);
  }

  resetPrompt(role: AgentRole): { promptMarkdown: string; promptAssetPath: string } {
    return {
      promptMarkdown: this.deps.promptAssetLoader.load(role),
      promptAssetPath: this.deps.promptAssetLoader.assetPath(role),
    };
  }

  private validate(context: SessionStrategyContext): void {
    try {
      validateSessionStrategyContext(context, { hasSearchProvider: this.hasSearchProvider(context.researchPosture.sessionId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid strategy configuration.";
      throw new AppError(message, "VALIDATION_FAILED", { sessionId: context.researchPosture.sessionId });
    }
  }

  private hasSearchProvider(sessionId: string): boolean {
    const session = this.deps.sessionRepo.requireById(sessionId);
    const workspacePrefs = this.deps.workspacePrefsRepo.get();
    return Boolean(session.defaultSearchProviderId || workspacePrefs.defaultSearchProviderId);
  }

  private assertEditable(sessionId: string): void {
    const session = this.deps.sessionRepo.requireById(sessionId);
    if (!isSessionEditable(session.status)) {
      throw new AppError("Stop this session before editing its strategy or AI configuration.", "LOCKED", { sessionId });
    }
  }
}
