import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card, SectionTitle, ShadcnSelect } from "@/components/custom-ui";
import {
  HelpTooltip,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { WorkspaceContextChip } from "@/components/WorkspaceContextChip";
import { AiPhasesSection } from "@/components/strategy/AiPhasesSection";
import { CostSummaryCard } from "@/components/strategy/CostSummaryCard";
import { TimeframeHorizonCard } from "@/components/strategy/TimeframeHorizonCard";
import {
  GlobalPresetGrid,
  CreateEditGlobalPresetModal,
  type UserGlobalPresetInput,
} from "@/components/strategy/GlobalPresetComponents";
import { ConfigHistoryDrawer } from "@/components/strategy/ConfigHistoryDrawer";
import { api } from "@/lib/exva";
import { assembleFullPresetDocFromSectionIds } from "@/lib/strategy-config-ui";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/sessionStore";
import type { SessionStatus } from "@/lib/types";
import type { HelpGlossaryId } from "@/lib/help-glossary";
import { useStrategyStore } from "@/store/strategyStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import {
  buildTradeRulesMarkdown,
  buildResearchPostureMarkdown,
  STOP_LOSS_TYPES,
  SETUP_TYPES,
  STRATEGY_ENTRY_STYLES,
  STRATEGY_EXIT_STYLES,
  STRATEGY_SCALING_MODES,
  STRATEGY_SIDE_BIASES,
  RESEARCH_CATALYST_MODES,
  RESEARCH_EVIDENCE_MODES,
  RESEARCH_FUNDAMENTAL_STRICTNESS,
  type SessionAiSettings,
  type SessionResearchPosture,
  type SessionTradeRules,
  type SessionRiskConfig,
  type SessionTimeframeConfig,
  type ResearchPosturePreset,
  type TradeRulesPreset,
} from "@electron/shared/domain";
import {
  TRADE_RULE_PRESETS,
  RISK_PRESETS,
  TIMEFRAME_PRESETS,
  RESEARCH_POSTURE_PRESETS,
} from "@electron/shared/presets";
import type { GlobalStrategyPreset } from "@electron/shared/presets";
import type { UserGlobalPresetRow } from "@/lib/exva";

const TABS = [
  ["style", "Style"],
  ["rules", "Rules"],
  ["risk", "Risk"],
  ["timeframe", "Timeframe"],
  ["ai", "AI Phases"],
];

type SectionId = "style" | "rules" | "risk" | "timeframe" | "ai";

// ─── Sub-components ──────────────────────────────────────────────────────────

const LockedWarning = ({
  sessionStatus,
  focusedSessionId,
  focusedOpenTradeCount,
  setSessionStatus,
  loadStrategy,
}: {
  sessionStatus: SessionStatus;
  focusedSessionId: string;
  focusedOpenTradeCount: number;
  setSessionStatus: (status: SessionStatus) => void;
  loadStrategy: (id: string) => Promise<void>;
}) => (
  <div className={warningClass}>
    <div>
      {sessionStatus === "monitoring_only"
        ? "Session is stopping when flat — open positions remain managed until the last trade closes."
        : "Stop this session before editing its strategy or AI configuration."}
      {sessionStatus !== "monitoring_only" && focusedOpenTradeCount > 0
        ? " Open positions are active — use Stop when flat to drain safely, or Force stop to edit anyway."
        : null}
    </div>
    <div className="flex flex-wrap gap-2">
      {(sessionStatus === "active" || sessionStatus === "paused") &&
      focusedOpenTradeCount > 0 ? (
        <div className="flex items-center gap-1">
          <button
            onClick={async () => {
              const next = await api.stopSession();
              setSessionStatus(next);
              await loadStrategy(focusedSessionId);
            }}
            className={warningDrainButtonClass}
          >
            Stop when flat
          </button>
          <HelpTooltip
            topic="Stop when flat"
            body="Stops new research immediately and completes shutdown once all open trades close."
          />
        </div>
      ) : null}
      {sessionStatus === "monitoring_only" || focusedOpenTradeCount > 0 ? (
        <button
          onClick={async () => {
            if (
              !window.confirm(
                "Force stop will end automated exit management for open positions. Continue?",
              )
            ) {
              return;
            }
            const next = await api.forceStopSession();
            setSessionStatus(next);
            await loadStrategy(focusedSessionId);
          }}
          className={warningForceStopButtonClass}
        >
          Force Stop Session
        </button>
      ) : (
        <button
          onClick={async () => {
            const next = await api.stopSession();
            setSessionStatus(next);
            await loadStrategy(focusedSessionId);
          }}
          className={warningButtonClass}
        >
          Stop Session
        </button>
      )}
    </div>
  </div>
);

const StrategyHeader = ({
  activeView,
  setActiveView,
  saveState,
  focusedSessionId,
  saveAll,
  onOpenHistory,
}: {
  activeView: "presets" | "customize";
  setActiveView: (view: "presets" | "customize") => void;
  saveState: "locked" | "clean" | "dirty" | "saving";
  focusedSessionId: string;
  saveAll: (id: string) => Promise<void>;
  onOpenHistory: () => void;
}) => {
  const isSaving = saveState === "saving";
  const canSave = saveState === "dirty";
  const showActiveSaveStyle = saveState === "dirty" || saveState === "saving";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="m-0 text-[22px] text-[var(--text1)]">Strategy</h1>
        <p className="m-0 mt-1 text-[13px] text-[var(--text3)]">
          One versioned strategy document per session: research posture, trade
          rules, risk, timeframe, and AI phase settings.
        </p>
        <div className="mt-2">
          <HelpTooltip
            topic="Strategy page"
            body="Strategy is session-scoped and saved as one document with optimistic concurrency. Active and paused sessions are read-only here so runtime behavior cannot change mid-cycle."
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className={viewToggleContainerClass}>
          <button
            type="button"
            onClick={() => setActiveView("presets")}
            className={
              activeView === "presets"
                ? viewToggleActiveClass
                : viewToggleInactiveClass
            }
          >
            Presets
          </button>
          <HelpTooltip
            topic="Presets view"
            body="Presets apply bundled style, rules, risk, and timeframe combinations in one step from the config_presets catalog."
          />
          <button
            type="button"
            onClick={() => setActiveView("customize")}
            className={
              activeView === "customize"
                ? viewToggleActiveClass
                : viewToggleInactiveClass
            }
          >
            Customize
          </button>
          <HelpTooltip
            topic="Customize view"
            body="Customize lets you edit each strategy section directly instead of applying a full preset."
          />
        </div>
        <button
          type="button"
          onClick={onOpenHistory}
          className={historyButtonClass}
        >
          Config history
        </button>
        <HelpTooltip glossaryId="strategy-config-history" />
        <button
          onClick={() => void saveAll(focusedSessionId)}
          disabled={!canSave}
          className={cn(
            "rounded-[9px] border-none px-[18px] py-[9px] font-bold",
            showActiveSaveStyle
              ? "bg-[var(--accent)] text-[hsl(var(--primary-foreground))]"
              : "bg-[var(--surface3)] text-[var(--text3)]",
            canSave ? "cursor-pointer" : "cursor-not-allowed",
          )}
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
};

