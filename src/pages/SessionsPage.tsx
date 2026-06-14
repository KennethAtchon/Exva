import {
  type Reducer,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { Badge, Card, PageShell, ShadcnSelect } from "@/components/custom-ui";
import { Button, Checkbox, HelpTooltip } from "@/components/ui";
import {
  api,
  listenEvent,
  type SessionCreateInput,
  type SessionSummary,
} from "@/lib/exva";
import type { InstrumentClass, SessionStatus } from "@/lib/types";
import { CreateEditSessionModal } from "@/components/sessions/CreateEditSessionModal";
import { LiveReadinessModal } from "@/components/sessions/LiveReadinessModal";
import { SessionDetailDrawer } from "@/components/sessions/SessionDetailDrawer";
import { SessionTable } from "@/components/sessions/SessionTable";
import { SessionTemplatesModal } from "@/components/sessions/SessionTemplatesModal";
import {
  deriveProgress,
  type SessionProgressState,
} from "@/components/sessions/SessionExecutionProgress";
import { cn } from "@/lib/utils";
import { SESSION_STATUS_HELP_IDS } from "@/lib/help-glossary";
import { useWorkspaceStore } from "@/store/workspaceStore";

const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

type LifecycleAction = "start" | "pause" | "resume" | "stop" | "forceStop";

const FORCE_STOP_CONFIRM_MESSAGE =
  "Force stop will end automated exit management for open positions. Continue?";

interface LiveReadinessReport {
  readyToStart: boolean;
  allChecksPassed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    requiresAck?: boolean;
    message?: string;
  }>;
  acknowledgedAt: string | null;
}

type FiltersState = {
  search: string;
  statusFilter: SessionStatus | "all";
  instrumentFilter: InstrumentClass | "all";
};

type DataState = {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  actionSessionId: string | null;
  progressBySessionId: Record<string, SessionProgressState>;
  researchFailuresBySessionId: Record<
    string,
    { phase: string; error: string; at: string }
  >;
};

type UiState = {
  detail: SessionSummary | null;
  editing: SessionSummary | null;
  modalOpen: boolean;
  templatesOpen: boolean;
  templateInput: SessionCreateInput | null;
  templateWarnings: string[];
  templateSourceSession: SessionSummary | null;
  liveReadinessSession: SessionSummary | null;
  liveReadinessReport: LiveReadinessReport | null;
};

const useSessionMetrics = (
  sessions: SessionSummary[],
  focusedSessionId: string | null,
) => {
  const focusedSession = useMemo(
    () => sessions.find((session) => session.id === focusedSessionId) ?? null,
    [sessions, focusedSessionId],
  );
  const activeCount = useMemo(
    () => sessions.filter((session) => session.status === "active").length,
    [sessions],
  );
  const pausedCount = useMemo(
    () => sessions.filter((session) => session.status === "paused").length,
    [sessions],
  );
  const openTrades = useMemo(
    () => sessions.reduce((sum, session) => sum + session.openTradeCount, 0),
    [sessions],
  );

  return { focusedSession, activeCount, pausedCount, openTrades };
};

