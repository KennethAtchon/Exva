import { create } from "zustand";
import { buildStrategyBriefMarkdown, validateSessionStrategyContext } from "../../electron/shared/domain";
import { api, type ProviderModelEntry, type StrategyGetResponse } from "@/lib/exva";
import type {
  AgentRole,
  SessionAiRole,
  SessionRiskConfig,
  SessionStrategyContext,
  SessionStrategyProfile,
  SessionTimeframeConfig,
} from "@/lib/types";

type StrategyPageState = "no_session" | "editable" | "locked";
type StrategySectionTab = "strategy" | "risk" | "timeframe" | "ai_roles";

interface StrategyStoreState {
  profile: SessionStrategyProfile | null;
  riskConfig: SessionRiskConfig | null;
  timeframe: SessionTimeframeConfig | null;
  aiRoles: Record<AgentRole, SessionAiRole>;
  providers: StrategyGetResponse["providers"];
  selectorSettings: StrategyGetResponse["selectorSettings"] | null;
  selectionMode: StrategyGetResponse["selectionMode"] | null;
  defaultSearchProviderId: string | null;
  workspaceDefaultSearchProviderId: string | null;
  dirtyFields: Set<string>;
  dirtyRoles: Set<AgentRole>;
  activeRoleTab: AgentRole;
  activeSection: StrategySectionTab;
  providerModels: Record<string, ProviderModelEntry[]>;
  roleErrors: Record<AgentRole, string[]>;
  strategyErrors: string[];
  isSaving: boolean;
  isLocked: boolean;
  state: StrategyPageState;
  loadStrategy: (sessionId: string) => Promise<void>;
  updateProfile: (patch: Partial<SessionStrategyProfile>) => void;
  updateRiskConfig: (patch: Partial<SessionRiskConfig>) => void;
  updateTimeframe: (patch: Partial<SessionTimeframeConfig>) => void;
  updateRole: (role: AgentRole, patch: Partial<SessionAiRole>) => Promise<void>;
  saveAll: (sessionId: string) => Promise<void>;
  resetRole: (role: AgentRole) => Promise<void>;
  setActiveTab: (role: AgentRole) => void;
  setActiveSection: (section: StrategySectionTab) => void;
}

const EMPTY_AI_ROLES = (): Record<AgentRole, SessionAiRole> => ({
  analyst_technical: emptyRole("analyst_technical"),
  analyst_fundamental: emptyRole("analyst_fundamental"),
  reviewer: emptyRole("reviewer"),
  decision_maker: emptyRole("decision_maker"),
  instrument_selector: emptyRole("instrument_selector"),
});