const PresetPanel = ({
  builtInGlobalPresets,
  userGlobalPresets,
  researchPosture,
  rules,
  riskConfig,
  timeframe,
  isLocked,
  applyGlobalPreset,
  loadGlobalPresets,
  setCreateModalOpen,
  setEditingPreset,
}: {
  builtInGlobalPresets: GlobalStrategyPreset[];
  userGlobalPresets: UserGlobalPresetRow[];
  researchPosture: SessionResearchPosture;
  rules: SessionTradeRules;
  riskConfig: SessionRiskConfig;
  timeframe: SessionTimeframeConfig;
  isLocked: boolean;
  applyGlobalPreset: (preset: GlobalStrategyPreset) => void;
  loadGlobalPresets: () => Promise<void>;
  setCreateModalOpen: (open: boolean) => void;
  setEditingPreset: (
    preset: (UserGlobalPresetInput & { id: string }) | null,
  ) => void;
}) => (
  <GlobalPresetGrid
    builtInPresets={builtInGlobalPresets}
    userPresets={userGlobalPresets}
    currentPosturePresetId={researchPosture.posturePresetId}
    currentRulesPresetId={rules.rulesPresetId}
    currentRiskPresetId={riskConfig.riskPresetId ?? "custom"}
    currentTimeframePresetId={timeframe.timeframePresetId ?? "custom"}
    disabled={isLocked}
    onApply={(preset) => applyGlobalPreset(preset)}
    onCreatePreset={() => setCreateModalOpen(true)}
    onEditPreset={(p) => {
      const j = JSON.parse(p.presetJson) as Partial<UserGlobalPresetInput>;
      setEditingPreset({
        id: p.id,
        name: p.name,
        posturePresetId: j.posturePresetId ?? "custom",
        rulesPresetId: j.rulesPresetId ?? "custom",
        riskPresetId: j.riskPresetId ?? "custom",
        timeframePresetId: j.timeframePresetId ?? "custom",
      });
    }}
    onDeletePreset={async (id) => {
      if (!window.confirm("Delete this preset?")) return;
      await api.deleteStrategyConfigPreset({ id });
      await loadGlobalPresets();
    }}
  />
);