const executeLifecycleAction = async ({
  session,
  action,
  load,
  dispatchData,
  dispatchUi,
}: {
  session: SessionSummary;
  action: LifecycleAction;
  load: () => Promise<void>;
  dispatchData: (patch: Partial<DataState>) => void;
  dispatchUi: (patch: Partial<UiState>) => void;
}) => {
  dispatchData({ actionSessionId: session.id, error: null });
  try {
    if (!session.isFocused) {
      await api.focusSession(session.id);
    }
    if (action === "start" && session.executionMode === "live_allowed") {
      const readiness = await api.getLiveReadiness(session.id);
      if (!readiness.readyToStart || !readiness.acknowledgedAt) {
        dispatchUi({
          liveReadinessReport: readiness,
          liveReadinessSession: session,
        });
        dispatchData({ actionSessionId: null });
        return;
      }
    }
    if (action === "start") await api.startSession();
    if (action === "pause") await api.pauseSession();
    if (action === "resume") await api.resumeSession();
    if (action === "stop") await api.stopSession();
    if (action === "forceStop") {
      if (!window.confirm(FORCE_STOP_CONFIRM_MESSAGE)) {
        dispatchData({ actionSessionId: null });
        return;
      }
      await api.forceStopSession();
    }
    await load();
  } catch (actionError) {
    dispatchData({
      error:
        actionError instanceof Error
          ? actionError.message
          : "Session action failed.",
    });
  } finally {
    dispatchData({ actionSessionId: null });
  }
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const SessionFilters = ({
  search,
  statusFilter,
  instrumentFilter,
  includeArchived,
  onSearchChange,
  onStatusChange,
  onInstrumentChange,
  onIncludeArchivedChange,
}: {
  search: string;
  statusFilter: SessionStatus | "all";
  instrumentFilter: InstrumentClass | "all";
  includeArchived: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: SessionStatus | "all") => void;
  onInstrumentChange: (value: InstrumentClass | "all") => void;
  onIncludeArchivedChange: (checked: boolean) => Promise<void>;
}) => (
  <div className={toolbarClass}>
    <input
      value={search}
      onChange={(event) => onSearchChange(event.target.value)}
      placeholder="Search by name or objective"
      className={cn(inputClass, "flex-1")}
    />
    <div className="flex items-center gap-1">
      <ShadcnSelect
        value={statusFilter}
        onValueChange={(value) =>
          onStatusChange(value as SessionStatus | "all")
        }
        className="w-[180px]"
        options={[
          { value: "all", label: "All statuses" },
          { value: "draft", label: "Draft" },
          { value: "idle", label: "Idle" },
          { value: "active", label: "Active" },
          { value: "attention_required", label: "Needs attention" },
          { value: "paused", label: "Paused" },
          { value: "monitoring_only", label: "Stopping when flat" },
          { value: "stopped", label: "Stopped" },
          { value: "archived", label: "Archived" },
        ]}
      />
      <HelpTooltip glossaryId="status-filter" />
    </div>
    <div className="flex items-center gap-1">
      <ShadcnSelect
        value={instrumentFilter}
        onValueChange={(value) =>
          onInstrumentChange(value as InstrumentClass | "all")
        }
        className="w-[180px]"
        options={[
          { value: "all", label: "All instruments" },
          { value: "stock", label: "Stocks" },
          { value: "crypto", label: "Crypto" },
          { value: "futures", label: "Futures" },
        ]}
      />
      <HelpTooltip glossaryId="instrument-class" />
    </div>
    <div className="flex items-center gap-2 whitespace-nowrap text-[12px] text-[var(--text2)]">
      <Checkbox
        checked={includeArchived}
        onCheckedChange={(checked) =>
          void onIncludeArchivedChange(checked === true)
        }
      />
      Include archived
    </div>
  </div>
);

