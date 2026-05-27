import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Card,
  PageShell,
  SectionTitle,
  ShadcnSelect,
} from "@/components/custom-ui";
import {
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
import { api } from "@/lib/exva";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/sessionStore";
import type { SessionStatus } from "@/lib/types";
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
  RESEARCH_DISCOVERY_MODES,
  RESEARCH_EVIDENCE_MODES,
  RESEARCH_FUNDAMENTAL_STRICTNESS,
  type SessionAiSettings,
  type SessionResearchPosture,
  type SessionTradeRules,
  type SessionRiskConfig,
  type SessionTimeframeConfig,
  type ResearchPosturePreset,
  type TradeRulesPreset,
} from "../../electron/shared/domain";
import {
  TRADE_RULE_PRESETS,
  RISK_PRESETS,
  TIMEFRAME_PRESETS,
  RESEARCH_POSTURE_PRESETS,
} from "../../electron/shared/presets";
import type { GlobalStrategyPreset } from "../../electron/shared/presets";
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
        <button
          onClick={async () => {
            const next = await api.stopSession();
            setSessionStatus(next);
            await loadStrategy(focusedSessionId);
          }}
          className={warningDrainButtonClass}
          title="Stops new research immediately and completes shutdown once all open trades close."
        >
          Stop when flat
        </button>
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
}: {
  activeView: "presets" | "customize";
  setActiveView: (view: "presets" | "customize") => void;
  saveState: "locked" | "clean" | "dirty" | "saving";
  focusedSessionId: string;
  saveAll: (id: string) => Promise<void>;
}) => {
  const isSaving = saveState === "saving";
  const canSave = saveState === "dirty";
  const showActiveSaveStyle = saveState === "dirty" || saveState === "saving";

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="m-0 text-[22px] text-[var(--text1)]">Strategy</h1>
        <p className="m-0 mt-1 text-[13px] text-[var(--text3)]">
          Separate research posture, trade rules, risk limits, timeframe, phase
          operating briefs, and AI phase model/prompt settings for the focused
          session.
        </p>
      </div>
      <div className="flex items-center gap-2.5">
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
        </div>
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
      await api.deleteGlobalPreset({ id });
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
  const saveAll = useStrategyStore((state) => state.saveAll);
  const setActiveSection = useStrategyStore((state) => state.setActiveSection);

  const [activeView, setActiveView] = useState<"presets" | "customize">(
    "presets",
  );
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [focusedOpenTradeCount, setFocusedOpenTradeCount] = useState(0);
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
      return;
    }
    void (async () => {
      let nextCount = 0;
      try {
        const result = await api.listSessions({ includeArchived: false });
        const focused = result.sessions.find(
          (session) => session.id === focusedSessionId,
        );
        nextCount = focused?.openTradeCount ?? 0;
      } catch {
        nextCount = 0;
      }
      setFocusedOpenTradeCount(nextCount);
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
      <PageShell>
        <Header
          loadWorkspaceView={loadWorkspaceView}
          setViewMode={setViewMode}
        />
        <div className={emptyStateClass}>
          <div className="mb-4 text-[32px]">⚙</div>
          <div className="mb-2 text-[16px] font-bold text-[var(--text1)]">
            No session focused
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
      </PageShell>
    );
  }

  if (!researchPosture || !rules || !riskConfig || !timeframe || !aiSettings) {
    return (
      <PageShell>
        <div className="text-[var(--text3)]">Loading strategy…</div>
      </PageShell>
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
}: StrategyConfigMainViewArgs) => (
  <PageShell>
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
        await api.createGlobalPreset({
          name: input.name,
          preset: {
            description: "",
            summaryBullets: [],
            posturePresetId: input.posturePresetId,
            rulesPresetId: input.rulesPresetId,
            riskPresetId: input.riskPresetId,
            timeframePresetId: input.timeframePresetId,
          },
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
        await api.updateGlobalPreset({
          id: editingPreset.id,
          name: input.name,
          preset: {
            description: "",
            summaryBullets: [],
            posturePresetId: input.posturePresetId,
            rulesPresetId: input.rulesPresetId,
            riskPresetId: input.riskPresetId,
            timeframePresetId: input.timeframePresetId,
          },
        });
        await loadGlobalPresets();
        setEditingPreset(null);
      }}
      onClose={() => setEditingPreset(null)}
    />
  </PageShell>
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
  "flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[rgba(18,26,36,0.6)] px-6 py-[60px] text-center";

const stepListClass = "mb-6 grid w-full max-w-[340px] gap-2.5 text-left";

const goToSessionsButtonClass =
  "cursor-pointer rounded-[10px] border border-[rgba(96,165,250,0.3)] bg-[rgba(96,165,250,0.1)] px-[22px] py-2.5 text-[13px] font-semibold text-[rgba(96,165,250,0.95)]";

const viewToggleContainerClass =
  "flex overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface2)]";
const viewToggleActiveClass =
  "cursor-pointer border-none bg-[var(--surface3)] px-4 py-[7px] text-[13px] font-semibold text-[var(--text1)]";
const viewToggleInactiveClass =
  "cursor-pointer border-none bg-transparent px-4 py-[7px] text-[13px] font-medium text-[var(--text3)]";
const briefClass =
  "mt-3.5 whitespace-pre-wrap rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] p-3.5 text-[12px] leading-relaxed text-[var(--text2)]";
const formGridClass = "mt-4 grid gap-3.5";
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
  "flex items-center justify-between gap-3 rounded-xl border border-[rgba(96,165,250,0.22)] bg-[linear-gradient(135deg,rgba(30,41,59,0.9),rgba(15,23,42,0.82))] px-4 py-3.5";
const activeGlobalPresetEyebrowClass =
  "text-[12px] font-bold uppercase tracking-[0.35px] text-[rgba(147,197,253,0.85)]";
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
      ? "border border-[rgba(34,197,94,0.28)] bg-[rgba(34,197,94,0.12)] text-[rgba(187,247,208,0.96)]"
      : "border border-[rgba(96,165,250,0.28)] bg-[rgba(96,165,250,0.12)] text-[rgba(191,219,254,0.96)]",
  );
