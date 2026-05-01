import { create } from "zustand";
import { api, type ProviderModelEntry, type StrategyGetResponse } from "@/lib/exva";
import type { AgentRole, SessionAiRole, SessionStrategy } from "@/lib/types";

type StrategyPageState = "no_session" | "editable" | "locked";

interface StrategyStoreState {
  strategy: SessionStrategy | null;
  aiRoles: Record<AgentRole, SessionAiRole>;
  providers: StrategyGetResponse["providers"];
  selectorSettings: StrategyGetResponse["selectorSettings"] | null;
  selectionMode: StrategyGetResponse["selectionMode"] | null;
  defaultSearchProviderId: string | null;
  workspaceDefaultSearchProviderId: string | null;
  dirtyFields: Set<string>;
  dirtyRoles: Set<AgentRole>;
  activeRoleTab: AgentRole;
  providerModels: Record<string, ProviderModelEntry[]>;
  roleErrors: Record<AgentRole, string[]>;
  isSaving: boolean;
  isLocked: boolean;
  state: StrategyPageState;
  loadStrategy: (sessionId: string) => Promise<void>;
  updateStrategy: (patch: Partial<SessionStrategy>) => void;
  updateRole: (role: AgentRole, patch: Partial<SessionAiRole>) => Promise<void>;
  saveAll: (sessionId: string) => Promise<void>;
  resetRole: (role: AgentRole) => Promise<void>;
  setActiveTab: (role: AgentRole) => void;
}

const EMPTY_AI_ROLES = (): Record<AgentRole, SessionAiRole> => ({
  researcher_bull: emptyRole("researcher_bull"),
  researcher_bear: emptyRole("researcher_bear"),
  reviewer: emptyRole("reviewer"),
  decision_maker: emptyRole("decision_maker"),
  instrument_selector: emptyRole("instrument_selector"),
});

export const useStrategyStore = create<StrategyStoreState>((set, get) => ({
  strategy: null,
  aiRoles: EMPTY_AI_ROLES(),
  providers: [],
  selectorSettings: null,
  selectionMode: null,
  defaultSearchProviderId: null,
  workspaceDefaultSearchProviderId: null,
  dirtyFields: new Set(),
  dirtyRoles: new Set(),
  activeRoleTab: "researcher_bull",
  providerModels: {},
  roleErrors: emptyRoleErrors(),
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
      strategy: result.strategy,
      aiRoles,
      providers: result.providers,
      selectorSettings: result.selectorSettings,
      selectionMode: result.selectionMode,
      defaultSearchProviderId: result.defaultSearchProviderId,
      workspaceDefaultSearchProviderId: result.workspaceDefaultSearchProviderId,
      dirtyFields: new Set(),
      dirtyRoles: new Set(),
      activeRoleTab: "researcher_bull",
      providerModels,
      roleErrors: emptyRoleErrors(),
      isSaving: false,
      isLocked: result.sessionStatus === "active" || result.sessionStatus === "paused",
      state: result.sessionStatus === "active" || result.sessionStatus === "paused" ? "locked" : "editable",
    });
  },
  updateStrategy: (patch) => {
    const strategy = get().strategy;
    if (!strategy) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch)) dirtyFields.add(`strategy.${key}`);
    set({ strategy: { ...strategy, ...patch }, dirtyFields });
  },
  updateRole: async (role, patch) => {
    const current = get().aiRoles[role];
    const next = { ...current, ...patch };
    const dirtyFields = new Set(get().dirtyFields);
    const dirtyRoles = new Set(get().dirtyRoles);
    for (const key of Object.keys(patch)) dirtyFields.add(`${role}.${key}`);
    dirtyRoles.add(role);

    if (patch.providerKey !== undefined) {
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
    const strategy = get().strategy;
    if (!strategy) return;
    const roleErrors = validateRoles(get());
    const hasErrors = Object.values(roleErrors).some((errors) => errors.length > 0);
    if (hasErrors) {
      set({ roleErrors });
      return;
    }
    set({ isSaving: true });
    try {
      await api.saveStrategy({ sessionId, strategy, aiRoles: Object.values(get().aiRoles) });
      set({ dirtyFields: new Set(), dirtyRoles: new Set(), roleErrors: emptyRoleErrors() });
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
}));

function emptyRoleErrors(): Record<AgentRole, string[]> {
  return {
    researcher_bull: [],
    researcher_bear: [],
    reviewer: [],
    decision_maker: [],
    instrument_selector: [],
  };
}

function validateRoles(state: StrategyStoreState): Record<AgentRole, string[]> {
  const errors = emptyRoleErrors();

  for (const role of Object.values(state.aiRoles)) {
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
    if (role.webSearchEnabled && !state.defaultSearchProviderId && !state.workspaceDefaultSearchProviderId) {
      errors[role.role].push("Connect a web search provider to enable internet search for this role.");
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
    maxTokens: 4096,
    webSearchEnabled: false,
    promptSource: "default",
    promptMarkdown: "",
    promptAssetPath: null,
  };
}