export const useStrategyStore = create<StrategyStoreState>((set, get) => ({
  profile: null,
  riskConfig: null,
  timeframe: null,
  aiRoles: EMPTY_AI_ROLES(),
  providers: [],
  selectorSettings: null,
  selectionMode: null,
  defaultSearchProviderId: null,
  workspaceDefaultSearchProviderId: null,
  dirtyFields: new Set(),
  dirtyRoles: new Set(),
  activeRoleTab: "analyst_technical",
  activeSection: "strategy",
  providerModels: {},
  roleErrors: emptyRoleErrors(),
  strategyErrors: [],
  isSaving: false,
  isLocked: false,
  state: "no_session",
  loadStrategy: async (sessionId) => {
    const result = await api.getStrategy(sessionId);
    const aiRoles = EMPTY_AI_ROLES();
    for (const role of result.aiRoles) {
      aiRoles[role.role] = role;
    }

    const providerModels: Record<string, ProviderModelEntry[]> = {};
    for (const provider of result.providers) {
      const models = await api.getStrategyProviderModels(provider.id);
      providerModels[provider.id] = models.models;
    }

    set({
      profile: result.profile,
      riskConfig: result.riskConfig,
      timeframe: result.timeframe,
      aiRoles,
      providers: result.providers,
      selectorSettings: result.selectorSettings,
      selectionMode: result.selectionMode,
      defaultSearchProviderId: result.defaultSearchProviderId,
      workspaceDefaultSearchProviderId: result.workspaceDefaultSearchProviderId,
      dirtyFields: new Set(),
      dirtyRoles: new Set(),
      activeRoleTab: "analyst_technical",
      activeSection: "strategy",
      providerModels,
      roleErrors: emptyRoleErrors(),
      strategyErrors: [],
      isSaving: false,
      isLocked: result.sessionStatus === "active" || result.sessionStatus === "paused",
      state: result.sessionStatus === "active" || result.sessionStatus === "paused" ? "locked" : "editable",
    });
  },
  updateProfile: (patch) => {
    const profile = get().profile;
    if (!profile) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch)) dirtyFields.add(`profile.${key}`);
    set({ profile: { ...profile, ...patch }, dirtyFields, strategyErrors: [] });
  },
  updateRiskConfig: (patch) => {
    const riskConfig = get().riskConfig;
    if (!riskConfig) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch)) dirtyFields.add(`riskConfig.${key}`);
    set({ riskConfig: { ...riskConfig, ...patch }, dirtyFields, strategyErrors: [] });
  },
  updateTimeframe: (patch) => {
    const timeframe = get().timeframe;
    if (!timeframe) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch)) dirtyFields.add(`timeframe.${key}`);
    set({ timeframe: { ...timeframe, ...patch }, dirtyFields, strategyErrors: [] });
  },
  updateRole: async (role, patch) => {
    const current = get().aiRoles[role];
    const next = { ...current, ...patch };
    const dirtyFields = new Set(get().dirtyFields);
    const dirtyRoles = new Set(get().dirtyRoles);
    for (const key of Object.keys(patch)) dirtyFields.add(`${role}.${key}`);
    dirtyRoles.add(role);

    if (
      patch.providerKey !== undefined &&
      patch.modelId === undefined &&
      patch.providerKey !== current.providerKey
    ) {
      next.modelId = "";
    }

    set({
      aiRoles: { ...get().aiRoles, [role]: next },
      dirtyFields,
      dirtyRoles,
    });

    if (patch.providerKey) {
      const models = await api.getStrategyProviderModels(patch.providerKey);
      set({ providerModels: { ...get().providerModels, [patch.providerKey]: models.models } });
    }
  },
  saveAll: async (sessionId) => {
    const context = currentContext(get());
    if (!context) return;

    const profileWithBrief = {
      ...context.profile,
      strategyBriefMarkdown: buildStrategyBriefMarkdown(context),
    };

    try {
      validateSessionStrategyContext(
        { ...context, profile: profileWithBrief },
        { hasSearchProvider: Boolean(get().defaultSearchProviderId || get().workspaceDefaultSearchProviderId) },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid strategy configuration.";
      set({ strategyErrors: [message] });
      return;
    }

    const roleErrors = validateRoles(get());
    const hasErrors = Object.values(roleErrors).some((errors) => errors.length > 0);
    if (hasErrors) {
      set({ roleErrors, strategyErrors: [] });
      return;
    }

    set({ isSaving: true, strategyErrors: [] });
    try {
      await api.saveStrategyProfile({ sessionId, profile: profileWithBrief });
      await api.saveStrategyRiskConfig({ sessionId, riskConfig: context.riskConfig });
      await api.saveStrategyTimeframeConfig({ sessionId, timeframe: context.timeframe });
      await api.saveStrategyAiRoles({ sessionId, aiRoles: Object.values(get().aiRoles) });
      set({
        profile: profileWithBrief,
        dirtyFields: new Set(),
        dirtyRoles: new Set(),
        roleErrors: emptyRoleErrors(),
        strategyErrors: [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save strategy configuration.";
      set({ strategyErrors: [message] });
    } finally {
      set({ isSaving: false });
    }
  },
  resetRole: async (role) => {
    const result = await api.resetStrategyPrompt(role);
    const current = get().aiRoles[role];
    const dirtyFields = new Set(get().dirtyFields);
    dirtyFields.add(`${role}.promptSource`);
    dirtyFields.add(`${role}.promptMarkdown`);
    const dirtyRoles = new Set(get().dirtyRoles);
    dirtyRoles.add(role);
    set({
      aiRoles: {
        ...get().aiRoles,
        [role]: {
          ...current,
          promptSource: "default",
          promptMarkdown: result.promptMarkdown,
          promptAssetPath: result.promptAssetPath,
        },
      },
      dirtyFields,
      dirtyRoles,
    });
  },
  setActiveTab: (role) => set({ activeRoleTab: role }),
  setActiveSection: (section) => set({ activeSection: section }),
}));

function currentContext(state: StrategyStoreState): SessionStrategyContext | null {
  if (!state.profile || !state.riskConfig || !state.timeframe) return null;
  return {
    profile: state.profile,
    riskConfig: state.riskConfig,
    timeframe: state.timeframe,
  };
}

function emptyRoleErrors(): Record<AgentRole, string[]> {
  return {
    analyst_technical: [],
    analyst_fundamental: [],
    reviewer: [],
    decision_maker: [],
    instrument_selector: [],
  };
}

function validateRoles(state: StrategyStoreState): Record<AgentRole, string[]> {
  const errors = emptyRoleErrors();

  for (const role of Object.values(state.aiRoles)) {
    if (role.role === "instrument_selector") {
      if (state.selectionMode === "manual_shortlist") continue;
      if (state.selectorSettings && !state.selectorSettings.aiPickerEnabled) continue;
    }
    const provider = state.providers.find((entry) => entry.id === role.providerKey);
    if (!provider || !provider.isConfigured) {
      errors[role.role].push("Connect this provider in Accounts before assigning it to a role.");
    }
    if (!role.modelId.trim()) {
      errors[role.role].push(`Select a model for ${role.role}.`);
    }
    if (role.promptSource === "session_override" && !role.promptMarkdown.trim()) {
      errors[role.role].push("Prompt cannot be empty. Reset to default or add content.");
    }
  }

  return errors;
}

function emptyRole(role: AgentRole): SessionAiRole {
  return {
    sessionId: "",
    role,
    providerKey: "",
    modelId: "",
    temperature: 0.7,
    maxTokens: 8192,
    promptSource: "default",
    promptMarkdown: "",
    promptAssetPath: null,
  };
}
