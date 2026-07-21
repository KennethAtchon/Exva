import {
  type Reducer,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { formatTimestamp } from "@/lib/format";
import { Badge, Dot, ShadcnSelect } from "@/components/custom-ui";
import {
  Button,
  Checkbox,
  EmptyState,
  HelpTooltip,
  SearchInput,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { confirm } from "@/components/ui/confirm-dialog";
import { PanelLoading } from "@/components/ui/skeleton";
import {
  SessionExecutionProgress,
  deriveProgress,
  type SessionProgressState,
} from "@/components/sessions/SessionExecutionProgress";
import { TradesPage } from "./trades-panel";
import { StrategyConfig } from "./strategy-config-panel";
import {
  api,
  listenEvent,
  type SessionCreateInput,
  type SessionSummary,
} from "@/lib/exva";
import type { InstrumentClass, SessionStatus } from "@/lib/types";
import type {
  SessionActivityConditionKind,
  SessionActivityMonitoringHealth,
  SessionActivitySeverity,
  SessionActivitySnapshot,
} from "@electron/shared/domain/session-activity";
import type { SessionActivityAnalytics } from "@electron/shared/domain/session-activity-analytics";
import { MOCK_REHEARSAL_SIGNAL_SOURCE_ID } from "@electron/shared/instruments/mock-rehearsal";
import { CreateEditSessionModal } from "@/components/sessions/CreateEditSessionModal";
import { LiveReadinessModal } from "@/components/sessions/LiveReadinessModal";
import { SessionDetailDrawer } from "@/components/sessions/SessionDetailDrawer";
import { SessionTemplatesModal } from "@/components/sessions/SessionTemplatesModal";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { SESSION_STATUS_HELP_IDS } from "@/lib/help-glossary";
import { useControlStore } from "@/store/controlStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

const ACTIVITY_POLL_MS = 30_000;

const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

function activityBySessionId(
  rows: SessionActivitySnapshot[],
): Record<string, SessionActivitySnapshot> {
  return Object.fromEntries(rows.map((row) => [row.sessionId, row]));
}

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
  notice: string | null;
  actionSessionId: string | null;
  progressBySessionId: Record<string, SessionProgressState>;
  researchFailuresBySessionId: Record<
    string,
    { phase: string; error: string; at: string }
  >;
  activityBySessionId: Record<string, SessionActivitySnapshot>;
  activityMonitoring: SessionActivityMonitoringHealth | null;
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
        await load();
        return;
      }
    }
    if (action === "start") await api.startSession();
    if (action === "pause") await api.pauseSession();
    if (action === "resume") await api.resumeSession();
    if (action === "stop") await api.stopSession();
    if (action === "forceStop") {
      const ok = await confirm({
        title: "Force stop session?",
        description: FORCE_STOP_CONFIRM_MESSAGE,
        confirmLabel: "Force stop",
        variant: "destructive",
      });
      if (!ok) {
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

export type SessionsTab = "run" | "activity" | "trades" | "config";

const SessionListFilters = ({
  statusFilter,
  onStatusChange,
}: {
  statusFilter: SessionStatus | "all";
  onStatusChange: (value: SessionStatus | "all") => void;
}) => (
  <div className="border-t border-border px-3 py-2">
    <HelpTooltip glossaryId="status-filter">
      <ShadcnSelect
        value={statusFilter}
        onValueChange={(value) =>
          onStatusChange(value as SessionStatus | "all")
        }
        className="w-full"
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
    </HelpTooltip>
  </div>
);

function activityChipVariant(
  severity: SessionActivitySeverity,
): "danger" | "warn" | "success" | "default" {
  switch (severity) {
    case "error":
      return "danger";
    case "warn":
    case "attention":
      return "warn";
    case "info":
      return "success";
    default:
      return "default";
  }
}

function activityDotColor(
  isActive: boolean,
  status: SessionSummary["status"],
  severity: SessionActivitySeverity | undefined,
): string {
  switch (severity) {
    case "error":
      return "var(--color-error)";
    case "warn":
    case "attention":
      return "var(--color-warning)";
    case "info":
      return "var(--color-success)";
  }
  if (isActive) return "var(--color-success)";
  if (status === "attention_required") return "var(--color-error)";
  return "var(--text3)";
}

const SEVERITY_RANK: Record<SessionActivitySeverity, number> = {
  info: 0,
  attention: 1,
  warn: 2,
  error: 3,
};

const SessionListCard = ({
  session,
  progressPct,
  activity,
  onSelect,
}: {
  session: SessionSummary;
  progressPct: number | null;
  activity: SessionActivitySnapshot | undefined;
  onSelect: (id: string) => void;
}) => {
  const isActive = session.status === "active";
  const envLabel = session.executionMode === "live_allowed" ? "live" : "paper";
  const worstCondition = activity?.conditions.reduce<
    SessionActivitySnapshot["conditions"][number] | undefined
  >(
    (worst, condition) =>
      !worst || SEVERITY_RANK[condition.severity] > SEVERITY_RANK[worst.severity]
        ? condition
        : worst,
    undefined,
  );

  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      className={cn(
        "w-full rounded-sm border px-3 py-2.5 text-left transition-colors duration-hover",
        session.isFocused
          ? "border-info-border bg-info-dim"
          : "border-border bg-surface hover:bg-surface2",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-sans text-label text-text1">
          {session.name}
        </span>
        <Dot
          color={activityDotColor(
            isActive,
            session.status,
            worstCondition?.severity,
          )}
          pulse={isActive && worstCondition?.severity !== "error"}
          size={6}
        />
      </div>
      <div className="mt-1 flex items-center gap-2 font-mono text-micro text-text3">
        <span className="uppercase">{envLabel}</span>
        <span>·</span>
        <span>{session.openTradeCount} open</span>
        {worstCondition ? (
          <Badge variant={activityChipVariant(worstCondition.severity)} size="sm">
            {worstCondition.kind.replace(/_/g, " ")}
          </Badge>
        ) : activity?.activity ? (
          <span className="truncate text-text3">{activity.activity}</span>
        ) : null}
      </div>
      <div className="mt-2 flex h-3 items-end gap-0.5">
        {[0.25, 0.45, 0.65, 0.85].map((height, index) => (
          <span
            key={index}
            className={cn(
              "w-2 rounded-sm bg-surface3",
              isActive && "bg-success/40",
              session.isFocused && isActive && "bg-success/60",
            )}
            style={{
              height: `${Math.round(height * (progressPct != null ? Math.max(0.35, progressPct / 100) : 1) * 12)}px`,
            }}
          />
        ))}
      </div>
    </button>
  );
};

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
    <div className="flex flex-wrap gap-2">
      {status === "draft" || status === "idle" || status === "stopped" ? (
        <HelpTooltip
          topic="Start session"
          body={
            aiReady === false
              ? "AI providers are not connected yet. Configure them on the Strategy page before starting."
              : "Starts signal processing and new research cycles for the focused session."
          }
        >
          <Button
            variant="primary"
            size="sm"
            onClick={() => onLifecycleAction(focusedSession, "start")}
            disabled={
              actionSessionId === focusedSession.id || aiReady === false
            }
          >
            Start
          </Button>
        </HelpTooltip>
      ) : null}
      {status === "active" ? (
        <HelpTooltip
          topic="Pause session"
          body="Pause stops new research but keeps exits and open-position monitoring active."
        >
          <Button
            variant="warning"
            size="sm"
            onClick={() => onLifecycleAction(focusedSession, "pause")}
            disabled={actionSessionId === focusedSession.id}
          >
            Pause
          </Button>
        </HelpTooltip>
      ) : null}
      {status === "paused" ? (
        <HelpTooltip glossaryId="resume-session">
          <Button
            variant="primary"
            size="sm"
            onClick={() => onLifecycleAction(focusedSession, "resume")}
            disabled={actionSessionId === focusedSession.id}
          >
            Resume
          </Button>
        </HelpTooltip>
      ) : null}
      {status === "monitoring_only" ? (
        <div className="w-full rounded-sm border border-warning-border bg-warning-dim px-3 py-2 font-sans text-caption text-warning">
          Stopping when flat: managing {openTradeCount} open trade
          {openTradeCount === 1 ? "" : "s"}. Session stops automatically once
          flat.
        </div>
      ) : null}
      {(status === "active" || status === "paused") && openTradeCount === 0 ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onLifecycleAction(focusedSession, "stop")}
          disabled={actionSessionId === focusedSession.id}
        >
          Stop
        </Button>
      ) : null}
      {(status === "active" || status === "paused") && openTradeCount > 0 ? (
        <HelpTooltip topic="Stop when flat" glossaryId="stop-when-flat">
          <Button
            variant="warning"
            size="sm"
            onClick={() => onLifecycleAction(focusedSession, "stop")}
            disabled={actionSessionId === focusedSession.id}
          >
            Stop when flat
          </Button>
        </HelpTooltip>
      ) : null}
      {(status === "active" ||
        status === "paused" ||
        status === "monitoring_only") &&
      openTradeCount > 0 ? (
        <HelpTooltip glossaryId="force-stop">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onLifecycleAction(focusedSession, "forceStop")}
            disabled={actionSessionId === focusedSession.id}
          >
            Force stop
          </Button>
        </HelpTooltip>
      ) : null}
      {status === "stopped" && openTradeCount > 0 ? (
        <div className="w-full rounded-sm border border-warning-border bg-warning-dim px-3 py-2 font-sans text-caption text-warning">
          Stopped with {openTradeCount} open trade
          {openTradeCount === 1 ? "" : "s"}, no automated exits will fire.
          Restart to resume monitoring.
        </div>
      ) : null}
      {(status === "draft" || status === "idle" || status === "stopped") &&
      onGoToStrategy ? (
        <div className="flex w-full items-center justify-between gap-2 rounded-sm border border-info-border bg-info-dim px-3 py-2">
          <span className="font-sans text-caption text-text2">
            Configure strategy before starting.
          </span>
          <Button variant="secondary" size="sm" onClick={onGoToStrategy}>
            Open config
          </Button>
        </div>
      ) : null}
    </div>
  );
};

