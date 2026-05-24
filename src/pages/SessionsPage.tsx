import { useEffect, useMemo, useRef, useState } from "react";
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

type LifecycleAction = "start" | "pause" | "resume" | "stop";

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

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SessionStatus | "all">(
    "all",
  );
  const [instrumentFilter, setInstrumentFilter] = useState<
    InstrumentClass | "all"
  >("all");
  const [detail, setDetail] = useState<SessionSummary | null>(null);
  const [editing, setEditing] = useState<SessionSummary | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateInput, setTemplateInput] = useState<SessionCreateInput | null>(
    null,
  );
  const [templateWarnings, setTemplateWarnings] = useState<string[]>([]);
  const [templateSourceSession, setTemplateSourceSession] =
    useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionSessionId, setActionSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressBySessionId, setProgressBySessionId] = useState<
    Record<string, SessionProgressState>
  >({});
  const [researchFailuresBySessionId, setResearchFailuresBySessionId] =
    useState<Record<string, { phase: string; error: string; at: string }>>({});
  const aiReady = useWorkspaceStore((state) => state.focusedSessionAiReady);
  const checkAiReady = useWorkspaceStore((state) => state.checkAiReady);
  const environmentMode = useWorkspaceStore((state) => state.environmentMode);
  const [liveReadinessSession, setLiveReadinessSession] =
    useState<SessionSummary | null>(null);
  const [liveReadinessReport, setLiveReadinessReport] =
    useState<LiveReadinessReport | null>(null);
  const refreshProgress = async (sessionId: string) => {
    try {
      const result = await api.getSessionExecutionProgress(sessionId);
      if (!result.cycleId) return;
      const state = deriveProgress(result.steps, result.cycleId, null);
      if (!state) return;
      setProgressBySessionId((prev) => ({ ...prev, [sessionId]: state }));
    } catch {
      // silently ignore
    }
  };

  const unsubsRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (initialStatusFilter === "all") return;
    setStatusFilter(initialStatusFilter);
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

    (async () => {
      for (const eventName of stepEvents) {
        const unsub = await listenEvent(eventName, (payload) => {
          void refreshProgress((payload as { sessionId: string }).sessionId);
        });
        cleanup.push(unsub);
      }
      unsubsRef.current = cleanup;
    })();

    return () => {
      for (const unsub of unsubsRef.current) unsub();
      unsubsRef.current = [];
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cleanup: Array<() => void> = [];

    void listenEvent("research_phase_failed", (payload) => {
      const data = payload as {
        sessionId: string;
        phase: string;
        error: string;
      };
      if (cancelled) return;
      setResearchFailuresBySessionId((prev) => ({
        ...prev,
        [data.sessionId]: {
          phase: data.phase,
          error: data.error,
          at: new Date().toISOString(),
        },
      }));
      void refreshProgress(data.sessionId);
    }).then((unsub) => cleanup.push(unsub));

    return () => {
      cancelled = true;
      for (const unsub of cleanup) unsub();
    };
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listSessions({
        search: search.trim() || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
        instrumentClass:
          instrumentFilter === "all" ? undefined : instrumentFilter,
        includeArchived: preferences?.globalIncludeArchived,
        executionMode:
          environmentMode === "live" ? "live_allowed" : "paper_only",
      });
      setSessions(result.sessions);
      await loadWorkspaceView();
      // Seed progress for sessions that may have active execution
      for (const session of result.sessions) {
        if (session.status === "active" || session.status === "paused") {
          void refreshProgress(session.id);
        }
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load sessions.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [
    search,
    statusFilter,
    instrumentFilter,
    preferences?.globalIncludeArchived,
    environmentMode,
  ]);

  useEffect(() => {
    setDetail(null);
    setEditing(null);
    setModalOpen(false);
    setTemplatesOpen(false);
    setTemplateInput(null);
    setTemplateWarnings([]);
    setProgressBySessionId({});
    setLiveReadinessSession(null);
    setLiveReadinessReport(null);
    setActionSessionId(null);
    setError(null);
  }, [environmentMode]);

  useEffect(() => {
    if (focusedSessionId) void checkAiReady(focusedSessionId);
  }, [focusedSessionId, checkAiReady]);

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

  async function runLifecycleAction(
    session: SessionSummary,
    action: LifecycleAction,
  ) {
    setActionSessionId(session.id);
    setError(null);
    try {
      if (!session.isFocused) {
        await api.focusSession(session.id);
      }
      if (action === "start" && session.executionMode === "live_allowed") {
        const readiness = await api.getLiveReadiness(session.id);
        if (!readiness.readyToStart || !readiness.acknowledgedAt) {
          setLiveReadinessReport(readiness);
          setLiveReadinessSession(session);
          setActionSessionId(null);
          return;
        }
      }
      if (action === "start") await api.startSession();
      if (action === "pause") await api.pauseSession();
      if (action === "resume") await api.resumeSession();
      if (action === "stop") await api.stopSession();
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Session action failed.",
      );
    } finally {
      setActionSessionId(null);
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
              fontSize: 11,
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
              setTemplateSourceSession(focusedSession);
              setTemplatesOpen(true);
            }}
            variant="outline"
            style={secondaryButtonStyle}
          >
            Templates
          </Button>
          <Button
            onClick={async () => {
              setError(null);
              try {
                await api.goGlobal();
                await load();
              } catch (goGlobalError) {
                setError(
                  goGlobalError instanceof Error
                    ? goGlobalError.message
                    : "Failed to switch to global mode.",
                );
              }
            }}
            variant="outline"
            style={secondaryButtonStyle}
            disabled={
              sessions.filter((session) => session.status !== "archived")
                .length === 0 || viewMode === "global"
            }
          >
            Go Global
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setTemplateInput(null);
              setTemplateWarnings([]);
              setModalOpen(true);
            }}
            variant="ghost"
            style={primaryButtonStyle}
          >
            New Session
          </Button>
        </div>
      </div>

      {error ? <div style={errorBannerStyle}>{error}</div> : null}

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
                  fontSize: 11,
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
                  {focusedSession.status}
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
              <ContextMetric label="sessions" value={String(sessions.length)} />
              <ContextMetric label="active" value={String(activeCount)} />
              <ContextMetric label="paused" value={String(pausedCount)} />
              <ContextMetric label="open trades" value={String(openTrades)} />
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              {focusedSession &&
              (focusedSession.status === "draft" ||
                focusedSession.status === "idle" ||
                focusedSession.status === "stopped") ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void runLifecycleAction(focusedSession, "start")
                  }
                  style={{
                    ...primaryButtonStyle,
                    ...(aiReady === false ? disabledStartStyle : {}),
                  }}
                  disabled={
                    actionSessionId === focusedSession.id || aiReady === false
                  }
                  title={
                    aiReady === false
                      ? "AI providers not connected — configure in Strategy tab before starting"
                      : undefined
                  }
                >
                  Start
                </Button>
              ) : null}
              {focusedSession?.status === "active" ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    void runLifecycleAction(focusedSession, "pause")
                  }
                  style={secondaryButtonStyle}
                  disabled={actionSessionId === focusedSession.id}
                >
                  Pause
                </Button>
              ) : null}
              {focusedSession?.status === "paused" ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void runLifecycleAction(focusedSession, "resume")
                  }
                  style={primaryButtonStyle}
                  disabled={actionSessionId === focusedSession.id}
                >
                  Resume
                </Button>
              ) : null}
              {focusedSession &&
              (focusedSession.status === "active" ||
                focusedSession.status === "paused") ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void runLifecycleAction(focusedSession, "stop")
                  }
                  style={dangerButtonStyle}
                  disabled={actionSessionId === focusedSession.id}
                >
                  Stop
                </Button>
              ) : null}
            </div>
            {focusedSession &&
            (focusedSession.status === "draft" ||
              focusedSession.status === "idle" ||
              focusedSession.status === "stopped") &&
            onGoToStrategy ? (
              <div style={strategyNudgeBannerStyle}>
                <span style={{ color: "var(--text2)", fontSize: 12 }}>
                  Configure AI phases, risk limits, and strategy before
                  starting.
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
        </div>
      </Card>

      <Card>
        <div style={toolbarStyle}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or objective"
            style={{ ...inputStyle, flex: 1 }}
          />
          <ShadcnSelect
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as SessionStatus | "all")
            }
            className="w-[180px]"
            options={[
              { value: "all", label: "All statuses" },
              { value: "draft", label: "Draft" },
              { value: "idle", label: "Idle" },
              { value: "active", label: "Active" },
              { value: "attention_required", label: "Needs attention" },
              { value: "paused", label: "Paused" },
              { value: "stopped", label: "Stopped" },
              { value: "archived", label: "Archived" },
            ]}
          />
          <ShadcnSelect
            value={instrumentFilter}
            onValueChange={(value) =>
              setInstrumentFilter(value as InstrumentClass | "all")
            }
            className="w-[180px]"
            options={[
              { value: "all", label: "All instruments" },
              { value: "stock", label: "Stocks" },
              { value: "crypto", label: "Crypto" },
              { value: "futures", label: "Futures" },
            ]}
          />
          <label
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
              checked={preferences?.globalIncludeArchived ?? false}
              onCheckedChange={async (checked) => {
                setError(null);
                try {
                  await api.patchWorkspacePreferences({
                    globalIncludeArchived: checked === true,
                  });
                  await loadWorkspaceView();
                } catch (prefsError) {
                  setError(
                    prefsError instanceof Error
                      ? prefsError.message
                      : "Failed to update workspace preferences.",
                  );
                }
              }}
            />
            Include archived
          </label>
        </div>

        {loading ? (
          <div style={emptyStateStyle}>Loading sessions...</div>
        ) : null}
        {!loading && sessions.length === 0 ? (
          <div style={emptyStateStyle}>
            No sessions matched the current filters.
          </div>
        ) : null}
        {!loading && sessions.length > 0 ? (
          <SessionTable
            sessions={sessions}
            busySessionId={actionSessionId}
            focusedSessionAiReady={aiReady}
            progressBySessionId={progressBySessionId}
            researchFailuresBySessionId={researchFailuresBySessionId}
            onRetryStep={async (sessionId, cycleId, stage) => {
              try {
                await api.retrySessionStep({ sessionId, cycleId, stage });
                void refreshProgress(sessionId);
              } catch (retryError) {
                setError(
                  retryError instanceof Error
                    ? retryError.message
                    : "Retry failed.",
                );
              }
            }}
            onViewTrace={(sessionId, cycleId, stage) => {
              if (onViewTrace) {
                onViewTrace(sessionId, cycleId, stage);
              } else {
                const match = sessions.find((s) => s.id === sessionId);
                if (match) setDetail(match);
              }
            }}
            onPauseAfterStep={async (sessionId) => {
              try {
                if (!sessions.find((s) => s.id === sessionId)?.isFocused) {
                  await api.focusSession(sessionId);
                }
                await api.pauseSessionAfterCurrentStep(sessionId);
              } catch (pauseError) {
                setError(
                  pauseError instanceof Error
                    ? pauseError.message
                    : "Pause after step failed.",
                );
              }
            }}
            onFocus={async (id) => {
              setError(null);
              try {
                await api.focusSession(id);
                await load();
              } catch (focusError) {
                setError(
                  focusError instanceof Error
                    ? focusError.message
                    : "Failed to focus session.",
                );
              }
            }}
            onEdit={(session) => {
              setEditing(session);
              setTemplateInput(null);
              setTemplateWarnings([]);
              setModalOpen(true);
            }}
            onOpen={(session) => setDetail(session)}
            onDuplicate={async (session) => {
              setActionSessionId(session.id);
              setError(null);
              try {
                await api.duplicateSession(session.id, `${session.name} Copy`);
                await load();
              } catch (duplicateError) {
                setError(
                  duplicateError instanceof Error
                    ? duplicateError.message
                    : "Failed to duplicate session.",
                );
              } finally {
                setActionSessionId(null);
              }
            }}
            onArchive={async (id) => {
              setActionSessionId(id);
              setError(null);
              try {
                await api.archiveSession(id);
                await load();
              } catch (archiveError) {
                setError(
                  archiveError instanceof Error
                    ? archiveError.message
                    : "Failed to archive session.",
                );
              } finally {
                setActionSessionId(null);
              }
            }}
            onSaveTemplate={(session) => {
              setTemplateSourceSession(session);
              setTemplatesOpen(true);
            }}
            onLifecycle={(session, action) => {
              void runLifecycleAction(session, action);
            }}
          />
        ) : null}
      </Card>

      <CreateEditSessionModal
        open={modalOpen}
        initialSession={editing}
        templateInput={templateInput}
        templateWarnings={templateWarnings}
        onOpenAccounts={onGoToAccounts}
        onClose={() => setModalOpen(false)}
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
        open={templatesOpen}
        sourceSession={templateSourceSession}
        onClose={() => setTemplatesOpen(false)}
        onUseTemplate={(input, clearedFields) => {
          setTemplateInput(input);
          setTemplateWarnings(clearedFields);
          setEditing(null);
          setModalOpen(true);
        }}
      />
      {liveReadinessSession && liveReadinessReport ? (
        <LiveReadinessModal
          sessionId={liveReadinessSession.id}
          report={liveReadinessReport}
          onAcknowledged={async () => {
            setLiveReadinessReport(null);
            setLiveReadinessSession(null);
            await runLifecycleAction(liveReadinessSession, "start");
          }}
          onCancel={() => {
            setLiveReadinessReport(null);
            setLiveReadinessSession(null);
          }}
        />
      ) : null}
      <SessionDetailDrawer session={detail} onClose={() => setDetail(null)} />
    </PageShell>
  );
};

const ContextMetric = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div
      style={{
        fontSize: 10,
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

function statusVariant(
  status: SessionStatus,
): "default" | "success" | "warn" | "danger" | "purple" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
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