export const StrategyConfig = ({
  onGoToSessions,
}: {
  onGoToSessions?: () => void;
}) => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const environmentMode = useWorkspaceStore((state) => state.environmentMode);
  const setViewMode = useWorkspaceStore((state) => state.setViewMode);
  const loadWorkspaceView = useWorkspaceStore(
    (state) => state.loadWorkspaceView,
  );
  const setSessionStatus = useSessionStore((state) => state.setStatus);
  const sessionStatus = useSessionStore((state) => state.status);

  const researchPosture = useStrategyStore((state) => state.researchPosture);
  const rules = useStrategyStore((state) => state.rules);
  const riskConfig = useStrategyStore((state) => state.riskConfig);
  const timeframe = useStrategyStore((state) => state.timeframe);
  const aiSettings = useStrategyStore((state) => state.aiSettings);
  const dirtyFields = useStrategyStore((state) => state.dirtyFields);
  const activeSection = useStrategyStore((state) => state.activeSection);
  const isSaving = useStrategyStore((state) => state.isSaving);
  const pageState = useStrategyStore((state) => state.state);
  const strategyErrors = useStrategyStore((state) => state.strategyErrors);
  const globalPresets = useStrategyStore((state) => state.globalPresets);
  const providers = useStrategyStore((state) => state.providers);
  const aiPhases = useStrategyStore((state) => state.aiPhases);
  const loadStrategy = useStrategyStore((state) => state.loadStrategy);
  const resetForEnvironmentChange = useStrategyStore(
    (state) => state.resetForEnvironmentChange,
  );
  const loadGlobalPresets = useStrategyStore(
    (state) => state.loadGlobalPresets,
  );
  const updateResearchPosture = useStrategyStore(
    (state) => state.updateResearchPosture,
  );
  const updateRules = useStrategyStore((state) => state.updateRules);
  const updateRiskConfig = useStrategyStore((state) => state.updateRiskConfig);
  const updateTimeframe = useStrategyStore((state) => state.updateTimeframe);
  const updateAiSettings = useStrategyStore((state) => state.updateAiSettings);
  const updateAiPhase = useStrategyStore((state) => state.updateAiPhase);
  const applyGlobalPreset = useStrategyStore(
    (state) => state.applyGlobalPreset,
  );
  const applyConfigRecord = useStrategyStore(
    (state) => state.applyConfigRecord,
  );
  const saveAll = useStrategyStore((state) => state.saveAll);
  const setActiveSection = useStrategyStore((state) => state.setActiveSection);
  const configVersion = useStrategyStore((state) => state.configVersion);

  const [activeView, setActiveView] = useState<"presets" | "customize">(
    "presets",
  );
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusedOpenTradeCount, setFocusedOpenTradeCount] = useState(0);
  const [sessionCapitalUsd, setSessionCapitalUsd] = useState(0);
  const [editingPreset, setEditingPreset] = useState<
    (UserGlobalPresetInput & { id: string }) | null
  >(null);

  useEffect(() => {
    resetForEnvironmentChange();
    if (viewMode !== "session" || !focusedSessionId) return;
    void loadStrategy(focusedSessionId);
  }, [
    focusedSessionId,
    loadStrategy,
    resetForEnvironmentChange,
    viewMode,
    environmentMode,
  ]);

  useEffect(() => {
    if (viewMode !== "session" || !focusedSessionId) {
      setFocusedOpenTradeCount(0);
      setSessionCapitalUsd(0);
      return;
    }
    void (async () => {
      let nextCount = 0;
      let nextCapital = 0;
      try {
        const result = await api.listSessions({ includeArchived: false });
        const focused = result.sessions.find(
          (session) => session.id === focusedSessionId,
        );
        nextCount = focused?.openTradeCount ?? 0;
        nextCapital = focused?.totalAllocatedUsd ?? 0;
      } catch {
        nextCount = 0;
        nextCapital = 0;
      }
      setFocusedOpenTradeCount(nextCount);
      setSessionCapitalUsd(nextCapital);
    })();
  }, [focusedSessionId, viewMode, environmentMode]);

  const builtInGlobalPresets = globalPresets.reduce<GlobalStrategyPreset[]>(
    (acc, preset) => {
      if (preset.isBuiltIn) {
        acc.push(JSON.parse(preset.presetJson) as GlobalStrategyPreset);
      }
      return acc;
    },
    [],
  );
  const userGlobalPresets = globalPresets.filter((p) => !p.isBuiltIn);

  const isLocked = pageState === "locked";
  const hasDirty = dirtyFields.size > 0;

  // Auto-save: fires 1.5s after the last change
  const saveAllRef = useRef(saveAll);
  saveAllRef.current = saveAll;
  const focusedSessionIdRef = useRef(focusedSessionId);
  focusedSessionIdRef.current = focusedSessionId;
  useEffect(() => {
    if (!hasDirty || isSaving || isLocked || !focusedSessionId) return;
    const t = setTimeout(() => {
      if (focusedSessionIdRef.current)
        void saveAllRef.current(focusedSessionIdRef.current);
    }, 1500);
    return () => clearTimeout(t);
    // dirtyFields ref changes every update → correct debounce reset
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyFields, isSaving, isLocked, focusedSessionId]);

  if (viewMode === "global" || !focusedSessionId) {
    return (
      <div className="hub-panel-body flex flex-col gap-5">
        <Header
          loadWorkspaceView={loadWorkspaceView}
          setViewMode={setViewMode}
        />
        <div className={emptyStateClass}>
          <div className="mb-4 text-[32px]">⚙</div>
          <div className="mb-2 text-[16px] font-bold text-[var(--text1)]">
            No session focused
          </div>
          <div className="mb-2 flex justify-center">
            <HelpTooltip glossaryId="focus-session" />
          </div>
          <p className="mx-auto mb-5 max-w-[380px] text-[13px] leading-[1.65] text-[var(--text2)]">
            Strategy configuration is session-scoped. You need to focus a
            session first, then come back here to configure AI phases, risk
            limits, and strategy behavior.
          </p>
          <div className={stepListClass}>
            <Step n={1} text="Go to Sessions" />
            <Step n={2} text="Find the session you want to configure" />
            <Step n={3} text='Click "Focus" on that session' />
            <Step n={4} text="Return here to configure strategy" />
          </div>
          {onGoToSessions && (
            <button
              type="button"
              onClick={onGoToSessions}
              className={goToSessionsButtonClass}
            >
              Go to Sessions →
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!researchPosture || !rules || !riskConfig || !timeframe || !aiSettings) {
    return (
      <div className="hub-panel-body flex flex-col gap-5">
        <div className="text-[var(--text3)]">Loading strategy…</div>
      </div>
    );
  }

  const stylePreview = buildResearchPostureMarkdown(researchPosture);
  const rulesPreview = buildTradeRulesMarkdown(rules);
  const selectedStylePreset =
    RESEARCH_POSTURE_PRESETS.find(
      (preset) => preset.id === researchPosture.posturePresetId,
    ) ?? RESEARCH_POSTURE_PRESETS[RESEARCH_POSTURE_PRESETS.length - 1];
  const selectedRulesPreset =
    TRADE_RULE_PRESETS.find((preset) => preset.id === rules.rulesPresetId) ??
    TRADE_RULE_PRESETS[TRADE_RULE_PRESETS.length - 1];
  const activeGlobalPreset = resolveActiveGlobalPreset({
    builtInPresets: builtInGlobalPresets,
    userPresets: userGlobalPresets,
    posturePresetId: researchPosture.posturePresetId,
    rulesPresetId: rules.rulesPresetId,
    riskPresetId: riskConfig.riskPresetId ?? "custom",
    timeframePresetId: timeframe.timeframePresetId ?? "custom",
  });
  return renderStrategyConfigMainView({
    loadWorkspaceView,
    setViewMode,
    strategyErrors,
    isLocked,
    sessionStatus,
    focusedSessionId,
    focusedOpenTradeCount,
    setSessionStatus,
    loadStrategy,
    sessionCapitalUsd,
    activeView,
    setActiveView,
    hasDirty,
    isSaving,
    saveAll,
    activeGlobalPreset,
    builtInGlobalPresets,
    userGlobalPresets,
    researchPosture,
    rules,
    riskConfig,
    timeframe,
    applyGlobalPreset: (preset) => {
      void applyGlobalPreset(focusedSessionId, preset);
    },
    loadGlobalPresets,
    setCreateModalOpen,
    setEditingPreset,
    activeSection,
    setActiveSection,
    aiSettings,
    updateResearchPosture,
    updateAiSettings,
    selectedStylePreset,
    stylePreview,
    updateRules,
    selectedRulesPreset,
    rulesPreview,
    updateRiskConfig,
    updateTimeframe,
    aiPhases,
    providers,
    updateAiPhase,
    createModalOpen,
    editingPreset,
    historyOpen,
    setHistoryOpen,
    configVersion,
    applyConfigRecord,
  });
};

type StrategyConfigMainViewArgs = {
  loadWorkspaceView: () => Promise<void>;
  setViewMode: (
    mode: "session" | "global",
    focusedSessionId?: string | null,
  ) => void;
  strategyErrors: string[];
  isLocked: boolean;
  sessionStatus: SessionStatus;
  focusedSessionId: string;
  focusedOpenTradeCount: number;
  setSessionStatus: (status: SessionStatus) => void;
  loadStrategy: (id: string) => Promise<void>;
  sessionCapitalUsd: number;
  activeView: "presets" | "customize";
  setActiveView: (view: "presets" | "customize") => void;
  hasDirty: boolean;
  isSaving: boolean;
  saveAll: (sessionId: string) => Promise<void>;
  activeGlobalPreset: {
    preset: GlobalStrategyPreset;
    source: "built_in" | "user";
  } | null;
  builtInGlobalPresets: GlobalStrategyPreset[];
  userGlobalPresets: UserGlobalPresetRow[];
  researchPosture: SessionResearchPosture;
  rules: SessionTradeRules;
  riskConfig: SessionRiskConfig;
  timeframe: SessionTimeframeConfig;
  applyGlobalPreset: (preset: GlobalStrategyPreset) => void;
  loadGlobalPresets: () => Promise<void>;
  setCreateModalOpen: (open: boolean) => void;
  setEditingPreset: (
    preset: (UserGlobalPresetInput & { id: string }) | null,
  ) => void;
  activeSection: SectionId;
  setActiveSection: (section: SectionId) => void;
  aiSettings: SessionAiSettings;
  updateResearchPosture: (patch: Partial<SessionResearchPosture>) => void;
  updateAiSettings: (patch: Partial<SessionAiSettings>) => void;
  selectedStylePreset: ResearchPosturePreset;
  stylePreview: string;
  updateRules: (patch: Partial<SessionTradeRules>) => void;
  selectedRulesPreset: TradeRulesPreset;
  rulesPreview: string;
  updateRiskConfig: (patch: Partial<SessionRiskConfig>) => void;
  updateTimeframe: (patch: Partial<SessionTimeframeConfig>) => void;
  aiPhases: ReturnType<typeof useStrategyStore.getState>["aiPhases"];
  providers: ReturnType<typeof useStrategyStore.getState>["providers"];
  updateAiPhase: ReturnType<typeof useStrategyStore.getState>["updateAiPhase"];
  createModalOpen: boolean;
  editingPreset: (UserGlobalPresetInput & { id: string }) | null;
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  configVersion: number | null;
  applyConfigRecord: (
    sessionId: string,
    record: {
      version: number;
      schemaVersion: number;
      doc: import("@electron/shared/domain/session-strategy-config").SessionStrategyConfigDoc;
      updatedAt: string;
    },
  ) => void;
};

const renderStrategyConfigMainView = ({
  loadWorkspaceView,
  setViewMode,
  strategyErrors,
  isLocked,
  sessionStatus,
  focusedSessionId,
  focusedOpenTradeCount,
  setSessionStatus,
  loadStrategy,
  sessionCapitalUsd,
  activeView,
  setActiveView,
  hasDirty,
  isSaving,
  saveAll,
  activeGlobalPreset,
  builtInGlobalPresets,
  userGlobalPresets,
  researchPosture,
  rules,
  riskConfig,
  timeframe,
  applyGlobalPreset,
  loadGlobalPresets,
  setCreateModalOpen,
  setEditingPreset,
  activeSection,
  setActiveSection,
  aiSettings,
  updateResearchPosture,
  updateAiSettings,
  selectedStylePreset,
  stylePreview,
  updateRules,
  selectedRulesPreset,
  rulesPreview,
  updateRiskConfig,
  updateTimeframe,
  aiPhases,
  providers,
  updateAiPhase,
  createModalOpen,
  editingPreset,
  historyOpen,
  setHistoryOpen,
  configVersion,
  applyConfigRecord,
}: StrategyConfigMainViewArgs) => (
  <div className="hub-panel-body flex flex-col gap-5">
    <Header loadWorkspaceView={loadWorkspaceView} setViewMode={setViewMode} />

    {strategyErrors.length > 0 && (
      <div className={cn(warningClass, "mb-3 border-error-border text-error")}>
        {strategyErrors.map((message) => (
          <div key={message}>{message}</div>
        ))}
      </div>
    )}

    {isLocked && (
      <LockedWarning
        sessionStatus={sessionStatus}
        focusedSessionId={focusedSessionId}
        focusedOpenTradeCount={focusedOpenTradeCount}
        setSessionStatus={setSessionStatus}
        loadStrategy={loadStrategy}
      />
    )}

    <StrategyHeader
      activeView={activeView}
      setActiveView={setActiveView}
      saveState={
        isSaving ? "saving" : isLocked ? "locked" : hasDirty ? "dirty" : "clean"
      }
      focusedSessionId={focusedSessionId}
      saveAll={saveAll}
      onOpenHistory={() => setHistoryOpen(true)}
    />

    <ActiveGlobalPresetIndicator preset={activeGlobalPreset} />

    {activeView === "presets" && (
      <PresetPanel
        builtInGlobalPresets={builtInGlobalPresets}
        userGlobalPresets={userGlobalPresets}
        researchPosture={researchPosture}
        rules={rules}
        riskConfig={riskConfig}
        timeframe={timeframe}
        isLocked={isLocked}
        applyGlobalPreset={applyGlobalPreset}
        loadGlobalPresets={loadGlobalPresets}
        setCreateModalOpen={setCreateModalOpen}
        setEditingPreset={setEditingPreset}
      />
    )}

    {activeView === "customize" && (
      <Tabs
        value={activeSection}
        onValueChange={(v) => setActiveSection(v as SectionId)}
      >
        <TabsList>
          {TABS.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          <div className="flex flex-col gap-4">
            {TABS.map(([value]) => (
              <TabsContent key={value} value={value}>
                {value === "style" && (
                  <StyleSection
                    researchPosture={researchPosture}
                    aiSettings={aiSettings}
                    isLocked={isLocked}
                    updateResearchPosture={updateResearchPosture}
                    updateAiSettings={updateAiSettings}
                    selectedStylePreset={selectedStylePreset}
                    stylePreview={stylePreview}
                  />
                )}
                {value === "rules" && (
                  <RulesSection
                    rules={rules}
                    isLocked={isLocked}
                    updateRules={updateRules}
                    selectedRulesPreset={selectedRulesPreset}
                    rulesPreview={rulesPreview}
                  />
                )}
                {value === "risk" && (
                  <RiskSection
                    riskConfig={riskConfig}
                    isLocked={isLocked}
                    updateRiskConfig={updateRiskConfig}
                    sessionCapitalUsd={sessionCapitalUsd}
                  />
                )}
                {value === "timeframe" && (
                  <TimeframeSection
                    timeframe={timeframe}
                    isLocked={isLocked}
                    updateTimeframe={updateTimeframe}
                  />
                )}
                {value === "ai" && (
                  <AiPhasesSection
                    aiPhases={aiPhases}
                    providers={providers}
                    isLocked={isLocked}
                    onUpdatePhase={updateAiPhase}
                  />
                )}
              </TabsContent>
            ))}
          </div>

          <div className="flex flex-col gap-4">
            <CostSummaryCard riskConfig={riskConfig} />
          </div>
        </div>
      </Tabs>
    )}

    <CreateEditGlobalPresetModal
      open={createModalOpen}
      onSave={async (input) => {
        await api.saveStrategyConfigPreset({
          name: input.name,
          kind: "full",
          doc: assembleFullPresetDocFromSectionIds(input) as unknown as Record<
            string,
            unknown
          >,
        });
        await loadGlobalPresets();
        setCreateModalOpen(false);
      }}
      onClose={() => setCreateModalOpen(false)}
    />

    <CreateEditGlobalPresetModal
      open={!!editingPreset}
      initial={editingPreset ?? undefined}
      onSave={async (input) => {
        if (!editingPreset) return;
        await api.saveStrategyConfigPreset({
          id: editingPreset.id,
          name: input.name,
          kind: "full",
          doc: assembleFullPresetDocFromSectionIds(input) as unknown as Record<
            string,
            unknown
          >,
        });
        await loadGlobalPresets();
        setEditingPreset(null);
      }}
      onClose={() => setEditingPreset(null)}
    />

    <ConfigHistoryDrawer
      open={historyOpen}
      sessionId={focusedSessionId}
      currentVersion={configVersion}
      isLocked={isLocked}
      onClose={() => setHistoryOpen(false)}
      onRolledBack={(record) => {
        applyConfigRecord(focusedSessionId, record);
      }}
    />
  </div>
);

const Header = ({
  loadWorkspaceView,
  setViewMode,
}: {
  loadWorkspaceView: () => Promise<void>;
  setViewMode: (
    mode: "session" | "global",
    focusedSessionId?: string | null,
  ) => void;
}) => (
  <div className="flex items-center justify-between">
    <div />
    <WorkspaceContextChip
      onSwitchSession={async (id) => {
        await api.focusSession(id);
        await loadWorkspaceView();
      }}
      onGoGlobal={async () => {
        await api.goGlobal();
        setViewMode("global", null);
      }}
    />
  </div>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid gap-1.5">
    <div className="text-[12px] text-[var(--text3)]">{label}</div>
    {children}
  </div>
);

const PresetSummaryCard = ({
  presetLabel,
  thesis,
  bullets,
}: {
  presetLabel: string;
  thesis: string;
  bullets: string[];
}) => (
  <div className={presetSummaryClass}>
    <div className={presetBadgeClass}>{presetLabel}</div>
    <div className={presetThesisClass}>{thesis}</div>
    <div className="grid gap-2">
      {bullets.map((bullet) => (
        <div key={bullet} className={presetBulletClass}>
          {bullet}
        </div>
      ))}
    </div>
  </div>
);

const ActiveGlobalPresetIndicator = ({
  preset,
}: {
  preset: { preset: GlobalStrategyPreset; source: "built_in" | "user" } | null;
}) => (
  <div className={activeGlobalPresetClass}>
    <div className="grid gap-1">
      <div className={activeGlobalPresetEyebrowClass}>Active Global Preset</div>
      <div className="flex flex-wrap items-center gap-2">
        <div className={activeGlobalPresetLabelClass}>
          {preset?.preset.label ?? "Custom"}
        </div>
        <div className={activeGlobalPresetSourceClass(preset?.source)}>
          {preset
            ? preset.source === "built_in"
              ? "Built-in"
              : "Saved preset"
            : "No exact preset match"}
        </div>
      </div>
      <div className={activeGlobalPresetDescriptionClass}>
        {preset?.preset.description ??
          "Current style, rules, risk, and timeframe selections do not match a saved global preset."}
      </div>
    </div>
  </div>
);

function resolveActiveGlobalPreset({
  builtInPresets,
  userPresets,
  posturePresetId,
  rulesPresetId,
  riskPresetId,
  timeframePresetId,
}: {
  builtInPresets: GlobalStrategyPreset[];
  userPresets: UserGlobalPresetRow[];
  posturePresetId: string;
  rulesPresetId: string;
  riskPresetId: string;
  timeframePresetId: string;
}): { preset: GlobalStrategyPreset; source: "built_in" | "user" } | null {
  const matches = (preset: GlobalStrategyPreset) =>
    preset.posturePresetId === posturePresetId &&
    preset.rulesPresetId === rulesPresetId &&
    preset.riskPresetId === riskPresetId &&
    preset.timeframePresetId === timeframePresetId;

  const builtInMatch = builtInPresets.find(matches);
  if (builtInMatch) {
    return { preset: builtInMatch, source: "built_in" };
  }

  for (const row of userPresets) {
    try {
      const parsed = {
        id: row.id,
        label: row.name,
        ...(JSON.parse(row.presetJson) as Omit<
          GlobalStrategyPreset,
          "id" | "label"
        >),
      };
      if (matches(parsed)) {
        return { preset: parsed, source: "user" };
      }
    } catch {
      // Ignore malformed user presets and keep resolving the next match.
    }
  }

  return null;
}

function labelize(value: string): string {
  return value
    .split("_")
    .reduce<string[]>((parts, part) => {
      if (part) {
        parts.push(part.charAt(0).toUpperCase() + part.slice(1));
      }
      return parts;
    }, [])
    .join(" ");
}

const Step = ({ n, text }: { n: number; text: string }) => (
  <div className="flex items-center gap-2.5">
    <div className={stepBadgeClass}>{n}</div>
    <span className="text-[13px] text-[var(--text2)]">{text}</span>
  </div>
);

const stepBadgeClass =
  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface3)] text-[12px] font-bold text-[var(--text2)]";

const emptyStateClass =
  "flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-6 py-[60px] text-center";

const stepListClass = "mb-6 grid w-full max-w-[340px] gap-2.5 text-left";

const goToSessionsButtonClass =
  "cursor-pointer rounded-[10px] border border-info-border bg-info-dim px-[22px] py-2.5 text-[13px] font-semibold text-info";

const viewToggleContainerClass =
  "flex overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface2)]";
const viewToggleActiveClass =
  "cursor-pointer border-none bg-[var(--surface3)] px-4 py-[7px] text-[13px] font-semibold text-[var(--text1)]";
const viewToggleInactiveClass =
  "cursor-pointer border-none bg-transparent px-4 py-[7px] text-[13px] font-medium text-[var(--text3)]";
const historyButtonClass =
  "cursor-pointer rounded-[9px] border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-[9px] text-[13px] font-semibold text-[var(--text2)]";
const briefClass =
  "mt-3.5 whitespace-pre-wrap rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] p-3.5 text-[12px] leading-relaxed text-[var(--text2)]";
const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-[11px] py-[9px] text-[var(--text1)]";
const textareaClass = cn(inputClass, "min-h-32 resize-y");
const warningClass =
  "flex items-center justify-between gap-3 rounded-[10px] border border-warning-border bg-warning-dim p-3 px-3.5 text-[12px] text-warning";
const warningButtonClass =
  "cursor-pointer rounded-lg border border-warning-border bg-warning-dim px-2.5 py-[7px] text-warning";
const warningDrainButtonClass =
  "cursor-pointer rounded-lg border border-status-orange-border bg-status-orange-dim px-2.5 py-[7px] text-status-orange";
const warningForceStopButtonClass =
  "cursor-pointer rounded-lg border border-error-border bg-error-dim px-2.5 py-[7px] text-error";
const activeGlobalPresetClass =
  "flex items-center justify-between gap-3 rounded-xl border border-info-border bg-[var(--surface2)] px-4 py-3.5";
const activeGlobalPresetEyebrowClass =
  "text-[12px] font-bold uppercase tracking-[0.35px] text-info";
const activeGlobalPresetLabelClass =
  "text-[16px] font-bold text-[var(--text1)]";
const activeGlobalPresetDescriptionClass =
  "text-[12px] leading-[1.55] text-[var(--text3)]";
const activeGlobalPresetSourceClass = (
  source: "built_in" | "user" | undefined,
) =>
  cn(
    "inline-flex w-fit rounded-full px-2.5 py-1 text-[12px] font-bold tracking-[0.2px]",
    source === "user"
      ? "border border-success-border bg-success-dim text-success"
      : "border border-info-border bg-info-dim text-info",
  );
const presetSummaryClass =
  "mt-3.5 grid gap-3 rounded-xl border border-info-border bg-[var(--surface2)] p-3.5";
const presetBadgeClass =
  "inline-flex w-fit rounded-full border border-info-border bg-info-dim px-2.5 py-1 text-[12px] font-bold tracking-[0.2px] text-info";
const presetThesisClass =
  "text-[13px] font-semibold leading-[1.55] text-[var(--text1)]";
const presetBulletClass = "text-[12px] leading-normal text-[var(--text3)]";

// ─── Section components ───────────────────────────────────────────────────────

const SectionHeading = ({
  title,
  glossaryId,
}: {
  title: string;
  glossaryId: HelpGlossaryId;
}) => (
  <div className="mb-0 flex items-center gap-1.5">
    <SectionTitle>{title}</SectionTitle>
    <HelpTooltip glossaryId={glossaryId} />
  </div>
);

const StyleSection = ({
  researchPosture,
  aiSettings,
  isLocked,
  updateResearchPosture,
  updateAiSettings,
  selectedStylePreset,
  stylePreview,
}: {
  researchPosture: SessionResearchPosture;
  aiSettings: SessionAiSettings;
  isLocked: boolean;
  updateResearchPosture: (patch: Partial<SessionResearchPosture>) => void;
  updateAiSettings: (patch: Partial<SessionAiSettings>) => void;
  selectedStylePreset: ResearchPosturePreset;
  stylePreview: string;
}) => (
  <div className="flex flex-col gap-4">
    <Card>
      <SectionHeading
        title="AI Instructions"
        glossaryId="strategy-style-vs-instructions"
      />
      <p className="mb-3 mt-2 text-[12px] leading-[1.55] text-[var(--text3)]">
        Optional guidance injected into every AI worker for this session.
        Structured risk limits and position caps on the Risk tab remain
        authoritative.
      </p>
      <Field label="Worker instructions">
        <textarea
          value={aiSettings.workerGuidanceMarkdown}
          onChange={(event) =>
            updateAiSettings({ workerGuidanceMarkdown: event.target.value })
          }
          disabled={isLocked}
          rows={6}
          placeholder="Example: Prefer liquid large caps. Reject stale catalysts. Keep rationales concise."
          className={textareaClass}
        />
      </Field>
    </Card>

    <Card>
      <SectionHeading title="Research posture" glossaryId="research-focus" />
      <p className="mb-1 mt-2 text-[12px] leading-[1.55] text-[var(--text3)]">
        High-level character of research. A posture preset fills these in for
        you — adjust individually only if you need a custom blend.
      </p>
      <div className="mt-4 grid gap-4">
        <SelectField
          label="Posture preset"
          help="Applies a ready-made research style. Picking one fills evidence, catalyst, and fundamentals below."
          value={researchPosture.posturePresetId}
          onChange={(value) => {
            const preset = RESEARCH_POSTURE_PRESETS.find(
              (entry) => entry.id === value,
            );
            if (!preset) return;
            updateResearchPosture(preset.posture);
          }}
          disabled={isLocked}
          options={RESEARCH_POSTURE_PRESETS.map((preset) => ({
            value: preset.id,
            label: preset.label,
          }))}
        />
        <RiskGroup
          title="Evidence & confirmation"
          help="What evidence the AI trusts, whether a catalyst is required, and how hard it checks fundamentals."
        >
          <SelectField
            label="Evidence mode"
            help="Which evidence dominates the thesis."
            value={researchPosture.evidenceMode}
            onChange={(value) =>
              updateResearchPosture({
                evidenceMode: value as typeof researchPosture.evidenceMode,
              })
            }
            disabled={isLocked}
            options={RESEARCH_EVIDENCE_MODES.map((value) => ({
              value,
              label: labelize(value),
            }))}
            hint={optionMeaning(researchPosture.evidenceMode)}
          />
          <SelectField
            label="Catalyst posture"
            help="Whether a fresh catalyst must exist before a trade is allowed."
            value={researchPosture.catalystMode}
            onChange={(value) =>
              updateResearchPosture({
                catalystMode: value as typeof researchPosture.catalystMode,
              })
            }
            disabled={isLocked}
            options={RESEARCH_CATALYST_MODES.map((value) => ({
              value,
              label: labelize(value),
            }))}
            hint={optionMeaning(researchPosture.catalystMode)}
          />
          <SelectField
            label="Fundamental strictness"
            help="How much fundamental confirmation the fundamental phase demands."
            value={researchPosture.fundamentalStrictness}
            onChange={(value) =>
              updateResearchPosture({
                fundamentalStrictness:
                  value as typeof researchPosture.fundamentalStrictness,
              })
            }
            disabled={isLocked}
            options={RESEARCH_FUNDAMENTAL_STRICTNESS.map((value) => ({
              value,
              label: labelize(value),
            }))}
            hint={optionMeaning(researchPosture.fundamentalStrictness)}
          />
        </RiskGroup>
        <Field label="Posture notes (optional)">
          <textarea
            value={researchPosture.postureNotes}
            onChange={(event) =>
              updateResearchPosture({ postureNotes: event.target.value })
            }
            disabled={isLocked}
            rows={5}
            placeholder="Describe the edge, posture, and evidence stack this session should favor."
            className={textareaClass}
          />
        </Field>
      </div>
    </Card>

    <Card>
      <SectionTitle>Selected Style Summary</SectionTitle>
      <p className="mt-2 text-[12px] leading-[1.55] text-[var(--text3)]">
        Keep style high-level here: what edge you want the AI to pursue and what
        evidence posture it should adopt.
      </p>
      <PresetSummaryCard
        presetLabel={selectedStylePreset.label}
        thesis={selectedStylePreset.thesis}
        bullets={selectedStylePreset.summaryBullets}
      />
    </Card>

    <Card>
      <SectionTitle>Live Style Guidance</SectionTitle>
      <pre className={briefClass}>{stylePreview}</pre>
    </Card>
  </div>
);

const RulesSection = ({
  rules,
  isLocked,
  updateRules,
  selectedRulesPreset,
  rulesPreview,
}: {
  rules: SessionTradeRules;
  isLocked: boolean;
  updateRules: (patch: Partial<SessionTradeRules>) => void;
  selectedRulesPreset: TradeRulesPreset;
  rulesPreview: string;
}) => (
  <div className="flex flex-col gap-4">
    <Card>
      <SectionHeading title="Trade Rules" glossaryId="strategy-trade-rules" />
      <p className="mb-1 mt-2 text-[12px] leading-[1.55] text-[var(--text3)]">
        Hard mechanics the decision flow must obey. A rules preset sets all of
        these — tweak individually for a custom setup.
      </p>
      <div className="mt-4 grid gap-4">
        <SelectField
          label="Rules preset"
          help="Applies a ready-made set of mechanics. Picking one fills every field below."
          value={rules.rulesPresetId}
          onChange={(value) => {
            const preset = TRADE_RULE_PRESETS.find(
              (entry) => entry.id === value,
            );
            if (!preset) return;
            updateRules(preset.rules);
          }}
          disabled={isLocked}
          options={TRADE_RULE_PRESETS.map((preset) => ({
            value: preset.id,
            label: preset.label,
          }))}
        />
        <RiskGroup
          title="Setup"
          help="What the session is hunting for and which direction it may trade."
        >
          <SelectField
            label="Setup type"
            help="The pattern the session is hunting for."
            value={rules.setupType}
            onChange={(value) =>
              updateRules({ setupType: value as typeof rules.setupType })
            }
            disabled={isLocked}
            options={SETUP_TYPES.map((value) => ({
              value,
              label: labelize(value),
            }))}
            hint={optionMeaning(rules.setupType)}
          />
          <SelectField
            label="Side bias"
            help="Allowed trade direction. Enforced by the runtime, not just suggested."
            value={rules.sideBias}
            onChange={(value) =>
              updateRules({ sideBias: value as typeof rules.sideBias })
            }
            disabled={isLocked}
            options={STRATEGY_SIDE_BIASES.map((value) => ({
              value,
              label: labelize(value),
            }))}
            hint={optionMeaning(rules.sideBias)}
          />
        </RiskGroup>
        <RiskGroup
          title="Execution"
          help="How positions are entered, exited, and built or reduced."
        >
          <SelectField
            label="Entry style"
            help="What triggers the entry."
            value={rules.entryStyle}
            onChange={(value) =>
              updateRules({ entryStyle: value as typeof rules.entryStyle })
            }
            disabled={isLocked}
            options={STRATEGY_ENTRY_STYLES.map((value) => ({
              value,
              label: labelize(value),
            }))}
            hint={optionMeaning(rules.entryStyle)}
          />
          <SelectField
            label="Exit style"
            help="How the position is intended to be closed. Stop placement lives on the Risk tab."
            value={rules.exitStyle}
            onChange={(value) =>
              updateRules({ exitStyle: value as typeof rules.exitStyle })
            }
            disabled={isLocked}
            options={STRATEGY_EXIT_STYLES.map((value) => ({
              value,
              label: labelize(value),
            }))}
            hint={optionMeaning(rules.exitStyle)}
          />
          <SelectField
            label="Scaling mode"
            help="Whether the position is taken at once or built/reduced in tranches."
            value={rules.scalingMode}
            onChange={(value) =>
              updateRules({ scalingMode: value as typeof rules.scalingMode })
            }
            disabled={isLocked}
            options={STRATEGY_SCALING_MODES.map((value) => ({
              value,
              label: labelize(value),
            }))}
            hint={optionMeaning(rules.scalingMode)}
          />
        </RiskGroup>
        <Field label="Rule notes (optional)">
          <textarea
            value={rules.ruleNotes}
            onChange={(event) => updateRules({ ruleNotes: event.target.value })}
            disabled={isLocked}
            rows={5}
            placeholder="Add setup-specific filters, invalidation rules, liquidity constraints, or execution reminders."
            className={textareaClass}
          />
        </Field>
      </div>
    </Card>

    <Card>
      <SectionTitle>Selected Rules Summary</SectionTitle>
      <p className="mt-2 text-[12px] leading-[1.55] text-[var(--text3)]">
        Rules define how trades are structured after the style identifies the
        kind of edge to pursue.
      </p>
      <PresetSummaryCard
        presetLabel={selectedRulesPreset.label}
        thesis={selectedRulesPreset.thesis}
        bullets={selectedRulesPreset.summaryBullets}
      />
    </Card>

    <Card>
      <SectionTitle>Live Rules Markdown</SectionTitle>
      <pre className={briefClass}>{rulesPreview}</pre>
    </Card>
  </div>
);

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const formatUsd = (value: number): string => usdFormatter.format(value);

const riskAffixWrapClass =
  "flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-[11px] focus-within:border-[var(--accent)]";
const riskAffixClass = "shrink-0 text-[13px] text-[var(--text3)]";
const riskBareInputClass =
  "w-full border-0 bg-transparent p-0 py-[9px] text-[var(--text1)] outline-none";
const riskGroupClass =
  "grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5";
const riskGroupTitleClass =
  "text-[11px] font-bold uppercase tracking-[0.4px] text-[var(--text2)]";
const riskGroupGridClass =
  "grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]";
const riskChipClass =
  "cursor-pointer rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--text1)]";

// Plain-language meaning of each enum option, shown as a hint under the matching
// select so an operator never has to guess what a value like "document_first"
// actually does.
const OPTION_MEANINGS: Record<string, string> = {
  // Evidence mode
  document_first: "Trust the source filing or document over price action.",
  probability_edge: "Only trade when market odds look mispriced vs evidence.",
  balanced: "Weigh document evidence and price action together.",
  // Catalyst posture
  required: "A fresh catalyst must exist before a trade is allowed.",
  preferred: "Catalysts help, but aren't mandatory.",
  not_required: "Trade on the setup alone — no catalyst needed.",
  // Fundamental strictness
  sanity_check: "Quick gut-check on fundamentals, nothing deep.",
  deep_confirmation: "Demand strong fundamental backing before signing off.",
  not_applicable: "Skip fundamentals (e.g. event contracts).",
  // Setup type
  catalyst_entry: "Enter on a catalyst that should reprice the name.",
  event_entry: "Enter around a scheduled event reaction.",
  custom: "Your own approach — describe it in the notes below.",
  // Side bias
  long_only: "Only buy / go long.",
  short_only: "Only sell / go short.",
  both: "Long or short, whichever the setup supports.",
  market_neutral: "Balance longs and shorts; limit net direction.",
  n_a: "Direction not applicable.",
  // Entry style
  catalyst: "Time entries to the catalyst.",
  event: "Time entries to a scheduled event.",
  // Exit style
  fixed_pct: "Exit at a set profit/loss percent.",
  trailing_atr: "Trail the stop by volatility (ATR).",
  partial_exits: "Scale out in pieces as price moves your way.",
  time_based: "Exit after a set amount of time.",
  thesis_based: "Exit when the thesis plays out or breaks.",
  market_resolution: "Hold until the event resolves.",
  // Scaling mode
  single_entry: "One entry at full size.",
  scale_in_2: "Build the position across 2 entries.",
  scale_in_3: "Build the position across 3 entries.",
  scale_out_partial: "Exit the position in partial pieces.",
  // Holding style
  multi_day_swing: "Hold days up to ~2 weeks.",
  weeks_position: "Hold weeks to months.",
};

const optionMeaning = (value: string): string | undefined =>
  OPTION_MEANINGS[value];

// A select with an inline help tooltip and a hint line describing the currently
// selected option in plain language.
const SelectField = ({
  label,
  help,
  value,
  onChange,
  options,
  disabled,
  hint,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  hint?: string;
}) => (
  <div className="grid content-start gap-1.5">
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] text-[var(--text3)]">{label}</span>
      <HelpTooltip topic={label} body={help} />
    </div>
    <ShadcnSelect
      value={value}
      onValueChange={onChange}
      options={options}
      disabled={disabled}
    />
    {hint ? (
      <span className="text-[11px] leading-tight text-[var(--text3)]">
        {hint}
      </span>
    ) : null}
  </div>
);