const SessionFocusPanel = ({
  focusedSession,
  actionSessionId,
  aiReady,
  onGoToStrategy,
  onLifecycleAction,
}: {
  focusedSession: SessionSummary | null;
  actionSessionId: string | null;
  aiReady: boolean | null | undefined;
  onGoToStrategy?: () => void;
  onLifecycleAction: (session: SessionSummary, action: LifecycleAction) => void;
}) => {
  if (!focusedSession) return null;
  const { status, openTradeCount } = focusedSession;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {status === "draft" || status === "idle" || status === "stopped" ? (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => onLifecycleAction(focusedSession, "start")}
            className={cn(
              primaryButtonClass,
              aiReady === false && disabledStartClass,
            )}
            disabled={
              actionSessionId === focusedSession.id || aiReady === false
            }
          >
            Start
          </Button>
          <HelpTooltip
            topic="Start session"
            body={
              aiReady === false
                ? "AI providers are not connected yet. Configure them on the Strategy page before starting."
                : "Starts signal processing and new research cycles for the focused session."
            }
          />
        </div>
      ) : null}
      {status === "active" ? (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            onClick={() => onLifecycleAction(focusedSession, "pause")}
            className={secondaryButtonClass}
            disabled={actionSessionId === focusedSession.id}
          >
            Pause
          </Button>
          <HelpTooltip
            topic="Pause session"
            body="Pause stops new research but keeps exits and open-position monitoring active."
          />
        </div>
      ) : null}
      {status === "paused" ? (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => onLifecycleAction(focusedSession, "resume")}
            className={primaryButtonClass}
            disabled={actionSessionId === focusedSession.id}
          >
            Resume
          </Button>
          <HelpTooltip glossaryId="resume-session" />
        </div>
      ) : null}
      {status === "monitoring_only" ? (
        <div className={drainBannerClass}>
          Stopping when flat: managing {openTradeCount} open trade
          {openTradeCount === 1 ? "" : "s"}. Session stops automatically once
          flat.
        </div>
      ) : null}
      {(status === "active" || status === "paused") && openTradeCount === 0 ? (
        <Button
          variant="ghost"
          onClick={() => onLifecycleAction(focusedSession, "stop")}
          className={dangerButtonClass}
          disabled={actionSessionId === focusedSession.id}
        >
          Stop
        </Button>
      ) : null}
      {(status === "active" || status === "paused") && openTradeCount > 0 ? (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => onLifecycleAction(focusedSession, "stop")}
            className={stopWhenFlatButtonClass}
            disabled={actionSessionId === focusedSession.id}
          >
            Stop when flat
          </Button>
          <HelpTooltip topic="Stop when flat" glossaryId="stop-when-flat" />
        </div>
      ) : null}
      {(status === "active" ||
        status === "paused" ||
        status === "monitoring_only") &&
      openTradeCount > 0 ? (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => onLifecycleAction(focusedSession, "forceStop")}
            className={forceStopButtonClass}
            disabled={actionSessionId === focusedSession.id}
          >
            Force stop (loses trade management)
          </Button>
          <HelpTooltip glossaryId="force-stop" />
        </div>
      ) : null}
      {status === "stopped" && openTradeCount > 0 ? (
        <div className={orphanWarningClass}>
          Stopped with {openTradeCount} open trade
          {openTradeCount === 1 ? "" : "s"}, no automated exits will fire.
          Restart to resume monitoring.
        </div>
      ) : null}
      {(status === "draft" || status === "idle" || status === "stopped") &&
      onGoToStrategy ? (
        <div className={strategyNudgeBannerClass}>
          <span className="text-[12px] text-[var(--text2)]">
            Configure AI phases, risk limits, and strategy before starting.
          </span>
          <button
            type="button"
            onClick={onGoToStrategy}
            className={strategyNudgeButtonClass}
          >
            Open Strategy →
          </button>
        </div>
      ) : null}
    </div>
  );
};

