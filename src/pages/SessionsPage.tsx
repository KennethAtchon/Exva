import {
  type Reducer,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { Badge, Card, PageShell, ShadcnSelect } from "@/components/custom-ui";
import { Button, Checkbox } from "@/components/ui";
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
import { useWorkspaceStore } from "@/store/workspaceStore";

const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

type LifecycleAction = "start" | "pause" | "resume" | "stop" | "forceStop";

const FORCE_STOP_CONFIRM_MESSAGE =
  "Force stop will end automated exit management for open positions. Continue?";

const STOP_WHEN_FLAT_TITLE =
  "Stops new research immediately and completes shutdown once all open trades close.";

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
  <div style={toolbarStyle}>
    <input
      value={search}
      onChange={(event) => onSearchChange(event.target.value)}
      placeholder="Search by name or objective"
      style={{ ...inputStyle, flex: 1 }}
    />
    <ShadcnSelect
      value={statusFilter}
      onValueChange={(value) => onStatusChange(value as SessionStatus | "all")}
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "var(--text2)",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
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
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        justifyContent: "flex-end",
      }}
    >
      {status === "draft" || status === "idle" || status === "stopped" ? (
        <Button
          variant="ghost"
          onClick={() => onLifecycleAction(focusedSession, "start")}
          style={{
            ...primaryButtonStyle,
            ...(aiReady === false ? disabledStartStyle : {}),
          }}
          disabled={actionSessionId === focusedSession.id || aiReady === false}
          title={
            aiReady === false
              ? "AI providers not connected — configure in Strategy tab before starting"
              : undefined
          }
        >
          Start
        </Button>
      ) : null}
      {status === "active" ? (
        <Button
          variant="outline"
          onClick={() => onLifecycleAction(focusedSession, "pause")}
          style={secondaryButtonStyle}
          disabled={actionSessionId === focusedSession.id}
          title="Pause stops new research but keeps exits managed."
        >
          Pause
        </Button>
      ) : null}
      {status === "paused" ? (
        <Button
          variant="ghost"
          onClick={() => onLifecycleAction(focusedSession, "resume")}
          style={primaryButtonStyle}
          disabled={actionSessionId === focusedSession.id}
        >
          Resume
        </Button>
      ) : null}
      {status === "monitoring_only" ? (
        <div style={drainBannerStyle}>
          Stopping when flat: managing {openTradeCount} open trade
          {openTradeCount === 1 ? "" : "s"}. Session stops automatically once
          flat.
        </div>
      ) : null}
      {(status === "active" || status === "paused") && openTradeCount === 0 ? (
        <Button
          variant="ghost"
          onClick={() => onLifecycleAction(focusedSession, "stop")}
          style={dangerButtonStyle}
          disabled={actionSessionId === focusedSession.id}
        >
          Stop
        </Button>
      ) : null}
      {(status === "active" || status === "paused") && openTradeCount > 0 ? (
        <Button
          variant="ghost"
          onClick={() => onLifecycleAction(focusedSession, "stop")}
          style={stopWhenFlatButtonStyle}
          disabled={actionSessionId === focusedSession.id}
          title={STOP_WHEN_FLAT_TITLE}
        >
          Stop when flat
        </Button>
      ) : null}
      {(status === "active" ||
        status === "paused" ||
        status === "monitoring_only") &&
      openTradeCount > 0 ? (
        <Button
          variant="ghost"
          onClick={() => onLifecycleAction(focusedSession, "forceStop")}
          style={forceStopButtonStyle}
          disabled={actionSessionId === focusedSession.id}
          title="Force stop ends automated exit management for open positions."
        >
          Force stop (loses trade management)
        </Button>
      ) : null}
      {status === "stopped" && openTradeCount > 0 ? (
        <div style={orphanWarningStyle}>
          Stopped with {openTradeCount} open trade
          {openTradeCount === 1 ? "" : "s"}, no automated exits will fire.
          Restart to resume monitoring.
        </div>
      ) : null}
      {(status === "draft" || status === "idle" || status === "stopped") &&
      onGoToStrategy ? (
        <div style={strategyNudgeBannerStyle}>
          <span style={{ color: "var(--text2)", fontSize: 12 }}>
            Configure AI phases, risk limits, and strategy before starting.
          </span>
          <button
            type="button"
            onClick={onGoToStrategy}
            style={strategyNudgeButtonStyle}
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

  const focusedSession = useMemo(
    () =>
      data.sessions.find((session) => session.id === focusedSessionId) ?? null,
    [data.sessions, focusedSessionId],
  );
  const activeCount = useMemo(
    () => data.sessions.filter((session) => session.status === "active").length,
    [data.sessions],
  );
  const pausedCount = useMemo(
    () => data.sessions.filter((session) => session.status === "paused").length,
    [data.sessions],
  );
  const openTrades = useMemo(
    () =>
      data.sessions.reduce((sum, session) => sum + session.openTradeCount, 0),
    [data.sessions],
  );

  async function runLifecycleAction(
    session: SessionSummary,
    action: LifecycleAction,
  ) {
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
  }

  return (
    <PageShell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text3)",
            }}
          >
            Workspace Sessions
          </div>
          <h1 style={{ margin: "10px 0 0", fontSize: 28 }}>Sessions</h1>
          <p
            style={{
              marginTop: 8,
              color: "var(--text3)",
              fontSize: 13,
              maxWidth: 640,
            }}
          >
            Focus a live trading context, tune its boundary, and turn working
            configurations into reusable templates.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button
            onClick={() => {
              dispatchUi({
                templateSourceSession: focusedSession,
                templatesOpen: true,
              });
            }}
            variant="outline"
            style={secondaryButtonStyle}
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
            style={secondaryButtonStyle}
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
            style={primaryButtonStyle}
          >
            New Session
          </Button>
        </div>
      </div>

      {data.error ? <div style={errorBannerStyle}>{data.error}</div> : null}

      <Card accent style={{ padding: 0 }}>
        <div style={contextHeroStyle}>
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--text3)",
                }}
              >
                {viewMode === "global" ? "Global Workspace" : "Focused Session"}
              </span>
              <Badge variant={viewMode === "global" ? "purple" : "blue"}>
                {viewMode}
              </Badge>
              {focusedSession ? (
                <Badge variant={statusVariant(focusedSession.status)}>
                  {formatSessionStatusLabel(focusedSession.status)}
                </Badge>
              ) : null}
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 24,
                fontWeight: 700,
                color: "var(--text1)",
              }}
            >
              {focusedSession?.name ?? "Global trade fabric"}
            </div>
            <div
              style={{
                marginTop: 8,
                maxWidth: 700,
                color: "var(--text2)",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              {focusedSession?.objective ??
                "Aggregate the non-archived sessions, compare posture across them, and choose where the next focused cycle should run."}
            </div>
          </div>

          <div style={{ display: "grid", gap: 12, minWidth: 280 }}>
            <div style={contextMetricsStyle}>
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
          <div style={emptyStateStyle}>Loading sessions…</div>
        ) : null}
        {!data.loading && data.sessions.length === 0 ? (
          <div style={emptyStateStyle}>
            No sessions matched the current filters.
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
};

const ContextMetric = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div
      style={{
        fontSize: 12,
        color: "var(--text3)",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
      }}
    >
      {label}
    </div>
    <div
      style={{
        marginTop: 4,
        color: "var(--text1)",
        fontSize: 18,
        fontWeight: 700,
      }}
    >
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

const contextHeroStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 0.9fr)",
  gap: 18,
  padding: 24,
  background:
    "radial-gradient(circle at top left, rgba(96,165,250,0.16), transparent 45%)",
} as const;
const contextMetricsStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
  padding: "14px 16px",
  borderRadius: 16,
  border: "1px solid var(--border)",
  background: "rgba(7,10,15,0.34)",
} as const;
const toolbarStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  marginBottom: 18,
} as const;
const inputStyle = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text1)",
} as const;
const emptyStateStyle = {
  border: "1px dashed var(--border)",
  borderRadius: 16,
  padding: 28,
  color: "var(--text3)",
  textAlign: "center" as const,
};
const secondaryButtonStyle = {
  padding: "10px 13px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text2)",
  cursor: "pointer",
} as const;
const primaryButtonStyle = {
  padding: "10px 13px",
  borderRadius: 10,
  border: "none",
  background: "var(--accent)",
  color: "white",
  cursor: "pointer",
} as const;
const dangerButtonStyle = {
  padding: "10px 13px",
  borderRadius: 10,
  border: "1px solid rgba(248,113,113,0.32)",
  background: "rgba(127,29,29,0.16)",
  color: "#fca5a5",
  cursor: "pointer",
} as const;
const forceStopButtonStyle = {
  ...dangerButtonStyle,
  border: "1px solid rgba(239,68,68,0.55)",
  background: "rgba(127,29,29,0.28)",
  color: "#fecaca",
} as const;
const stopWhenFlatButtonStyle = {
  padding: "10px 13px",
  borderRadius: 10,
  border: "1px solid rgba(251,146,60,0.35)",
  background: "rgba(249,115,22,0.14)",
  color: "#fdba74",
  cursor: "pointer",
  fontWeight: 600,
} as const;
const drainBannerStyle = {
  width: "100%",
  marginTop: 8,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(251,146,60,0.35)",
  background: "rgba(249,115,22,0.12)",
  color: "#fdba74",
  fontSize: 12,
  lineHeight: 1.45,
} as const;
const orphanWarningStyle = {
  width: "100%",
  marginTop: 8,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(251,146,60,0.35)",
  background: "rgba(249,115,22,0.12)",
  color: "#fdba74",
  fontSize: 12,
  lineHeight: 1.45,
} as const;
const disabledStartStyle = {
  opacity: 0.45,
  cursor: "not-allowed",
  background: "var(--surface3)",
  color: "var(--text3)",
} as const;
const strategyNudgeBannerStyle = {
  marginTop: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid rgba(96,165,250,0.18)",
  background: "rgba(96,165,250,0.06)",
} as const;
const strategyNudgeButtonStyle = {
  padding: "5px 12px",
  borderRadius: 8,
  border: "1px solid rgba(96,165,250,0.28)",
  background: "rgba(96,165,250,0.12)",
  color: "rgba(96,165,250,0.9)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
} as const;
const errorBannerStyle = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(248,113,113,0.34)",
  background: "rgba(248,113,113,0.08)",
  color: "#fca5a5",
  fontSize: 13,
} as const;
