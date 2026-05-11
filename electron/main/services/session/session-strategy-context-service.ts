import type {
  AgentRole,
  ProviderAccount,
  SessionAiRole,
  SessionRiskConfig,
  SessionSelectorSettings,
  SessionStatus,
  SessionStrategyContext,
  SessionTradeRules,
  SessionTimeframeConfig,
  SessionTradingStyle,
  SelectionMode,
} from "@/lib/types";
import { isSessionEditable, validateSessionStrategyContext } from "@electron/shared/domain";
import { AppError } from "@electron/shared/errors";
import type { ProviderAccountsRepo } from "../../db/repositories/provider-accounts-repo";
import type { SessionAiRolesRepo } from "../../db/repositories/session-ai-roles-repo";
import type { SessionRepo } from "../../db/repositories/session-repo";
import type { SessionRiskConfigRepo } from "../../db/repositories/session-risk-config-repo";
import type { SessionSelectorSettingsRepo } from "../../db/repositories/session-selector-settings-repo";
import type { SessionTradeRulesRepo } from "../../db/repositories/session-trade-rules-repo";
import type { SessionTimeframeConfigRepo } from "../../db/repositories/session-timeframe-config-repo";
import type { SessionTradingStyleRepo } from "../../db/repositories/session-trading-style-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace-prefs-repo";
import type { PromptAssetLoader } from "../ai/prompt-asset-loader";

export interface StrategyPageData {
  style: SessionTradingStyle;
  rules: SessionTradeRules;
  riskConfig: SessionRiskConfig;
  timeframe: SessionTimeframeConfig;
  aiRoles: SessionAiRole[];
  selectorSettings: SessionSelectorSettings;
  providers: ProviderAccount[];
  sessionStatus: SessionStatus;
  selectionMode: SelectionMode;
  defaultSearchProviderId: string | null;
  workspaceDefaultSearchProviderId: string | null;
}

export class SessionStrategyContextService {
  constructor(
    private readonly deps: {
      sessionRepo: SessionRepo;
      styleRepo: SessionTradingStyleRepo;
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
      style: this.deps.styleRepo.get(sessionId),
      rules: this.deps.rulesRepo.get(sessionId),
      riskConfig: this.deps.riskRepo.get(sessionId),
      timeframe: this.deps.timeframeRepo.get(sessionId),
    };
  }

  getStyle(sessionId: string): SessionTradingStyle {
    return this.get(sessionId).style;
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

    return {
      ...this.get(sessionId),
      aiRoles,
      selectorSettings: this.deps.selectorSettingsRepo.get(sessionId),
      providers: this.deps.providerAccountsRepo.list().filter((provider) => provider.category === "ai"),
      sessionStatus: session.status,
      selectionMode: session.selectionMode,
      defaultSearchProviderId: session.defaultSearchProviderId,
      workspaceDefaultSearchProviderId: this.deps.workspacePrefsRepo.get().defaultSearchProviderId,
    };
  }

  saveStyle(sessionId: string, patch: Partial<SessionTradingStyle>): SessionTradingStyle {
    this.assertEditable(sessionId);
    const current = this.get(sessionId);
    const next = { ...current, style: { ...current.style, ...patch, sessionId } };
    this.validate(next);
    return this.deps.styleRepo.upsert(sessionId, next.style);
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

  saveAiRoles(sessionId: string, aiRoles: SessionAiRole[]): void {
    this.assertEditable(sessionId);

    const session = this.deps.sessionRepo.requireById(sessionId);
    const workspacePrefs = this.deps.workspacePrefsRepo.get();
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
      validateSessionStrategyContext(context, { hasSearchProvider: this.hasSearchProvider(context.style.sessionId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid strategy configuration.";
      throw new AppError(message, "VALIDATION_FAILED", { sessionId: context.style.sessionId });
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
