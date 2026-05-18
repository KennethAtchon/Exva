import { create } from "zustand";
import {
  buildTradeRulesMarkdown,
  validateSessionStrategyContext,
} from "../../electron/shared/domain";
import {
  RISK_PRESETS,
  TIMEFRAME_PRESETS,
  RESEARCH_POSTURE_PRESETS,
  TRADE_RULE_PRESETS,
} from "../../electron/shared/presets";
import type { GlobalStrategyPreset } from "../../electron/shared/presets";

const RESEARCH_POSTURE_PRESETS_MAP = Object.fromEntries(RESEARCH_POSTURE_PRESETS.map((p) => [p.id, p]));
const TRADE_RULE_PRESETS_MAP = Object.fromEntries(TRADE_RULE_PRESETS.map((p) => [p.id, p]));
import { api, type StrategyGetResponse, type UserGlobalPresetRow } from "@/lib/exva";
import type {
  SessionResearchPosture,
  SessionRiskConfig,
  SessionStrategyContext,
  SessionTradeRules,
  SessionTimeframeConfig,
} from "@/lib/types";

type StrategyPageState = "no_session" | "editable" | "locked";
type StrategySectionTab = "style" | "rules" | "risk" | "timeframe";

interface StrategyStoreState {
  researchPosture: SessionResearchPosture | null;
  rules: SessionTradeRules | null;
  riskConfig: SessionRiskConfig | null;
  timeframe: SessionTimeframeConfig | null;
  providers: StrategyGetResponse["providers"];
  selectorSettings: StrategyGetResponse["selectorSettings"] | null;
  selectionMode: StrategyGetResponse["selectionMode"] | null;
  defaultSearchProviderId: string | null;
  workspaceDefaultSearchProviderId: string | null;
  workspaceDefaultModelProviderKey: string;
  workspaceDefaultModelModelId: string;
  globalPresets: UserGlobalPresetRow[];
  dirtyFields: Set<string>;
  activeSection: StrategySectionTab;
  strategyErrors: string[];
  isSaving: boolean;
  isLocked: boolean;
  state: StrategyPageState;
  loadStrategy: (sessionId: string) => Promise<void>;
  loadGlobalPresets: () => Promise<void>;
  updateResearchPosture: (patch: Partial<SessionResearchPosture>) => void;
  updateRules: (patch: Partial<SessionTradeRules>) => void;
  updateRiskConfig: (patch: Partial<SessionRiskConfig>) => void;
  updateTimeframe: (patch: Partial<SessionTimeframeConfig>) => void;
  applyGlobalPreset: (preset: GlobalStrategyPreset) => void;
  saveAll: (sessionId: string) => Promise<void>;
  setActiveSection: (section: StrategySectionTab) => void;
}