const presetSummaryClass =
  "mt-3.5 grid gap-3 rounded-xl border border-[rgba(96,165,250,0.22)] bg-[linear-gradient(135deg,rgba(30,41,59,0.9),rgba(15,23,42,0.82))] p-3.5";
const presetBadgeClass =
  "inline-flex w-fit rounded-full border border-[rgba(96,165,250,0.28)] bg-[rgba(96,165,250,0.12)] px-2.5 py-1 text-[12px] font-bold tracking-[0.2px] text-[rgba(191,219,254,0.96)]";
const presetThesisClass =
  "text-[13px] font-semibold leading-[1.55] text-[var(--text1)]";
const presetBulletClass = "text-[12px] leading-normal text-[var(--text3)]";

// ─── Section components ───────────────────────────────────────────────────────

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
  <>
    <Card>
      <SectionTitle>AI Instructions</SectionTitle>
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
      <SectionTitle>Research posture</SectionTitle>
      <div className={formGridClass}>
        <Field label="Posture preset">
          <ShadcnSelect
            value={researchPosture.posturePresetId}
            onValueChange={(value) => {
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
        </Field>
        <Field label="Discovery mode">
          <ShadcnSelect
            value={researchPosture.discoveryMode}
            onValueChange={(value) =>
              updateResearchPosture({
                discoveryMode: value as typeof researchPosture.discoveryMode,
              })
            }
            disabled={isLocked}
            options={RESEARCH_DISCOVERY_MODES.map((value) => ({
              value,
              label: labelize(value),
            }))}
          />
        </Field>
        <Field label="Evidence mode">
          <ShadcnSelect
            value={researchPosture.evidenceMode}
            onValueChange={(value) =>
              updateResearchPosture({
                evidenceMode: value as typeof researchPosture.evidenceMode,
              })
            }
            disabled={isLocked}
            options={RESEARCH_EVIDENCE_MODES.map((value) => ({
              value,
              label: labelize(value),
            }))}
          />
        </Field>
        <Field label="Catalyst posture">
          <ShadcnSelect
            value={researchPosture.catalystMode}
            onValueChange={(value) =>
              updateResearchPosture({
                catalystMode: value as typeof researchPosture.catalystMode,
              })
            }
            disabled={isLocked}
            options={RESEARCH_CATALYST_MODES.map((value) => ({
              value,
              label: labelize(value),
            }))}
          />
        </Field>
        <Field label="Fundamental strictness">
          <ShadcnSelect
            value={researchPosture.fundamentalStrictness}
            onValueChange={(value) =>
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
          />
        </Field>
        <Field label="Posture notes">
          <textarea
            value={researchPosture.postureNotes}
            onChange={(event) =>
              updateResearchPosture({ postureNotes: event.target.value })
            }
            disabled={isLocked}
            rows={6}
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
  </>
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
  <>
    <Card>
      <SectionTitle>Trade Rules</SectionTitle>
      <div className={formGridClass}>
        <Field label="Rules preset">
          <ShadcnSelect
            value={rules.rulesPresetId}
            onValueChange={(value) => {
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
        </Field>
        <Field label="Setup type">
          <ShadcnSelect
            value={rules.setupType}
            onValueChange={(value) =>
              updateRules({ setupType: value as typeof rules.setupType })
            }
            disabled={isLocked}
            options={SETUP_TYPES.map((value) => ({
              value,
              label: labelize(value),
            }))}
          />
        </Field>
        <Field label="Side bias">
          <ShadcnSelect
            value={rules.sideBias}
            onValueChange={(value) =>
              updateRules({ sideBias: value as typeof rules.sideBias })
            }
            disabled={isLocked}
            options={STRATEGY_SIDE_BIASES.map((value) => ({
              value,
              label: labelize(value),
            }))}
          />
        </Field>
        <Field label="Entry style">
          <ShadcnSelect
            value={rules.entryStyle}
            onValueChange={(value) =>
              updateRules({ entryStyle: value as typeof rules.entryStyle })
            }
            disabled={isLocked}
            options={STRATEGY_ENTRY_STYLES.map((value) => ({
              value,
              label: labelize(value),
            }))}
          />
        </Field>
        <Field label="Exit style">
          <ShadcnSelect
            value={rules.exitStyle}
            onValueChange={(value) =>
              updateRules({ exitStyle: value as typeof rules.exitStyle })
            }
            disabled={isLocked}
            options={STRATEGY_EXIT_STYLES.map((value) => ({
              value,
              label: labelize(value),
            }))}
          />
        </Field>
        <Field label="Scaling mode">
          <ShadcnSelect
            value={rules.scalingMode}
            onValueChange={(value) =>
              updateRules({ scalingMode: value as typeof rules.scalingMode })
            }
            disabled={isLocked}
            options={STRATEGY_SCALING_MODES.map((value) => ({
              value,
              label: labelize(value),
            }))}
          />
        </Field>
        <Field label="Rule notes">
          <textarea
            value={rules.ruleNotes}
            onChange={(event) => updateRules({ ruleNotes: event.target.value })}
            disabled={isLocked}
            rows={6}
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
  </>
);

const RiskSection = ({
  riskConfig,
  isLocked,
  updateRiskConfig,
}: {
  riskConfig: SessionRiskConfig;
  isLocked: boolean;
  updateRiskConfig: (patch: Partial<SessionRiskConfig>) => void;
}) => (
  <Card>
    <SectionTitle>Risk Controls</SectionTitle>
    <div className={formGridClass}>
      <Field label="Risk preset">
        <ShadcnSelect
          value={riskConfig.riskPresetId ?? "custom"}
          onValueChange={(value) => {
            const preset = RISK_PRESETS.find((p) => p.id === value);
            if (!preset) return;
            updateRiskConfig({ riskPresetId: preset.id, ...preset.values });
          }}
          disabled={isLocked}
          options={RISK_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        />
      </Field>
      <Field label="Max position USD">
        <input
          type="number"
          value={riskConfig.maxPositionUsd}
          onChange={(event) =>
            updateRiskConfig({
              maxPositionUsd: Number(event.target.value) || 0,
            })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <Field label="Max concurrent trades">
        <input
          type="number"
          value={riskConfig.maxConcurrentTrades}
          onChange={(event) =>
            updateRiskConfig({
              maxConcurrentTrades: Number(event.target.value) || 0,
            })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <Field label="Stop loss type">
        <ShadcnSelect
          value={riskConfig.stopLossType}
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
      <Field label="Stop loss %">
        <input
          type="number"
          step="0.1"
          value={riskConfig.stopLossPct ?? ""}
          onChange={(event) =>
            updateRiskConfig({
              stopLossPct:
                event.target.value === "" ? null : Number(event.target.value),
            })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <Field label="Take profit %">
        <input
          type="number"
          step="0.1"
          value={riskConfig.takeProfitPct ?? ""}
          onChange={(event) =>
            updateRiskConfig({
              takeProfitPct:
                event.target.value === "" ? null : Number(event.target.value),
            })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <Field label="ATR stop multiplier">
        <input
          type="number"
          step="0.1"
          value={riskConfig.atrStopMultiplier ?? ""}
          onChange={(event) =>
            updateRiskConfig({
              atrStopMultiplier:
                event.target.value === "" ? null : Number(event.target.value),
            })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <Field label="Kelly fraction">
        <input
          type="number"
          step="0.05"
          value={riskConfig.kellyFraction}
          onChange={(event) =>
            updateRiskConfig({ kellyFraction: Number(event.target.value) || 0 })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <Field label="Prediction edge threshold">
        <input
          type="number"
          step="0.01"
          value={riskConfig.predictionEdgeThreshold}
          onChange={(event) =>
            updateRiskConfig({
              predictionEdgeThreshold: Number(event.target.value) || 0,
            })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <Field label="Max exposure USD">
        <input
          type="number"
          value={riskConfig.maxExposureUsd ?? ""}
          onChange={(event) =>
            updateRiskConfig({
              maxExposureUsd:
                event.target.value === "" ? null : Number(event.target.value),
            })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <Field label="Wait-for-open threshold">
        <input
          type="number"
          step="0.01"
          value={riskConfig.waitForOpenThreshold}
          onChange={(event) =>
            updateRiskConfig({
              waitForOpenThreshold: Number(event.target.value) || 0,
            })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <Field label="Daily loss limit USD">
        <input
          type="number"
          value={riskConfig.dailyLossLimitUsd}
          onChange={(event) =>
            updateRiskConfig({
              dailyLossLimitUsd: Number(event.target.value) || 0,
            })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <Field label="Profit target USD">
        <input
          type="number"
          value={riskConfig.profitTargetUsd}
          onChange={(event) =>
            updateRiskConfig({
              profitTargetUsd: Number(event.target.value) || 0,
            })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <Field label="Max AI spend USD / day">
        <input
          type="number"
          step="0.5"
          value={riskConfig.maxAiSpendUsd}
          onChange={(event) =>
            updateRiskConfig({ maxAiSpendUsd: Number(event.target.value) || 0 })
          }
          disabled={isLocked}
          className={inputClass}
        />
      </Field>
      <div className="flex items-center gap-2 text-[13px] text-[var(--text2)]">
        <Switch
          checked={riskConfig.humanApprovalRequired}
          onCheckedChange={(checked) =>
            updateRiskConfig({ humanApprovalRequired: checked })
          }
          disabled={isLocked}
        />
        Human Approval Required
      </div>
    </div>
  </Card>
);

const TimeframeSection = ({
  timeframe,
  isLocked,
  updateTimeframe,
}: {
  timeframe: SessionTimeframeConfig;
  isLocked: boolean;
  updateTimeframe: (patch: Partial<SessionTimeframeConfig>) => void;
}) => (
  <>
    <Card>
      <SectionTitle>Timeframe Preset</SectionTitle>
      <div className={formGridClass}>
        <Field label="Timeframe preset">
          <ShadcnSelect
            value={timeframe.timeframePresetId ?? "custom"}
            onValueChange={(value) => {
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
        </Field>
      </div>
    </Card>
    <TimeframeHorizonCard
      timeframe={timeframe}
      disabled={isLocked}
      onChange={updateTimeframe}
    />
  </>
);