// A single numeric risk input with inline help, a unit affix, and an optional
// hint line. Parsing stays with the caller so each field keeps its own
// empty/null semantics.
const RiskField = ({
  label,
  help,
  prefix,
  suffix,
  step,
  value,
  onChange,
  disabled,
  hint,
  hintTone = "muted",
}: {
  label: string;
  help: string;
  prefix?: string;
  suffix?: string;
  step?: string;
  value: number | string;
  onChange: (raw: string) => void;
  disabled: boolean;
  hint?: string;
  hintTone?: "muted" | "warn";
}) => (
  <div className="grid content-start gap-1.5">
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] text-[var(--text3)]">{label}</span>
      <HelpTooltip topic={label} body={help} />
    </div>
    <div className={cn(riskAffixWrapClass, disabled && "opacity-60")}>
      {prefix ? <span className={riskAffixClass}>{prefix}</span> : null}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={riskBareInputClass}
      />
      {suffix ? <span className={riskAffixClass}>{suffix}</span> : null}
    </div>
    {hint ? (
      <span
        className={cn(
          "text-[11px] leading-tight",
          hintTone === "warn" ? "text-warning" : "text-[var(--text3)]",
        )}
      >
        {hint}
      </span>
    ) : null}
  </div>
);

const RiskGroup = ({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: ReactNode;
}) => (
  <div className={riskGroupClass}>
    <div className="flex items-center gap-1.5">
      <span className={riskGroupTitleClass}>{title}</span>
      <HelpTooltip topic={title} body={help} />
    </div>
    <div className={riskGroupGridClass}>{children}</div>
  </div>
);