export const useStrategyStore = create<StrategyStoreState>((set, get) => ({
  researchPosture: null,
  rules: null,
  riskConfig: null,
  timeframe: null,
  providers: [],
  selectorSettings: null,
  selectionMode: null,
  defaultSearchProviderId: null,
  workspaceDefaultSearchProviderId: null,
  workspaceDefaultModelProviderKey: "",
  workspaceDefaultModelModelId: "",
  globalPresets: [],
  dirtyFields: new Set(),
  activeSection: "style",
  strategyErrors: [],
  isSaving: false,
  isLocked: false,
  state: "no_session",
  loadStrategy: async (sessionId) => {
    const result = await api.getStrategy(sessionId);
    const globalPresetsResult = await api.listGlobalPresets();

    set({
      researchPosture: result.researchPosture,
      rules: result.rules,
      riskConfig: result.riskConfig,
      timeframe: result.timeframe,
      providers: result.providers,
      selectorSettings: result.selectorSettings,
      selectionMode: result.selectionMode,
      defaultSearchProviderId: result.defaultSearchProviderId,
      workspaceDefaultSearchProviderId: result.workspaceDefaultSearchProviderId,
      workspaceDefaultModelProviderKey: result.workspaceDefaultModelProviderKey,
      workspaceDefaultModelModelId: result.workspaceDefaultModelModelId,
      globalPresets: globalPresetsResult.presets,
      dirtyFields: new Set(),
      activeSection: "style",
      strategyErrors: [],
      isSaving: false,
      isLocked: result.sessionStatus === "active" || result.sessionStatus === "paused",
      state: result.sessionStatus === "active" || result.sessionStatus === "paused" ? "locked" : "editable",
    });
  },
  loadGlobalPresets: async () => {
    const result = await api.listGlobalPresets();
    set({ globalPresets: result.presets });
  },
  updateResearchPosture: (patch) => {
    const researchPosture = get().researchPosture;
    if (!researchPosture) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch)) dirtyFields.add(`researchPosture.${key}`);
    set({ researchPosture: { ...researchPosture, ...patch }, dirtyFields, strategyErrors: [] });
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
    set({ riskConfig: { ...riskConfig, ...patch }, dirtyFields, strategyErrors: [] });
  },
  updateTimeframe: (patch: Partial<SessionTimeframeConfig>) => {
    const timeframe = get().timeframe;
    if (!timeframe) return;
    const dirtyFields = new Set(get().dirtyFields);
    for (const key of Object.keys(patch)) dirtyFields.add(`timeframe.${key}`);
    set({ timeframe: { ...timeframe, ...patch }, dirtyFields, strategyErrors: [] });
  },
  applyGlobalPreset: (preset) => {
    const { researchPosture, rules, riskConfig, timeframe } = get();
    if (!researchPosture || !rules || !riskConfig || !timeframe) return;

    const stylePreset = RESEARCH_POSTURE_PRESETS_MAP[preset.posturePresetId];
    const rulesPreset = TRADE_RULE_PRESETS_MAP[preset.rulesPresetId];
    const riskPreset = RISK_PRESETS.find((p) => p.id === preset.riskPresetId);
    const timeframePreset = TIMEFRAME_PRESETS.find((p) => p.id === preset.timeframePresetId);

    const dirtyFields = new Set(get().dirtyFields);

    if (stylePreset) {
      for (const key of Object.keys(stylePreset.posture)) dirtyFields.add(`researchPosture.${key}`);
      set({ researchPosture: { ...researchPosture, ...stylePreset.posture } });
    }
    if (rulesPreset) {
      for (const key of Object.keys(rulesPreset.rules)) dirtyFields.add(`rules.${key}`);
      set({ rules: { ...rules, ...rulesPreset.rules } });
    }
    if (riskPreset) {
      dirtyFields.add("riskConfig.riskPresetId");
      for (const key of Object.keys(riskPreset.values)) dirtyFields.add(`riskConfig.${key}`);
      set({ riskConfig: { ...riskConfig, riskPresetId: riskPreset.id, ...riskPreset.values } });
    }
    if (timeframePreset) {
      dirtyFields.add("timeframe.timeframePresetId");
      for (const key of Object.keys(timeframePreset.values)) dirtyFields.add(`timeframe.${key}`);
      set({ timeframe: { ...timeframe, timeframePresetId: timeframePreset.id, ...timeframePreset.values } });
    }

    set({ dirtyFields, strategyErrors: [] });
  },
  saveAll: async (sessionId) => {
    const context = currentContext(get());
    if (!context) return;

    const rulesWithMarkdown = {
      ...context.rules,
      tradeRulesMarkdown: buildTradeRulesMarkdown(context.rules),
    };

    try {
      validateSessionStrategyContext(
        { ...context, rules: rulesWithMarkdown },
        { hasSearchProvider: Boolean(get().defaultSearchProviderId || get().workspaceDefaultSearchProviderId) },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid strategy configuration.";
      set({ strategyErrors: [message] });
      return;
    }

    set({ isSaving: true, strategyErrors: [] });
    try {
      await api.saveStrategyResearchPosture({ sessionId, researchPosture: context.researchPosture });
      await api.saveTradeRules({ sessionId, rules: rulesWithMarkdown });
      await api.saveStrategyRiskConfig({ sessionId, riskConfig: context.riskConfig });
      await api.saveStrategyTimeframeConfig({ sessionId, timeframe: context.timeframe });
      set({
        rules: rulesWithMarkdown,
        dirtyFields: new Set(),
        strategyErrors: [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save strategy configuration.";
      set({ strategyErrors: [message] });
    } finally {
      set({ isSaving: false });
    }
  },
  setActiveSection: (section) => set({ activeSection: section }),
}));

function currentContext(state: StrategyStoreState): SessionStrategyContext | null {
  if (!state.researchPosture || !state.rules || !state.riskConfig || !state.timeframe) return null;
  return {
    researchPosture: state.researchPosture,
    rules: state.rules,
    riskConfig: state.riskConfig,
    timeframe: state.timeframe,
  };
}
