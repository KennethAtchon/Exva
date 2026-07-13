import { create } from "zustand";
import {
  buildTradeRulesMarkdown,
  validateSessionStrategyContext,
} from "../../electron/shared/domain";
import { api, type StrategyGetResponse } from "@/lib/exva";
import type { PipelinePhase } from "../../electron/shared/ai/ai-phase";
import type {
  SessionResearchPosture,
  SessionRiskConfig,
  SessionAiSettings,
  SessionStrategyContext,
  SessionTradeRules,
  SessionTimeframeConfig,
} from "@/lib/types";
import type { PhaseRuntimeSummary, UserGlobalPresetRow } from "@/lib/exva";
import type { GlobalStrategyPreset } from "../../electron/shared/presets";
import {
  buildStrategyConfigPatch,
  configPresetToUserGlobalRow,
  isStaleVersionError,
  mapDocToUiSections,
  staleVersionUserMessage,
  type StrategyConfigRecord,
} from "@/lib/strategy-config-ui";

type StrategyPageState = "no_session" | "editable" | "locked";
type StrategySectionTab = "style" | "rules" | "risk" | "timeframe" | "ai";

interface StrategyStoreState {
  configVersion: number | null;
  researchPosture: SessionResearchPosture | null;
  rules: SessionTradeRules | null;
  riskConfig: SessionRiskConfig | null;
  timeframe: SessionTimeframeConfig | null;
  aiSettings: SessionAiSettings | null;
  providers: StrategyGetResponse["providers"];
  selectorSettings: StrategyGetResponse["selectorSettings"] | null;
  selectionMode: StrategyGetResponse["selectionMode"] | null;
  defaultSearchProviderId: string | null;
  workspaceDefaultSearchProviderId: string | null;
  workspaceDefaultModelProviderKey: string;
  workspaceDefaultModelModelId: string;
  aiPhases: PhaseRuntimeSummary[];
  globalPresets: UserGlobalPresetRow[];
  dirtyFields: Set<string>;
  activeSection: StrategySectionTab;
  strategyErrors: string[];
  isSaving: boolean;
  isLocked: boolean;
  state: StrategyPageState;
  loadStrategy: (sessionId: string) => Promise<void>;
  resetForEnvironmentChange: () => void;
  loadGlobalPresets: () => Promise<void>;
  updateResearchPosture: (patch: Partial<SessionResearchPosture>) => void;
  updateRules: (patch: Partial<SessionTradeRules>) => void;
  updateRiskConfig: (patch: Partial<SessionRiskConfig>) => void;
  updateTimeframe: (patch: Partial<SessionTimeframeConfig>) => void;
  updateAiSettings: (patch: Partial<SessionAiSettings>) => void;
  updateAiPhase: (
    phase: PipelinePhase,
    patch: Partial<PhaseRuntimeSummary>,
  ) => void;
  applyGlobalPreset: (
    sessionId: string,
    preset: GlobalStrategyPreset,
  ) => Promise<void>;
  applyConfigRecord: (sessionId: string, record: StrategyConfigRecord) => void;
  saveAll: (sessionId: string) => Promise<void>;
  setActiveSection: (section: StrategySectionTab) => void;
}

function pageLockState(
  sessionStatus: StrategyGetResponse["sessionStatus"],
): Pick<StrategyStoreState, "isLocked" | "state"> {
  const locked =
    sessionStatus === "active" ||
    sessionStatus === "paused" ||
    sessionStatus === "monitoring_only";
  return {
    isLocked: locked,
    state: locked ? "locked" : "editable",
  };
}