export const SessionsPage = ({
  initialStatusFilter = "all",
  onInitialStatusFilterApplied,
  onGoToStrategy,
  onGoToAccounts,
  onViewTrace,
}: {
  initialStatusFilter?: SessionStatus | "all";
  onInitialStatusFilterApplied?: () => void;
  onGoToStrategy?: () => void;
  onGoToAccounts?: () => void;
  onViewTrace?: (sessionId: string, cycleId: string, stage: string) => void;
}) => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const preferences = useWorkspaceStore((state) => state.preferences);
  const loadWorkspaceView = useWorkspaceStore(
    (state) => state.loadWorkspaceView,
  );

  const [filters, dispatchFilters] = useReducer<
    Reducer<FiltersState, Partial<FiltersState>>
  >(mergeReducer, {
    search: "",
    statusFilter: "all",
    instrumentFilter: "all",
  });

  const [data, dispatchData] = useReducer<
    Reducer<DataState, Partial<DataState>>
  >(mergeReducer, {
    sessions: [],
    loading: false,
    error: null,
    actionSessionId: null,
    progressBySessionId: {},
    researchFailuresBySessionId: {},
  });

  const [ui, dispatchUi] = useReducer<Reducer<UiState, Partial<UiState>>>(
    mergeReducer,
    {
      detail: null,
      editing: null,
      modalOpen: false,
      templatesOpen: false,
      templateInput: null,
      templateWarnings: [],
      templateSourceSession: null,
      liveReadinessSession: null,
      liveReadinessReport: null,
    },
  );

  // Ref so refreshProgress (useCallback with no data dep) can read latest data
  const dataRef = useRef(data);
  dataRef.current = data;

  const aiReady = useWorkspaceStore((state) => state.focusedSessionAiReady);
  const environmentMode = useWorkspaceStore((state) => state.environmentMode);
  const refreshProgress = useCallback(async (sessionId: string) => {
    try {
      const result = await api.getSessionExecutionProgress(sessionId);
      if (!result.cycleId) {
        dispatchData({
          progressBySessionId: Object.fromEntries(
            Object.entries(dataRef.current.progressBySessionId).filter(
              ([key]) => key !== sessionId,
            ),
          ) as Record<string, SessionProgressState>,
        });
        return;
      }
      const state = deriveProgress(
        result.steps,
        result.cycleId,
        null,
        result.openTradeCount,
        result.monitoringActive,
      );
      if (!state) {
        dispatchData({
          progressBySessionId: Object.fromEntries(
            Object.entries(dataRef.current.progressBySessionId).filter(
              ([key]) => key !== sessionId,
            ),
          ) as Record<string, SessionProgressState>,
        });
        return;
      }
      dispatchData({
        progressBySessionId: {
          ...dataRef.current.progressBySessionId,
          [sessionId]: state,
        },
      });
    } catch {
      // silently ignore
    }
  }, []);

  const load = useCallback(async () => {
    dispatchData({ loading: true, error: null });
    try {
      const result = await api.listSessions({
        search: filters.search.trim() || undefined,
        status:
          filters.statusFilter === "all" ? undefined : filters.statusFilter,
        instrumentClass:
          filters.instrumentFilter === "all"
            ? undefined
            : filters.instrumentFilter,
        includeArchived: preferences?.globalIncludeArchived,
        executionMode:
          environmentMode === "live" ? "live_allowed" : "paper_only",
      });
      dispatchData({ sessions: result.sessions });
      await loadWorkspaceView();
      // Seed progress for sessions that may have active execution
      await Promise.all(
        result.sessions.reduce<Array<Promise<void>>>((acc, session) => {
          if (
            session.status === "active" ||
            session.status === "paused" ||
            session.status === "monitoring_only"
          ) {
            acc.push(refreshProgress(session.id));
          }
          return acc;
        }, []),
      );
    } catch (loadError) {
      dispatchData({
        error:
          loadError instanceof Error
            ? loadError.message
            : "Failed to load sessions.",
      });
    } finally {
      dispatchData({ loading: false });
    }
  }, [
    environmentMode,
    filters.instrumentFilter,
    filters.search,
    filters.statusFilter,
    loadWorkspaceView,
    preferences?.globalIncludeArchived,
    refreshProgress,
  ]);

  const unsubsRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (initialStatusFilter === "all") return;
    dispatchFilters({ statusFilter: initialStatusFilter });
    onInitialStatusFilterApplied?.();
  }, [initialStatusFilter, onInitialStatusFilterApplied]);

  useEffect(() => {
    const stepEvents = [
      "step:started",
      "step:succeeded",
      "step:failed",
      "step:retrying",
    ] as const;
    const cleanup: Array<() => void> = [];

    void Promise.all(
      stepEvents.map((eventName) =>
        listenEvent(eventName, (payload) => {
          void refreshProgress((payload as { sessionId: string }).sessionId);
        }),
      ),
    ).then((unsubs) => {
      cleanup.push(...unsubs);
      unsubsRef.current = cleanup;
    });

    return () => {
      for (const unsub of unsubsRef.current) unsub();
      unsubsRef.current = [];
    };
  }, [refreshProgress]);

  useEffect(() => {
    let cancelled = false;
    const cleanup: Array<() => void> = [];

    void listenEvent("trade_opened", (payload) => {
      const data = payload as { sessionId?: string };
      if (cancelled || !data.sessionId) return;
      void refreshProgress(data.sessionId);
    }).then((unsub) => cleanup.push(unsub));

    void listenEvent("trade_closed", (payload) => {
      const data = payload as { sessionId?: string };
      if (cancelled || !data.sessionId) return;
      void refreshProgress(data.sessionId);
      void load();
    }).then((unsub) => cleanup.push(unsub));

    return () => {
      cancelled = true;
      for (const unsub of cleanup) unsub();
    };
  }, [load, refreshProgress]);

  useEffect(() => {
    let cancelled = false;
    const cleanup: Array<() => void> = [];

    void listenEvent("research_phase_failed", (payload) => {
      const evt = payload as {
        sessionId: string;
        phase: string;
        error: string;
      };
      if (cancelled) return;
      dispatchData({
        researchFailuresBySessionId: {
          ...dataRef.current.researchFailuresBySessionId,
          [evt.sessionId]: {
            phase: evt.phase,
            error: evt.error,
            at: new Date().toISOString(),
          },
        },
      });
      void refreshProgress(evt.sessionId);
    }).then((unsub) => cleanup.push(unsub));

    return () => {
      cancelled = true;
      for (const unsub of cleanup) unsub();
    };
  }, [refreshProgress]);

  useEffect(() => {
    void load();
  }, [load]);

  const { focusedSession, activeCount, pausedCount, openTrades } =
    useSessionMetrics(data.sessions, focusedSessionId);

  const runLifecycleAction = useCallback(
    async (session: SessionSummary, action: LifecycleAction) =>
      executeLifecycleAction({
        session,
        action,
        load,
        dispatchData,
        dispatchUi,
      }),
    [dispatchData, dispatchUi, load],
  );

  return renderSessionsPageView({
    viewMode,
    focusedSession,
    data,
    activeCount,
    pausedCount,
    openTrades,
    aiReady,
    onGoToStrategy,
    runLifecycleAction,
    filters,
    preferences,
    dispatchFilters,
    dispatchData,
    loadWorkspaceView,
    refreshProgress,
    onViewTrace,
    dispatchUi,
    load,
    onGoToAccounts,
    ui,
  });
};