const FocusedSessionHeader = ({
  session,
  viewMode,
}: {
  session: SessionSummary | null;
  viewMode: string;
}) => {
  if (!session) {
    return (
      <div className="border-b border-border px-5 py-4">
        <div className="font-sans text-head text-text1">Global workspace</div>
        <p className="mt-1 mb-0 font-sans text-body text-text2">
          Select a session from the list to focus runtime controls.
        </p>
      </div>
    );
  }

  const envVariant =
    session.executionMode === "live_allowed" ? "success" : "warn";

  return (
    <div className="border-b border-border px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 font-sans text-head text-text1">{session.name}</h2>
        <Badge variant={envVariant}>
          {session.executionMode === "live_allowed" ? "LIVE" : "PAPER"}
        </Badge>
        <HelpTooltip
          glossaryId={SESSION_STATUS_HELP_IDS[session.status]}
          topic={`${session.name} status`}
        >
          <Badge variant={statusVariant(session.status)}>
            {formatSessionStatusLabel(session.status)}
          </Badge>
        </HelpTooltip>
        {viewMode === "global" ? (
          <Badge variant="purple">global view</Badge>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          title="Ask assistant about this session"
          onClick={() =>
            useControlStore.getState().openSlideOver({
              kind: "session",
              sessionId: session.id,
            })
          }
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Ask assistant
        </Button>
      </div>
      {session.objective ? (
        <p className="mt-1 mb-0 max-w-2xl font-sans text-body text-text2">
          {session.objective}
        </p>
      ) : null}
    </div>
  );
};

export type SessionsMasterDetailProps = {
  tab: SessionsTab;
  onTabChange: (tab: SessionsTab) => void;
  initialStatusFilter?: SessionStatus | "all";
  onInitialStatusFilterApplied?: () => void;
  onGoToAccounts?: () => void;
  onViewTrace?: (sessionId: string, cycleId: string, stage: string) => void;
  onViewAutopsy?: (tradeId: string) => void;
};

export const SessionsMasterDetail = ({
  tab,
  onTabChange,
  initialStatusFilter = "all",
  onInitialStatusFilterApplied,
  onGoToAccounts,
  onViewTrace,
  onViewAutopsy,
}: SessionsMasterDetailProps) => {
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
    notice: null,
    actionSessionId: null,
    progressBySessionId: {},
    researchFailuresBySessionId: {},
    activityBySessionId: {},
    activityMonitoring: null,
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
  const handleDebugForceTrade = useCallback(async (session: SessionSummary) => {
    dispatchData({ actionSessionId: session.id, error: null, notice: null });
    try {
      const result = await api.debugForceTrade(session.id);
      dispatchData({
        notice:
          `Force trade submitted: ${result.side} ${result.symbol} ` +
          `($${result.sizeUsd}) via ${result.brokerType} @ ` +
          `${result.filledAvgPrice}. Broker order ${result.brokerOrderId}.`,
      });
    } catch (err) {
      dispatchData({
        error: err instanceof Error ? err.message : "Force trade failed.",
      });
    } finally {
      dispatchData({ actionSessionId: null });
    }
  }, []);
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
        result.workers,
        result.workerPhase ?? null,
        result.workerStageId ?? null,
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
      "pipeline_worker_progress",
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

    async function refreshActivity(): Promise<void> {
      const [rows, health] = await Promise.all([
        api.listSessionActivity(),
        api.getSessionActivityMonitoringHealth(),
      ]);
      if (cancelled) return;
      dispatchData({
        activityBySessionId: activityBySessionId(rows),
        activityMonitoring: health,
      });
    }

    void refreshActivity();
    const timer = window.setInterval(() => void refreshActivity(), ACTIVITY_POLL_MS);
    const onFocus = () => void refreshActivity();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cleanup: Array<() => void> = [];

    void listenEvent("session_activity_changed", (snapshot) => {
      if (cancelled) return;
      dispatchData({
        activityBySessionId: {
          ...dataRef.current.activityBySessionId,
          [snapshot.sessionId]: snapshot,
        },
      });
    }).then((unsub) => cleanup.push(unsub));

    return () => {
      cancelled = true;
      for (const unsub of cleanup) unsub();
    };
  }, []);

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

    void listenEvent("signal_received", () => {
      if (cancelled) return;
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

  const handleFocusSession = useCallback(
    async (id: string) => {
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
    },
    [load],
  );

  const filteredSessions = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return data.sessions.filter((session) => {
      if (query) {
        const haystack = `${session.name} ${session.objective}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (
        filters.instrumentFilter !== "all" &&
        !session.instrumentClasses.includes(filters.instrumentFilter)
      ) {
        return false;
      }
      return true;
    });
  }, [data.sessions, filters.instrumentFilter, filters.search]);

  const runTabSession = focusedSession;

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="font-mono text-micro uppercase tracking-wider text-text3">
            Sessions
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                dispatchUi({
                  templateSourceSession: focusedSession,
                  templatesOpen: true,
                });
              }}
            >
              Templates
            </Button>
            <Button
              variant="ghost"
              size="sm"
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
              disabled={
                data.sessions.filter((session) => session.status !== "archived")
                  .length === 0 || viewMode === "global"
              }
            >
              Global
            </Button>
          </div>
        </div>

        <div className="border-b border-border px-3 py-2">
          <SearchInput
            value={filters.search}
            onValueChange={(value) => dispatchFilters({ search: value })}
            placeholder="Search sessions"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {data.loading ? <PanelLoading className="p-2" rows={4} /> : null}
          {!data.loading && filteredSessions.length === 0 ? (
            <EmptyState
              title={
                filters.search ||
                filters.statusFilter !== "all" ||
                filters.instrumentFilter !== "all"
                  ? "No matching sessions"
                  : "No sessions yet"
              }
              message={
                filters.search ||
                filters.statusFilter !== "all" ||
                filters.instrumentFilter !== "all"
                  ? "Clear filters or search to see more sessions."
                  : "Create a session to start paper trading. The pipeline runs while a session is active."
              }
              actionLabel="New session"
              onAction={() => {
                dispatchUi({
                  editing: null,
                  templateInput: null,
                  templateWarnings: [],
                  modalOpen: true,
                });
              }}
              className="border-0 bg-transparent p-2"
            />
          ) : null}
          <div className="grid gap-2">
            {filteredSessions.map((session) => (
              <SessionListCard
                key={session.id}
                session={session}
                progressPct={
                  data.progressBySessionId[session.id]?.progressPct ?? null
                }
                activity={data.activityBySessionId[session.id]}
                onSelect={(id) => void handleFocusSession(id)}
              />
            ))}
          </div>
        </div>

        <Button
          variant="secondary"
          className="mx-3 mb-2"
          onClick={() => {
            dispatchUi({
              editing: null,
              templateInput: null,
              templateWarnings: [],
              modalOpen: true,
            });
          }}
        >
          + New session
        </Button>

        <SessionListFilters
          statusFilter={filters.statusFilter}
          onStatusChange={(value) => dispatchFilters({ statusFilter: value })}
        />

        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <Checkbox
            checked={preferences?.globalIncludeArchived ?? false}
            onCheckedChange={async (checked) => {
              dispatchData({ error: null });
              try {
                await api.patchWorkspacePreferences({
                  globalIncludeArchived: checked === true,
                });
                await loadWorkspaceView();
              } catch (prefsError) {
                dispatchData({
                  error:
                    prefsError instanceof Error
                      ? prefsError.message
                      : "Failed to update archived filter.",
                });
              }
            }}
          />
          <span className="font-sans text-caption text-text2">
            Include archived
          </span>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
        {data.activityMonitoring && !data.activityMonitoring.healthy ? (
          <div className="border-b border-warning-border bg-warning-dim px-5 py-2 font-sans text-body text-warning">
            {data.activityMonitoring.message ??
              "Session activity monitoring unavailable."}
          </div>
        ) : null}
        {data.error ? (
          <div className="border-b border-error-border bg-error-dim px-5 py-2 font-sans text-body text-error">
            {data.error}
          </div>
        ) : null}
        {data.notice ? (
          <div className="border-b border-success-border bg-success-dim px-5 py-2 font-sans text-body text-success">
            {data.notice}
          </div>
        ) : null}

        <FocusedSessionHeader session={runTabSession} viewMode={viewMode} />

        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as SessionsTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="shrink-0 px-5">
            <TabsTrigger value="run">Run</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="trades">Trades</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
          </TabsList>

          <TabsContent
            value="run"
            className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 pb-5 data-[state=inactive]:hidden"
          >
            {!runTabSession ? (
              <EmptyState
                title="No session selected"
                message="Select a session from the list to view pipeline trace and controls."
                className="mt-4"
              />
            ) : (
              <SessionRunTab
                session={runTabSession}
                aiReady={aiReady}
                actionSessionId={data.actionSessionId}
                progress={data.progressBySessionId[runTabSession.id] ?? null}
                researchFailure={
                  data.researchFailuresBySessionId[runTabSession.id] ?? null
                }
                onGoToConfig={() => onTabChange("config")}
                onLifecycleAction={(session, action) =>
                  void runLifecycleAction(session, action)
                }
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
                    dispatchUi({ detail: runTabSession });
                  }
                }}
                onPauseAfterStep={async (sessionId) => {
                  try {
                    if (!runTabSession.isFocused) {
                      await api.focusSession(sessionId);
                      await load();
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
                onEdit={() => {
                  dispatchUi({
                    editing: runTabSession,
                    templateInput: null,
                    templateWarnings: [],
                    modalOpen: true,
                  });
                }}
                onDuplicate={async () => {
                  dispatchData({
                    actionSessionId: runTabSession.id,
                    error: null,
                  });
                  try {
                    await api.duplicateSession(
                      runTabSession.id,
                      `${runTabSession.name} Copy`,
                    );
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
                onArchive={async () => {
                  dispatchData({
                    actionSessionId: runTabSession.id,
                    error: null,
                  });
                  try {
                    await api.archiveSession(runTabSession.id);
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
                onFireRehearsalSignal={async () => {
                  dispatchData({
                    actionSessionId: runTabSession.id,
                    error: null,
                  });
                  try {
                    const mockSourceId =
                      runTabSession.subscribedSources.find(
                        (source) => source.type === "mock",
                      )?.id ?? MOCK_REHEARSAL_SIGNAL_SOURCE_ID;
                    await api.testSignalSource(mockSourceId);
                    await load();
                  } catch (fireError) {
                    dispatchData({
                      error:
                        fireError instanceof Error
                          ? fireError.message
                          : "Failed to fire rehearsal signal.",
                    });
                  } finally {
                    dispatchData({ actionSessionId: null });
                  }
                }}
                onDebugForceTrade={
                  environmentMode === "paper"
                    ? () => void handleDebugForceTrade(runTabSession)
                    : undefined
                }
                activeCount={activeCount}
                pausedCount={pausedCount}
                openTrades={openTrades}
              />
            )}
          </TabsContent>

          <TabsContent
            value="activity"
            className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 pb-5 data-[state=inactive]:hidden"
          >
            {!runTabSession ? (
              <EmptyState
                title="No session selected"
                message="Select a session from the list to view its activity timeline."
                className="mt-4"
              />
            ) : (
              <SessionActivityTab sessionId={runTabSession.id} />
            )}
          </TabsContent>

          <TabsContent
            value="trades"
            className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
          >
            <TradesPage
              embedded
              onViewAutopsy={onViewAutopsy ?? (() => undefined)}
            />
          </TabsContent>

          <TabsContent
            value="config"
            className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
          >
            <StrategyConfig
              embedded
              onGoToSessions={() => onTabChange("run")}
            />
          </TabsContent>
        </Tabs>
      </main>

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
        onFireRehearsalSignal={async (session) => {
          dispatchData({ actionSessionId: session.id, error: null });
          try {
            const mockSourceId =
              session.subscribedSources.find((source) => source.type === "mock")
                ?.id ?? MOCK_REHEARSAL_SIGNAL_SOURCE_ID;
            await api.testSignalSource(mockSourceId);
            await load();
          } catch (fireError) {
            dispatchData({
              error:
                fireError instanceof Error
                  ? fireError.message
                  : "Failed to fire rehearsal signal.",
            });
          } finally {
            dispatchData({ actionSessionId: null });
          }
        }}
        onDebugForceTrade={
          environmentMode === "paper" ? handleDebugForceTrade : undefined
        }
      />
    </div>
  );
};

const SessionRunTab = ({
  session,
  aiReady,
  actionSessionId,
  progress,
  researchFailure,
  onGoToConfig,
  onLifecycleAction,
  onRetryStep,
  onViewTrace,
  onPauseAfterStep,
  onEdit,
  onDuplicate,
  onArchive,
  onFireRehearsalSignal,
  onDebugForceTrade,
  activeCount,
  pausedCount,
  openTrades,
}: {
  session: SessionSummary;
  aiReady: boolean | null | undefined;
  actionSessionId: string | null;
  progress: SessionProgressState | null;
  researchFailure: { phase: string; error: string; at: string } | null;
  onGoToConfig: () => void;
  onLifecycleAction: (session: SessionSummary, action: LifecycleAction) => void;
  onRetryStep: (
    sessionId: string,
    cycleId: string,
    stage: import("@/lib/types").ExecutionStage,
  ) => void;
  onViewTrace: (
    sessionId: string,
    cycleId: string,
    stage: import("@/lib/types").ExecutionStage,
  ) => void;
  onPauseAfterStep: (sessionId: string) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onFireRehearsalSignal: () => void;
  onDebugForceTrade?: () => void;
  activeCount: number;
  pausedCount: number;
  openTrades: number;
}) => (
  <div className="mt-4 flex flex-col gap-4">
    <div className="grid gap-3 rounded-sm border border-border bg-surface2 p-4 sm:grid-cols-4">
      <RunMetric label="Active" value={String(activeCount)} />
      <RunMetric label="Paused" value={String(pausedCount)} />
      <RunMetric label="Open trades" value={String(openTrades)} />
      <RunMetric
        label="Allocated"
        value={`$${session.totalAllocatedUsd.toLocaleString()}`}
      />
    </div>

    <SessionFocusPanel
      focusedSession={session}
      actionSessionId={actionSessionId}
      aiReady={aiReady}
      onGoToStrategy={onGoToConfig}
      onLifecycleAction={onLifecycleAction}
    />

    <div className="rounded-sm border border-border bg-surface p-4">
      <div className="mb-3 font-mono text-micro uppercase tracking-wider text-text3">
        Pipeline trace
      </div>
      <SessionExecutionProgress
        sessionId={session.id}
        progress={progress}
        onRetry={onRetryStep}
        onViewTrace={onViewTrace}
        onPauseAfterStep={onPauseAfterStep}
      />
      {!progress ? (
        <p className="font-sans text-body text-text3">
          No active cycle. Start the session to run the pipeline.
        </p>
      ) : null}
      {researchFailure ? (
        <p className="mt-2 font-sans text-caption text-error">
          Research phase failed ({researchFailure.phase}):{" "}
          {researchFailure.error}
        </p>
      ) : null}
    </div>

    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={onEdit}>
        Edit session
      </Button>
      <Button variant="secondary" size="sm" onClick={onDuplicate}>
        Duplicate
      </Button>
      <Button variant="secondary" size="sm" onClick={onArchive}>
        Archive
      </Button>
      {session.canFireRehearsalSignal ? (
        <Button variant="secondary" size="sm" onClick={onFireRehearsalSignal}>
          Fire rehearsal signal
        </Button>
      ) : null}
      {onDebugForceTrade ? (
        <Button variant="secondary" size="sm" onClick={onDebugForceTrade}>
          Force trade
        </Button>
      ) : null}
    </div>
  </div>
);

function formatDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

type ConditionFrequencyRow = {
  kind: string;
  count: number;
  timeMs: number;
};

function topConditionFrequencyRows(
  analytics: SessionActivityAnalytics,
  limit = 8,
): ConditionFrequencyRow[] {
  return Object.entries(analytics.conditionFrequency)
    .map(([kind, count]) => ({
      kind,
      count: count ?? 0,
      timeMs:
        analytics.timeInConditionMs[kind as SessionActivityConditionKind] ?? 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function ActivityAnalyticsCard({
  analytics,
}: {
  analytics: SessionActivityAnalytics;
}) {
  const frequencyRows = topConditionFrequencyRows(analytics);
  const maxFrequency = frequencyRows[0]?.count ?? 1;

  return (
    <div className="grid gap-3 rounded-sm border border-border bg-surface p-3">
      <div className="font-sans text-label text-text1">Activity analytics</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <RunMetric
          label="Transitions"
          value={String(analytics.transitionCount)}
        />
        <RunMetric label="Error clears" value={String(analytics.errorClears)} />
        <RunMetric
          label="Avg error duration"
          value={formatDurationMs(analytics.avgErrorDurationMs)}
        />
        <RunMetric
          label="Error events"
          value={String(analytics.severityCounts.error)}
        />
      </div>
      {frequencyRows.length > 0 ? (
        <div className="grid gap-1.5">
          <div className="font-mono text-micro uppercase tracking-wider text-text3">
            Condition frequency
          </div>
          {frequencyRows.map((row) => (
            <div
              key={row.kind}
              className="grid grid-cols-[9rem_1fr_auto] items-center gap-2"
            >
              <span className="truncate font-mono text-micro text-text2">
                {row.kind.replace(/_/g, " ")}
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface3">
                <div
                  className="h-full rounded-full bg-info"
                  style={{
                    width: `${Math.max(8, (row.count / maxFrequency) * 100)}%`,
                  }}
                />
              </div>
              <span className="whitespace-nowrap font-mono text-micro text-text3">
                {row.count}× · {formatDurationMs(row.timeMs)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const SessionActivityTab = ({ sessionId }: { sessionId: string }) => {
  const [transitions, setTransitions] = useState<SessionActivitySnapshot[]>([]);
  const [analytics, setAnalytics] = useState<SessionActivityAnalytics | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const [rows, stats] = await Promise.all([
        api.listSessionActivityTransitions(id),
        api.getSessionActivityAnalytics(id),
      ]);
      setTransitions(rows);
      setAnalytics(stats);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(sessionId);
  }, [sessionId, load]);

  useExvaEvent("session_activity_changed", (snapshot) => {
    if (snapshot.sessionId === sessionId) void load(sessionId);
  });

  if (loading && transitions.length === 0) {
    return <div className="mt-4 px-1 text-body text-text3">Loading...</div>;
  }
  if (transitions.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        message="Timeline entries appear once this session starts a cycle, receives a signal, or a condition is detected."
        className="mt-4"
      />
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4 px-1 pb-5">
      {analytics ? <ActivityAnalyticsCard analytics={analytics} /> : null}

      <div className="flex flex-col gap-2">
        <div className="font-sans text-label text-text1">Transition timeline</div>
        {transitions.map((entry, i) => (
          <div
            key={`${entry.updatedAt}-${i}`}
            className="rounded-sm border border-border bg-surface p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-sans text-body text-text1">
                {entry.activity}
              </span>
              <span className="whitespace-nowrap font-mono text-micro text-text3">
                {formatTimestamp(entry.updatedAt)}
              </span>
            </div>
            {entry.conditions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {entry.conditions.map((condition) => (
                  <Badge
                    key={condition.kind}
                    variant={activityChipVariant(condition.severity)}
                    size="sm"
                  >
                    {condition.kind.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};

const RunMetric = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="font-mono text-micro uppercase tracking-wider text-text3">
      {label}
    </div>
    <div className="mt-1 font-mono text-stat tabular-nums text-text1">
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
