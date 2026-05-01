import { useEffect, useMemo, useState } from "react";
import { Badge, Card, PageShell } from "@/components/atoms";
import { api, type SessionCreateInput, type SessionSummary } from "@/lib/exva";
import type { InstrumentClass, SessionStatus } from "@/lib/types";
import { CreateEditSessionModal } from "@/components/sessions/CreateEditSessionModal";
import { SessionDetailDrawer } from "@/components/sessions/SessionDetailDrawer";
import { SessionTable } from "@/components/sessions/SessionTable";
import { SessionTemplatesModal } from "@/components/sessions/SessionTemplatesModal";
import { useWorkspaceStore } from "@/store/workspaceStore";

type LifecycleAction = "start" | "pause" | "resume" | "stop";

export const SessionsPage = () => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const preferences = useWorkspaceStore((state) => state.preferences);
  const loadWorkspaceView = useWorkspaceStore((state) => state.loadWorkspaceView);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SessionStatus | "all">("all");
  const [instrumentFilter, setInstrumentFilter] = useState<InstrumentClass | "all">("all");
  const [detail, setDetail] = useState<SessionSummary | null>(null);
  const [editing, setEditing] = useState<SessionSummary | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateInput, setTemplateInput] = useState<SessionCreateInput | null>(null);
  const [templateWarnings, setTemplateWarnings] = useState<string[]>([]);
  const [templateSourceSession, setTemplateSourceSession] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionSessionId, setActionSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listSessions({
        search: search.trim() || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
        instrumentClass: instrumentFilter === "all" ? undefined : instrumentFilter,
        includeArchived: preferences?.globalIncludeArchived,
      });
      setSessions(result.sessions);
      await loadWorkspaceView();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [search, statusFilter, instrumentFilter, preferences?.globalIncludeArchived]);

  const focusedSession = useMemo(() => sessions.find((session) => session.id === focusedSessionId) ?? null, [sessions, focusedSessionId]);
  const activeCount = useMemo(() => sessions.filter((session) => session.status === "active").length, [sessions]);
  const pausedCount = useMemo(() => sessions.filter((session) => session.status === "paused").length, [sessions]);
  const openTrades = useMemo(() => sessions.reduce((sum, session) => sum + session.openTradeCount, 0), [sessions]);

  async function runLifecycleAction(session: SessionSummary, action: LifecycleAction) {
    setActionSessionId(session.id);
    setError(null);
    try {
      if (!session.isFocused) {
        await api.focusSession(session.id);
      }
      if (action === "start") await api.startSession();
      if (action === "pause") await api.pauseSession();
      if (action === "resume") await api.resumeSession();
      if (action === "stop") await api.stopSession();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Session action failed.");
    } finally {
      setActionSessionId(null);
    }
  }

  return (
    <PageShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text3)" }}>Workspace Sessions</div>
          <h1 style={{ margin: "10px 0 0", fontSize: 28 }}>Sessions</h1>
          <p style={{ marginTop: 8, color: "var(--text3)", fontSize: 13, maxWidth: 640 }}>
            Focus a live trading context, tune its boundary, and turn working configurations into reusable templates.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => {
              setTemplateSourceSession(focusedSession);
              setTemplatesOpen(true);
            }}
            style={secondaryButtonStyle}
          >
            Templates
          </button>
          <button
            onClick={async () => {
              setError(null);
              try {
                await api.goGlobal();
                await load();
              } catch (goGlobalError) {
                setError(goGlobalError instanceof Error ? goGlobalError.message : "Failed to switch to global mode.");
              }
            }}
            style={secondaryButtonStyle}
            disabled={sessions.filter((session) => session.status !== "archived").length === 0 || viewMode === "global"}
          >
            Go Global
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setTemplateInput(null);
              setTemplateWarnings([]);
              setModalOpen(true);
            }}
            style={primaryButtonStyle}
          >
            New Session
          </button>
        </div>
      </div>

      {error ? <div style={errorBannerStyle}>{error}</div> : null}

      <Card accent style={{ padding: 0, overflow: "hidden" }}>
        <div style={contextHeroStyle}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text3)" }}>
                {viewMode === "global" ? "Global Workspace" : "Focused Session"}
              </span>
              <Badge variant={viewMode === "global" ? "purple" : "blue"}>{viewMode}</Badge>
              {focusedSession ? <Badge variant={statusVariant(focusedSession.status)}>{focusedSession.status}</Badge> : null}
            </div>
            <div style={{ marginTop: 10, fontSize: 24, fontWeight: 700, color: "var(--text1)" }}>
              {focusedSession?.name ?? "Global trade fabric"}
            </div>
            <div style={{ marginTop: 8, maxWidth: 700, color: "var(--text2)", fontSize: 14, lineHeight: 1.6 }}>
              {focusedSession?.objective ?? "Aggregate the non-archived sessions, compare posture across them, and choose where the next focused cycle should run."}
            </div>
          </div>

          <div style={{ display: "grid", gap: 12, minWidth: 280 }}>
            <div style={contextMetricsStyle}>
              <ContextMetric label="sessions" value={String(sessions.length)} />
              <ContextMetric label="active" value={String(activeCount)} />
              <ContextMetric label="paused" value={String(pausedCount)} />
              <ContextMetric label="open trades" value={String(openTrades)} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {focusedSession && (focusedSession.status === "draft" || focusedSession.status === "idle" || focusedSession.status === "stopped") ? (
                <button onClick={() => void runLifecycleAction(focusedSession, "start")} style={primaryButtonStyle} disabled={actionSessionId === focusedSession.id}>
                  Start
                </button>
              ) : null}
              {focusedSession?.status === "active" ? (
                <button onClick={() => void runLifecycleAction(focusedSession, "pause")} style={secondaryButtonStyle} disabled={actionSessionId === focusedSession.id}>
                  Pause
                </button>
              ) : null}
              {focusedSession?.status === "paused" ? (
                <button onClick={() => void runLifecycleAction(focusedSession, "resume")} style={primaryButtonStyle} disabled={actionSessionId === focusedSession.id}>
                  Resume
                </button>
              ) : null}
              {focusedSession && (focusedSession.status === "active" || focusedSession.status === "paused") ? (
                <button onClick={() => void runLifecycleAction(focusedSession, "stop")} style={dangerButtonStyle} disabled={actionSessionId === focusedSession.id}>
                  Stop
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div style={toolbarStyle}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or objective" style={{ ...inputStyle, flex: 1 }} />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SessionStatus | "all")} style={inputStyle}>
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="idle">Idle</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="stopped">Stopped</option>
            <option value="archived">Archived</option>
          </select>
          <select value={instrumentFilter} onChange={(event) => setInstrumentFilter(event.target.value as InstrumentClass | "all")} style={inputStyle}>
            <option value="all">All instruments</option>
            <option value="stock">Stocks</option>
            <option value="crypto">Crypto</option>
            <option value="futures">Futures</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text2)", fontSize: 12, whiteSpace: "nowrap" }}>
            <input
              type="checkbox"
              checked={preferences?.globalIncludeArchived ?? false}
              onChange={async (event) => {
                setError(null);
                try {
                  await api.patchWorkspacePreferences({ globalIncludeArchived: event.target.checked });
                  await loadWorkspaceView();
                } catch (prefsError) {
                  setError(prefsError instanceof Error ? prefsError.message : "Failed to update workspace preferences.");
                }
              }}
            />
            Include archived
          </label>
        </div>

        {loading ? <div style={emptyStateStyle}>Loading sessions...</div> : null}
        {!loading && sessions.length === 0 ? (
          <div style={emptyStateStyle}>No sessions matched the current filters.</div>
        ) : null}
        {!loading && sessions.length > 0 ? (
          <SessionTable
            sessions={sessions}
            busySessionId={actionSessionId}
            onFocus={async (id) => {
              setError(null);
              try {
                await api.focusSession(id);
                await load();
              } catch (focusError) {
                setError(focusError instanceof Error ? focusError.message : "Failed to focus session.");
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
                setError(duplicateError instanceof Error ? duplicateError.message : "Failed to duplicate session.");
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
                setError(archiveError instanceof Error ? archiveError.message : "Failed to archive session.");
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
      <SessionDetailDrawer session={detail} onClose={() => setDetail(null)} />
    </PageShell>
  );
};

const ContextMetric = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
    <div style={{ marginTop: 4, color: "var(--text1)", fontSize: 18, fontWeight: 700 }}>{value}</div>
  </div>
);

function statusVariant(status: SessionStatus): "default" | "success" | "warn" | "danger" | "purple" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warn";
    case "archived":
      return "danger";
    case "stopped":
      return "purple";
    default:
      return "default";
  }
}

const contextHeroStyle = { display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 0.9fr)", gap: 18, padding: 24, background: "radial-gradient(circle at top left, rgba(96,165,250,0.16), transparent 45%)" } as const;
const contextMetricsStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, padding: "14px 16px", borderRadius: 16, border: "1px solid var(--border)", background: "rgba(7,10,15,0.34)" } as const;
const toolbarStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 18 } as const;
const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text1)" } as const;
const emptyStateStyle = { border: "1px dashed var(--border)", borderRadius: 16, padding: 28, color: "var(--text3)", textAlign: "center" as const };
const secondaryButtonStyle = { padding: "10px 13px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer" } as const;
const primaryButtonStyle = { padding: "10px 13px", borderRadius: 10, border: "none", background: "var(--accent)", color: "white", cursor: "pointer" } as const;
const dangerButtonStyle = { padding: "10px 13px", borderRadius: 10, border: "1px solid rgba(248,113,113,0.32)", background: "rgba(127,29,29,0.16)", color: "#fca5a5", cursor: "pointer" } as const;
const errorBannerStyle = { padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(248,113,113,0.34)", background: "rgba(248,113,113,0.08)", color: "#fca5a5", fontSize: 13 } as const;