type RenderSessionsPageViewArgs = {
  viewMode: string;
  focusedSession: SessionSummary | null;
  data: DataState;
  activeCount: number;
  pausedCount: number;
  openTrades: number;
  aiReady: boolean | null | undefined;
  onGoToStrategy?: () => void;
  runLifecycleAction: (
    session: SessionSummary,
    action: LifecycleAction,
  ) => Promise<void>;
  filters: FiltersState;
  preferences: { globalIncludeArchived?: boolean } | null | undefined;
  dispatchFilters: (patch: Partial<FiltersState>) => void;
  dispatchData: (patch: Partial<DataState>) => void;
  loadWorkspaceView: () => Promise<void>;
  refreshProgress: (sessionId: string) => Promise<void>;
  onViewTrace?: (sessionId: string, cycleId: string, stage: string) => void;
  dispatchUi: (patch: Partial<UiState>) => void;
  load: () => Promise<void>;
  onGoToAccounts?: () => void;
  ui: UiState;
};

const renderSessionsPageView = ({
  viewMode,
  focusedSession,
  data,
  activeCount,
  pausedCount,
  openTrades,
  aiReady,
  onGoToStrategy,
  runLifecycleAction,
  filters,
  preferences,
  dispatchFilters,
  dispatchData,
  loadWorkspaceView,
  refreshProgress,
  onViewTrace,
  dispatchUi,
  load,
  onGoToAccounts,
  ui,
}: RenderSessionsPageViewArgs) => (
  <PageShell>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text3)]">
          Workspace Sessions
        </div>
        <h1 className="m-0 mt-2.5 text-[28px]">Sessions</h1>
        <p className="mt-2 max-w-[640px] text-[13px] text-[var(--text3)]">
          Focus a live trading context, tune its boundary, and turn working
          configurations into reusable templates.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            dispatchUi({
              templateSourceSession: focusedSession,
              templatesOpen: true,
            });
          }}
          variant="outline"
          className={secondaryButtonClass}
        >
          Templates
        </Button>
        <Button
          onClick={async () => {
            dispatchData({ error: null });
            try {
              await api.goGlobal();
              await load();
            } catch (goGlobalError) {
              dispatchData({
                error:
                  goGlobalError instanceof Error
                    ? goGlobalError.message
                    : "Failed to switch to global mode.",
              });
            }
          }}
          variant="outline"
          className={secondaryButtonClass}
          disabled={
            data.sessions.filter((session) => session.status !== "archived")
              .length === 0 || viewMode === "global"
          }
        >
          Go Global
        </Button>
        <Button
          onClick={() => {
            dispatchUi({
              editing: null,
              templateInput: null,
              templateWarnings: [],
              modalOpen: true,
            });
          }}
          variant="ghost"
          className={primaryButtonClass}
        >
          New Session
        </Button>
      </div>
    </div>

    {data.error ? <div className={errorBannerClass}>{data.error}</div> : null}

    <Card accent className="!p-0">
      <div className={contextHeroClass}>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] uppercase tracking-[0.14em] text-[var(--text3)]">
              {viewMode === "global" ? "Global Workspace" : "Focused Session"}
            </span>
            <Badge variant={viewMode === "global" ? "purple" : "blue"}>
              {viewMode}
            </Badge>
            <HelpTooltip
              glossaryId={
                viewMode === "global" ? "view-global" : "view-session-focused"
              }
            />
            {focusedSession ? (
              <div className="flex items-center gap-1">
                <Badge variant={statusVariant(focusedSession.status)}>
                  {formatSessionStatusLabel(focusedSession.status)}
                </Badge>
                <HelpTooltip
                  glossaryId={SESSION_STATUS_HELP_IDS[focusedSession.status]}
                  topic={`${focusedSession.name} status`}
                />
              </div>
            ) : null}
          </div>
          <div className="mt-2.5 text-[24px] font-bold text-[var(--text1)]">
            {focusedSession?.name ?? "Global trade fabric"}
          </div>
          <div className="mt-2 max-w-[700px] text-[14px] leading-relaxed text-[var(--text2)]">
            {focusedSession?.objective ??
              "Aggregate the non-archived sessions, compare posture across them, and choose where the next focused cycle should run."}
          </div>
        </div>

        <div className="grid min-w-[280px] gap-3">
          <div className={contextMetricsClass}>
            <div className="col-span-2 flex items-center gap-1.5 pb-1">
              <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text3)]">
                Metrics
              </span>
              <HelpTooltip glossaryId="session-metrics-scope" />
            </div>
            <ContextMetric
              label="sessions"
              value={String(data.sessions.length)}
            />
            <ContextMetric label="active" value={String(activeCount)} />
            <ContextMetric label="paused" value={String(pausedCount)} />
            <ContextMetric label="open trades" value={String(openTrades)} />
          </div>
          <SessionFocusPanel
            focusedSession={focusedSession}
            actionSessionId={data.actionSessionId}
            aiReady={aiReady}
            onGoToStrategy={onGoToStrategy}
            onLifecycleAction={(session, action) =>
              void runLifecycleAction(session, action)
            }
          />
        </div>
      </div>
    </Card>

    <Card>
      <SessionFilters
        search={filters.search}
        statusFilter={filters.statusFilter}
        instrumentFilter={filters.instrumentFilter}
        includeArchived={preferences?.globalIncludeArchived ?? false}
        onSearchChange={(value) => dispatchFilters({ search: value })}
        onStatusChange={(value) => dispatchFilters({ statusFilter: value })}
        onInstrumentChange={(value) =>
          dispatchFilters({ instrumentFilter: value })
        }
        onIncludeArchivedChange={async () => {
          dispatchData({ error: null });
          await loadWorkspaceView();
        }}
      />

      {data.loading ? (
        <div className={emptyStateClass}>Loading sessions…</div>
      ) : null}
      {!data.loading && data.sessions.length === 0 ? (
        <div className={emptyStateClass}>
          <div className="mb-2 text-[15px] font-semibold text-[var(--text1)]">
            {filters.search ||
            filters.statusFilter !== "all" ||
            filters.instrumentFilter !== "all"
              ? "No sessions matched the current filters"
              : "No sessions yet"}
          </div>
          <p className="mx-auto max-w-[420px] text-[13px] leading-relaxed text-[var(--text2)]">
            {filters.search ||
            filters.statusFilter !== "all" ||
            filters.instrumentFilter !== "all"
              ? "Try clearing filters or include archived sessions."
              : "Create a session by choosing an experience and signal source, then assign broker accounts for execution."}
          </p>
        </div>
      ) : null}
      {!data.loading && data.sessions.length > 0 ? (
        <SessionTable
          sessions={data.sessions}
          busySessionId={data.actionSessionId}
          focusedSessionAiReady={aiReady}
          progressBySessionId={data.progressBySessionId}
          researchFailuresBySessionId={data.researchFailuresBySessionId}
          onRetryStep={async (sessionId, cycleId, stage) => {
            try {
              await api.retrySessionStep({ sessionId, cycleId, stage });
              void refreshProgress(sessionId);
            } catch (retryError) {
              dispatchData({
                error:
                  retryError instanceof Error
                    ? retryError.message
                    : "Retry failed.",
              });
            }
          }}
          onViewTrace={(sessionId, cycleId, stage) => {
            if (onViewTrace) {
              onViewTrace(sessionId, cycleId, stage);
            } else {
              const match = data.sessions.find((s) => s.id === sessionId);
              if (match) dispatchUi({ detail: match });
            }
          }}
          onPauseAfterStep={async (sessionId) => {
            try {
              if (!data.sessions.find((s) => s.id === sessionId)?.isFocused) {
                await api.focusSession(sessionId);
              }
              await api.pauseSessionAfterCurrentStep(sessionId);
            } catch (pauseError) {
              dispatchData({
                error:
                  pauseError instanceof Error
                    ? pauseError.message
                    : "Pause after step failed.",
              });
            }
          }}
          onFocus={async (id) => {
            dispatchData({ error: null });
            try {
              await api.focusSession(id);
              await load();
            } catch (focusError) {
              dispatchData({
                error:
                  focusError instanceof Error
                    ? focusError.message
                    : "Failed to focus session.",
              });
            }
          }}
          onEdit={(session) => {
            dispatchUi({
              editing: session,
              templateInput: null,
              templateWarnings: [],
              modalOpen: true,
            });
          }}
          onOpen={(session) => dispatchUi({ detail: session })}
          onDuplicate={async (session) => {
            dispatchData({ actionSessionId: session.id, error: null });
            try {
              await api.duplicateSession(session.id, `${session.name} Copy`);
              await load();
            } catch (duplicateError) {
              dispatchData({
                error:
                  duplicateError instanceof Error
                    ? duplicateError.message
                    : "Failed to duplicate session.",
              });
            } finally {
              dispatchData({ actionSessionId: null });
            }
          }}
          onArchive={async (id) => {
            dispatchData({ actionSessionId: id, error: null });
            try {
              await api.archiveSession(id);
              await load();
            } catch (archiveError) {
              dispatchData({
                error:
                  archiveError instanceof Error
                    ? archiveError.message
                    : "Failed to archive session.",
              });
            } finally {
              dispatchData({ actionSessionId: null });
            }
          }}
          onSaveTemplate={(session) => {
            dispatchUi({
              templateSourceSession: session,
              templatesOpen: true,
            });
          }}
          onLifecycle={(session, action) => {
            void runLifecycleAction(session, action);
          }}
        />
      ) : null}
    </Card>

    <CreateEditSessionModal
      open={ui.modalOpen}
      initialSession={ui.editing}
      templateInput={ui.templateInput}
      templateWarnings={ui.templateWarnings}
      onOpenAccounts={onGoToAccounts}
      onClose={() => dispatchUi({ modalOpen: false })}
      onSubmit={async (input, sessionId) => {
        if (sessionId) {
          await api.updateSession(sessionId, input);
        } else {
          await api.createSession(input);
        }
        await load();
      }}
    />
    <SessionTemplatesModal
      open={ui.templatesOpen}
      sourceSession={ui.templateSourceSession}
      onClose={() => dispatchUi({ templatesOpen: false })}
      onUseTemplate={(input, clearedFields) => {
        dispatchUi({
          templateInput: input,
          templateWarnings: clearedFields,
          editing: null,
          modalOpen: true,
        });
      }}
    />
    {ui.liveReadinessSession && ui.liveReadinessReport ? (
      <LiveReadinessModal
        sessionId={ui.liveReadinessSession.id}
        report={ui.liveReadinessReport}
        onAcknowledged={async () => {
          const sess = ui.liveReadinessSession;
          if (!sess) return;
          dispatchUi({
            liveReadinessReport: null,
            liveReadinessSession: null,
          });
          await runLifecycleAction(sess, "start");
        }}
        onCancel={() => {
          dispatchUi({
            liveReadinessReport: null,
            liveReadinessSession: null,
          });
        }}
      />
    ) : null}
    <SessionDetailDrawer
      session={ui.detail}
      onClose={() => dispatchUi({ detail: null })}
    />
  </PageShell>
);