const CapitalBanner = ({
  capital,
  maxPos,
  isLocked,
  onQuickSet,
}: {
  capital: number;
  maxPos: number;
  isLocked: boolean;
  onQuickSet: (fraction: number) => void;
}) => {
  if (capital <= 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 text-[12px] leading-[1.55] text-[var(--text3)]">
        No capital is allocated to this session yet. Assign broker capital on
        the session to size positions against a real balance — sizes here are
        still enforced, but there is nothing to compare them to.
      </div>
    );
  }
  const pct = Math.round((maxPos / capital) * 100);
  const over = maxPos > capital;
  return (
    <div className="grid gap-3 rounded-xl border border-info-border bg-[var(--surface2)] px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.35px] text-info">
            Session capital
          </span>
          <span className="text-[18px] font-bold text-[var(--text1)]">
            {formatUsd(capital)}
          </span>
        </div>
        <div className="grid gap-0.5 text-right">
          <span className="text-[11px] font-bold uppercase tracking-[0.35px] text-[var(--text3)]">
            Max position
          </span>
          <span
            className={cn(
              "text-[18px] font-bold",
              over ? "text-warning" : "text-[var(--text1)]",
            )}
          >
            {pct}%
          </span>
        </div>
      </div>
      {!isLocked ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[var(--text3)]">
            Set max position to
          </span>
          {[0.1, 0.25, 0.5, 1].map((fraction) => (
            <button
              key={fraction}
              type="button"
              onClick={() => onQuickSet(fraction)}
              className={riskChipClass}
            >
              {Math.round(fraction * 100)}%
            </button>
          ))}
          <span className="text-[11px] text-[var(--text3)]">of capital</span>
        </div>
      ) : null}
    </div>
  );
};