export const useStrategyStore = create<StrategyStoreState>((set, get) => ({
  configVersion: null,
  researchPosture: null,
  rules: null,
  riskConfig: null,
  timeframe: null,
  aiSettings: null,
  providers: [],
  selectorSettings: null,
  selectionMode: null,
  defaultSearchProviderId: null,
  workspaceDefaultSearchProviderId: null,
  workspaceDefaultModelProviderKey: "",
  workspaceDefaultModelModelId: "",
  aiPhases: [],
  globalPresets: [],
  dirtyFields: new Set(),
  activeSection: "style",
  strategyErrors: [],
  isSaving: false,
  isLocked: false,
  state: "no_session",
  loadStrategy: async (sessionId) => {
    const [config, page, presetsResult] = await Promise.all([
      api.getStrategyConfig(sessionId),
      api.getStrategy(sessionId),
      api.listStrategyConfigPresets("full"),
    ]);
    const sections = mapDocToUiSections(
      sessionId,
      config.doc,
      config.updatedAt,
    );

    set({
      configVersion: config.version,
      researchPosture: sections.researchPosture,
      rules: sections.rules,
      riskConfig: sections.riskConfig,
      timeframe: sections.timeframe,
      aiSettings: sections.aiSettings,
      aiPhases: sections.aiPhases,
      providers: page.providers,
      selectorSettings: page.selectorSettings,
      selectionMode: page.selectionMode,
      defaultSearchProviderId: page.defaultSearchProviderId,
      workspaceDefaultSearchProviderId: page.workspaceDefaultSearchProviderId,
      workspaceDefaultModelProviderKey: page.workspaceDefaultModelProviderKey,
      workspaceDefaultModelModelId: page.workspaceDefaultModelModelId,
      globalPresets: presetsResult.presets.map(configPresetToUserGlobalRow),
      dirtyFields: new Set(),
      activeSection: "style",
      strategyErrors: [],
      isSaving: false,
      ...pageLockState(page.sessionStatus),
    });
  },
  resetForEnvironmentChange: () =>
    set({
      configVersion: null,
      researchPosture: null,
      rules: null,
      riskConfig: null,
      timeframe: null,
      aiSettings: null,
      providers: [],
      selectorSettings: null,
      selectionMode: null,
      defaultSearchProviderId: null,
      aiPhases: [],
      dirtyFields: new Set(),
      strategyErrors: [],
      isSaving: false,
      isLocked: false,
      state: "no_session",
    }),
  loadGlobalPresets: async () => {
    const result = await api.listStrategyConfigPresets("full");
    set({ globalPresets: result.presets.map(configPresetToUserGlobalRow) });
  },
  updateResearchPosture: (patch) => {
    const researchPosture = get().researchPosture;
    if (!researchPosture) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch))
      dirtyFields.add(`researchPosture.${key}`);
    set({
      researchPosture: { ...researchPosture, ...patch },
      dirtyFields,
      strategyErrors: [],
    });
  },
  updateRules: (patch) => {
    const rules = get().rules;
    if (!rules) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch)) dirtyFields.add(`rules.${key}`);
    set({ rules: { ...rules, ...patch }, dirtyFields, strategyErrors: [] });
  },
  updateRiskConfig: (patch) => {
    const riskConfig = get().riskConfig;
    if (!riskConfig) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch)) dirtyFields.add(`riskConfig.${key}`);
    set({
      riskConfig: { ...riskConfig, ...patch },
      dirtyFields,
      strategyErrors: [],
    });
  },
  updateTimeframe: (patch: Partial<SessionTimeframeConfig>) => {
    const timeframe = get().timeframe;
    if (!timeframe) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch)) dirtyFields.add(`timeframe.${key}`);
    set({
      timeframe: { ...timeframe, ...patch },
      dirtyFields,
      strategyErrors: [],
    });
  },
  updateAiSettings: (patch) => {
    const aiSettings = get().aiSettings;
    if (!aiSettings) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch)) dirtyFields.add(`aiSettings.${key}`);
    set({
      aiSettings: { ...aiSettings, ...patch },
      dirtyFields,
      strategyErrors: [],
    });
  },
  updateAiPhase: (phase, patch) => {
    const aiPhases = get().aiPhases;
    const index = aiPhases.findIndex((p) => p.phase === phase);
    if (index < 0) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch))
      dirtyFields.add(`aiPhases.${phase}.${key}`);
    const next = [...aiPhases];
    const currentPhase = aiPhases[index];
    if (!currentPhase) return;
    next[index] = { ...currentPhase, ...patch, phase };
    set({ aiPhases: next, dirtyFields, strategyErrors: [] });
  },
  applyConfigRecord: (sessionId, record) => {
    const sections = mapDocToUiSections(
      sessionId,
      record.doc,
      record.updatedAt,
    );
    set({
      configVersion: record.version,
      researchPosture: sections.researchPosture,
      rules: sections.rules,
      riskConfig: sections.riskConfig,
      timeframe: sections.timeframe,
      aiSettings: sections.aiSettings,
      aiPhases: sections.aiPhases,
      dirtyFields: new Set(),
      strategyErrors: [],
      isSaving: false,
    });
  },
  applyGlobalPreset: async (sessionId, preset) => {
    const expectedVersion = get().configVersion;
    if (expectedVersion == null) return;
    set({ isSaving: true, strategyErrors: [] });
    try {
      const result = await api.applyStrategyConfigPreset({
        sessionId,
        presetId: preset.id,
        expectedVersion,
      });
      get().applyConfigRecord(sessionId, result);
    } catch (err) {
      if (isStaleVersionError(err)) {
        await get().loadStrategy(sessionId);
        set({ strategyErrors: [staleVersionUserMessage()] });
        return;
      }
      const message =
        err instanceof Error ? err.message : "Failed to apply strategy preset.";
      set({ strategyErrors: [message] });
    } finally {
      set({ isSaving: false });
    }
  },
  saveAll: async (sessionId) => {
    const context = currentContext(get());
    const expectedVersion = get().configVersion;
    if (!context || expectedVersion == null) return;

    const rulesWithMarkdown = {
      ...context.rules,
      tradeRulesMarkdown: buildTradeRulesMarkdown(context.rules),
    };

    try {
      validateSessionStrategyContext(
        { ...context, rules: rulesWithMarkdown },
        {
          hasSearchProvider: Boolean(
            get().defaultSearchProviderId ||
            get().workspaceDefaultSearchProviderId,
          ),
        },
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid strategy configuration.";
      set({ strategyErrors: [message] });
      return;
    }

    const dirtyFields = new Set(get().dirtyFields);
    if (dirtyFields.size === 0) return;

    // Ensure markdown is included when rules are dirty.
    if ([...dirtyFields].some((field) => field.startsWith("rules."))) {
      dirtyFields.add("rules.tradeRulesMarkdown");
    }

    const patch = buildStrategyConfigPatch({
      dirtyFields,
      researchPosture: context.researchPosture,
      rules: rulesWithMarkdown,
      riskConfig: context.riskConfig,
      timeframe: context.timeframe,
      aiSettings: context.aiSettings,
      aiPhases: get().aiPhases,
    });

    if (Object.keys(patch).length === 0) return;

    set({ isSaving: true, strategyErrors: [] });
    try {
      const result = await api.updateStrategyConfig({
        sessionId,
        expectedVersion,
        patch,
      });
      get().applyConfigRecord(sessionId, result);
    } catch (err) {
      if (isStaleVersionError(err)) {
        await get().loadStrategy(sessionId);
        set({ strategyErrors: [staleVersionUserMessage()] });
        return;
      }
      const message =
        err instanceof Error
          ? err.message
          : "Failed to save strategy configuration.";
      set({ strategyErrors: [message] });
    } finally {
      set({ isSaving: false });
    }
  },
  setActiveSection: (section) => set({ activeSection: section }),
}));

function currentContext(
  state: StrategyStoreState,
): SessionStrategyContext | null {
  if (
    !state.researchPosture ||
    !state.rules ||
    !state.riskConfig ||
    !state.timeframe ||
    !state.aiSettings
  )
    return null;
  return {
    researchPosture: state.researchPosture,
    rules: state.rules,
    riskConfig: state.riskConfig,
    timeframe: state.timeframe,
    aiSettings: state.aiSettings,
  };
}