const ContextMetric = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-[12px] uppercase tracking-[0.12em] text-[var(--text3)]">
      {label}
    </div>
    <div className="mt-1 text-[18px] font-bold text-[var(--text1)]">
      {value}
    </div>
  </div>
);

function formatSessionStatusLabel(status: SessionStatus): string {
  if (status === "monitoring_only") return "Stopping when flat";
  if (status === "attention_required") return "Needs attention";
  return status;
}

function statusVariant(
  status: SessionStatus,
): "default" | "success" | "warn" | "danger" | "purple" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warn";
    case "monitoring_only":
      return "warn";
    case "attention_required":
      return "danger";
    case "archived":
      return "danger";
    case "stopped":
      return "purple";
    default:
      return "default";
  }
}

const contextHeroClass =
  "grid gap-[18px] bg-[var(--surface)] p-6 [grid-template-columns:minmax(0,1.4fr)_minmax(280px,0.9fr)]";
const contextMetricsClass =
  "grid grid-cols-2 gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5";
const toolbarClass =
  "mb-[18px] flex flex-wrap items-center justify-between gap-2.5";
const inputClass =
  "rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5 text-[var(--text1)]";
const emptyStateClass =
  "rounded-2xl border border-dashed border-[var(--border)] p-7 text-center text-[var(--text3)]";