const RiskSection = ({
  riskConfig,
  isLocked,
  updateRiskConfig,
  sessionCapitalUsd,
}: {
  riskConfig: SessionRiskConfig;
  isLocked: boolean;
  updateRiskConfig: (patch: Partial<SessionRiskConfig>) => void;
  sessionCapitalUsd: number;
}) => {
  const presetId = riskConfig.riskPresetId ?? "custom";
  const preset =
    RISK_PRESETS.find((p) => p.id === presetId) ??
    RISK_PRESETS[RISK_PRESETS.length - 1];
  const maxPos = riskConfig.maxPositionUsd || 0;
  const hasCapital = sessionCapitalUsd > 0;
  const overCapital = hasCapital && maxPos > sessionCapitalUsd;
  const stopType = riskConfig.stopLossType;
  const showPrediction =
    presetId === "prediction_market" || riskConfig.maxExposureUsd != null;

  const maxPosHint = overCapital
    ? `Larger than session capital (${formatUsd(sessionCapitalUsd)})`
    : hasCapital
      ? `${Math.round((maxPos / sessionCapitalUsd) * 100)}% of session capital`
      : "Allocate broker capital to see this as a % of the session";

  return (
    <Card>
      <SectionHeading
        title="Risk Controls"
        glossaryId="strategy-risk-controls"
      />
      <div className="mt-4 grid gap-4">
        <Field label="Risk preset">
          <ShadcnSelect
            value={presetId}
            onValueChange={(value) => {
              const next = RISK_PRESETS.find((p) => p.id === value);
              if (!next) return;
              updateRiskConfig({ riskPresetId: next.id, ...next.values });
            }}
            disabled={isLocked}
            options={RISK_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          />
        </Field>
        <PresetSummaryCard
          presetLabel={preset.label}
          thesis={preset.description}
          bullets={preset.summaryBullets}
        />

        <CapitalBanner
          capital={sessionCapitalUsd}
          maxPos={maxPos}
          isLocked={isLocked}
          onQuickSet={(fraction) =>
            updateRiskConfig({
              maxPositionUsd: Math.round(sessionCapitalUsd * fraction),
            })
          }
        />

        <RiskGroup
          title="Position sizing"
          help="How much money each trade can use and how many can run at once. Sizing never exceeds these, no matter how confident the AI is."
        >
          <RiskField
            label="Max position"
            help="The most money this session can put into a single trade."
            prefix="$"
            value={riskConfig.maxPositionUsd}
            onChange={(raw) =>
              updateRiskConfig({ maxPositionUsd: Number(raw) || 0 })
            }
            disabled={isLocked}
            hint={maxPosHint}
            hintTone={overCapital ? "warn" : "muted"}
          />
          <RiskField
            label="Max concurrent trades"
            help="How many positions can be open at the same time."
            suffix="open"
            value={riskConfig.maxConcurrentTrades}
            onChange={(raw) =>
              updateRiskConfig({ maxConcurrentTrades: Number(raw) || 0 })
            }
            disabled={isLocked}
          />
          <Field label="Off-hours trading">
            <ShadcnSelect
              value={riskConfig.offHoursTrading ?? "disabled"}
              onValueChange={(value) =>
                updateRiskConfig({
                  offHoursTrading: value as typeof riskConfig.offHoursTrading,
                })
              }
              disabled={isLocked}
              options={[
                { value: "disabled", label: "Regular hours only" },
                { value: "extended_hours", label: "Allow extended hours" },
              ]}
            />
          </Field>
        </RiskGroup>

        <RiskGroup
          title="Stops & exits"
          help="Where losing trades are cut and winners are booked. The stop type decides which fields below apply."
        >
          <Field label="Stop loss type">
            <ShadcnSelect
              value={stopType}
              onValueChange={(value) =>
                updateRiskConfig({
                  stopLossType: value as typeof riskConfig.stopLossType,
                })
              }
              disabled={isLocked}
              options={STOP_LOSS_TYPES.map((value) => ({
                value,
                label: labelize(value),
              }))}
            />
          </Field>
          {stopType === "fixed_pct" || stopType === "broker_native_trailing" ? (
            <RiskField
              label="Stop loss %"
              help="Distance from entry where the position is cut, as a percent of price."
              suffix="%"
              step="0.1"
              value={riskConfig.stopLossPct ?? ""}
              onChange={(raw) =>
                updateRiskConfig({
                  stopLossPct: raw === "" ? null : Number(raw),
                })
              }
              disabled={isLocked}
            />
          ) : null}
          {stopType === "trailing_atr" ? (
            <RiskField
              label="ATR stop multiplier"
              help="Stop distance as a multiple of recent volatility (ATR). Higher = wider stop, more room before exit."
              suffix="× ATR"
              step="0.1"
              value={riskConfig.atrStopMultiplier ?? ""}
              onChange={(raw) =>
                updateRiskConfig({
                  atrStopMultiplier: raw === "" ? null : Number(raw),
                })
              }
              disabled={isLocked}
            />
          ) : null}
          <RiskField
            label="Take profit %"
            help="Optional fixed target where the position is closed in profit. Leave empty to let exit style decide."
            suffix="%"
            step="0.1"
            value={riskConfig.takeProfitPct ?? ""}
            onChange={(raw) =>
              updateRiskConfig({
                takeProfitPct: raw === "" ? null : Number(raw),
              })
            }
            disabled={isLocked}
          />
          {stopType === "none" ? (
            <div className="col-span-full text-[11px] leading-[1.5] text-[var(--text3)]">
              No hard stop — exits are handled by the timeframe&apos;s hold
              window and the exit style on the Rules tab.
            </div>
          ) : null}
        </RiskGroup>

        <RiskGroup
          title="Daily circuit breakers"
          help="Session-wide limits that pause new trades for the day once hit. Open positions stay managed."
        >
          <RiskField
            label="Daily loss limit"
            help="If the session loses this much in a day, it stops opening new trades until the next day."
            prefix="$"
            value={riskConfig.dailyLossLimitUsd}
            onChange={(raw) =>
              updateRiskConfig({ dailyLossLimitUsd: Number(raw) || 0 })
            }
            disabled={isLocked}
          />
          <RiskField
            label="Profit target"
            help="If the session makes this much in a day, it stops for the day to lock in gains."
            prefix="$"
            value={riskConfig.profitTargetUsd}
            onChange={(raw) =>
              updateRiskConfig({ profitTargetUsd: Number(raw) || 0 })
            }
            disabled={isLocked}
          />
          <RiskField
            label="Wait-for-open threshold"
            help="Confidence floor from 0 to 1. Below this, a decision waits instead of opening. Higher = more selective."
            step="0.01"
            value={riskConfig.waitForOpenThreshold}
            onChange={(raw) =>
              updateRiskConfig({ waitForOpenThreshold: Number(raw) || 0 })
            }
            disabled={isLocked}
            hint="0 = take everything · 1 = only the strongest"
          />
        </RiskGroup>

        {showPrediction ? (
          <RiskGroup
            title="Prediction markets"
            help="Only applies to prediction-market (event contract) sessions. Ignored for stock, crypto, and futures."
          >
            <RiskField
              label="Kelly fraction"
              help="Bet-sizing aggressiveness for probability trades. 1.0 is full Kelly (max growth but very swingy); most use 0.1–0.4. Higher = bigger bets on the same edge."
              step="0.05"
              value={riskConfig.kellyFraction}
              onChange={(raw) =>
                updateRiskConfig({ kellyFraction: Number(raw) || 0 })
              }
              disabled={isLocked}
            />
            <RiskField
              label="Edge threshold"
              help="Minimum gap between your estimated odds and the market price before a contract is worth trading. 0.08 = 8%."
              step="0.01"
              value={riskConfig.predictionEdgeThreshold}
              onChange={(raw) =>
                updateRiskConfig({
                  predictionEdgeThreshold: Number(raw) || 0,
                })
              }
              disabled={isLocked}
            />
            <RiskField
              label="Max exposure"
              help="Cap on total money tied up across all open prediction-market contracts at once."
              prefix="$"
              value={riskConfig.maxExposureUsd ?? ""}
              onChange={(raw) =>
                updateRiskConfig({
                  maxExposureUsd: raw === "" ? null : Number(raw),
                })
              }
              disabled={isLocked}
            />
          </RiskGroup>
        ) : null}

        <RiskGroup
          title="Budget & approval"
          help="Spend ceiling for AI research and whether a human signs off before any order is sent."
        >
          <RiskField
            label="Max AI spend / day"
            help="Daily budget for model calls. Hitting it pauses new research for the day; open trades stay managed."
            prefix="$"
            step="0.5"
            value={riskConfig.maxAiSpendUsd}
            onChange={(raw) =>
              updateRiskConfig({ maxAiSpendUsd: Number(raw) || 0 })
            }
            disabled={isLocked}
          />
          <div className="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface2)] p-2.5">
            <Switch
              checked={riskConfig.humanApprovalRequired}
              onCheckedChange={(checked) =>
                updateRiskConfig({ humanApprovalRequired: checked })
              }
              disabled={isLocked}
            />
            <div className="grid gap-0.5">
              <span className="text-[13px] font-medium text-[var(--text1)]">
                Require human approval
              </span>
              <span className="text-[11px] leading-[1.45] text-[var(--text3)]">
                Every trade waits in the approval queue for you before it
                executes.
              </span>
            </div>
          </div>
        </RiskGroup>
      </div>
    </Card>
  );
};

const TimeframeSection = ({
  timeframe,
  isLocked,
  updateTimeframe,
}: {
  timeframe: SessionTimeframeConfig;
  isLocked: boolean;
  updateTimeframe: (patch: Partial<SessionTimeframeConfig>) => void;
}) => {
  const selectedTimeframePreset =
    TIMEFRAME_PRESETS.find(
      (preset) => preset.id === (timeframe.timeframePresetId ?? "custom"),
    ) ?? TIMEFRAME_PRESETS[TIMEFRAME_PRESETS.length - 1];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <SectionHeading
          title="Timeframe Preset"
          glossaryId="strategy-timeframe"
        />
        <p className="mb-1 mt-2 text-[12px] leading-[1.55] text-[var(--text3)]">
          How long trades are meant to be held and which bar size the AI
          analyzes on. A preset sets the bars and hold window for you.
        </p>
        <div className="mt-4 grid gap-4">
          <SelectField
            label="Timeframe preset"
            help="Applies a ready-made horizon. Picking one sets the bar size and hold window below."
            value={timeframe.timeframePresetId ?? "custom"}
            onChange={(value) => {
              const preset = TIMEFRAME_PRESETS.find((p) => p.id === value);
              if (!preset) return;
              updateTimeframe({
                timeframePresetId: preset.id,
                ...preset.values,
              });
            }}
            disabled={isLocked}
            options={TIMEFRAME_PRESETS.map((p) => ({
              value: p.id,
              label: p.label,
            }))}
          />
          <PresetSummaryCard
            presetLabel={selectedTimeframePreset.label}
            thesis={selectedTimeframePreset.description}
            bullets={selectedTimeframePreset.summaryBullets}
          />
        </div>
      </Card>
      <TimeframeHorizonCard
        timeframe={timeframe}
        disabled={isLocked}
        onChange={updateTimeframe}
      />
    </div>
  );
};