const secondaryButtonClass =
  "cursor-pointer rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-[13px] py-2.5 text-[var(--text2)]";
const primaryButtonClass =
  "cursor-pointer rounded-[10px] border-none bg-[var(--accent)] px-[13px] py-2.5 text-[hsl(var(--primary-foreground))]";
const dangerButtonClass =
  "cursor-pointer rounded-[10px] border border-error-border bg-error-dim px-[13px] py-2.5 text-error";
const forceStopButtonClass = dangerButtonClass;
const stopWhenFlatButtonClass =
  "cursor-pointer rounded-[10px] border border-status-orange-border bg-status-orange-dim px-[13px] py-2.5 font-semibold text-status-orange";
const drainBannerClass =
  "mt-2 w-full rounded-lg border border-status-orange-border bg-status-orange-dim px-3 py-2.5 text-[12px] leading-[1.45] text-status-orange";
const orphanWarningClass = drainBannerClass;
const disabledStartClass =
  "cursor-not-allowed bg-[var(--surface3)] text-[var(--text3)] opacity-45";
const strategyNudgeBannerClass =
  "mt-2.5 flex items-center justify-between gap-2.5 rounded-lg border border-info-border bg-info-dim px-3 py-[9px]";
const strategyNudgeButtonClass =
  "cursor-pointer whitespace-nowrap rounded-lg border border-info-border bg-info-dim px-3 py-[5px] text-[12px] font-semibold text-info";
const errorBannerClass =
  "rounded-xl border border-error-border bg-error-dim p-3 px-3.5 text-[13px] text-error";
