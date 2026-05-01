import { useEffect, useMemo, useState } from "react";
import { api, type SessionCreateInput, type SessionSummary } from "@/lib/exva";
import { PageShell } from "@/components/atoms";
import { SessionDetailDrawer } from "@/components/sessions/SessionDetailDrawer";
import { CreateEditSessionModal } from "@/components/sessions/CreateEditSessionModal";
import { SessionTemplatesModal } from "@/components/sessions/SessionTemplatesModal";
import { SessionTable } from "@/components/sessions/SessionTable";
import { useWorkspaceStore } from "@/store/workspaceStore";

export const SessionsPage = () => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const preferences = useWorkspaceStore((state) => state.preferences);
  const loadWorkspaceView = useWorkspaceStore((state) => state.loadWorkspaceView);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<SessionSummary | null>(null);
  const [editing, setEditing] = useState<SessionSummary | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateInput, setTemplateInput] = useState<SessionCreateInput | null>(null);

  const load = async () => {
    const result = await api.listSessions({ search, includeArchived: preferences?.globalIncludeArchived });
    setSessions(result.sessions);
    await loadWorkspaceView();
  };

  useEffect(() => {
    void load();
  }, [search, preferences?.globalIncludeArchived]);

  const focusedSession = useMemo(() => sessions.find((session) => session.id === focusedSessionId) ?? null, [sessions, focusedSessionId]);

  return (
    <PageShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Sessions</h1>
          <p style={{ marginTop: 4, color: "var(--text3)", fontSize: 13 }}>Focused session selection and workspace context.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setTemplatesOpen(true)} style={secondaryButtonStyle}>Templates</button>
          <button onClick={async () => { await api.goGlobal(); await load(); }} style={secondaryButtonStyle} disabled={sessions.filter((session) => session.status !== "archived").length === 0 || viewMode === "global"}>Go Global</button>
          <button onClick={() => { setEditing(null); setTemplateInput(null); setModalOpen(true); }} style={primaryButtonStyle}>New Session</button>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--surface)" }}>
        <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", marginBottom: 8 }}>{viewMode === "global" ? "Global Workspace" : "Focused Session"}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text1)" }}>{focusedSession?.name ?? "Global Workspace"}</div>
            <div style={{ color: "var(--text3)", fontSize: 13 }}>{focusedSession?.objective ?? "Aggregated view across sessions"}</div>
          </div>
          <div style={{ color: "var(--text2)", fontSize: 12 }}>{focusedSession?.status ?? "global"}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sessions" style={{ flex: 1, ...inputStyle }} />
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text2)", fontSize: 12 }}>
          <input
            type="checkbox"
            checked={preferences?.globalIncludeArchived ?? false}
            onChange={async (event) => {
              await api.patchWorkspacePreferences({ globalIncludeArchived: event.target.checked });
              await loadWorkspaceView();
            }}
          />
          Include archived
        </label>
      </div>

      {sessions.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: 28, color: "var(--text3)", textAlign: "center" }}>
          No sessions yet.
        </div>
      ) : (
        <SessionTable
          sessions={sessions}
          onFocus={async (id) => {
            await api.focusSession(id);
            await load();
          }}
          onEdit={(session) => {
            setEditing(session);
            setTemplateInput(null);
            setModalOpen(true);
          }}
          onOpen={(session) => setDetail(session)}
          onDuplicate={async (session) => {
            await api.duplicateSession(session.id, `${session.name} Copy`);
            await load();
          }}
          onArchive={async (id) => {
            await api.archiveSession(id);
            await load();
          }}
        />
      )}

      <CreateEditSessionModal
        open={modalOpen}
        initialSession={editing}
        templateInput={templateInput}
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
        focusedSession={focusedSession}
        onClose={() => setTemplatesOpen(false)}
        onUseTemplate={(input) => {
          setTemplateInput(input);
          setEditing(null);
          setModalOpen(true);
        }}
      />
      <SessionDetailDrawer session={detail} onClose={() => setDetail(null)} />
    </PageShell>
  );
};

const inputStyle = { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text1)" } as const;
const secondaryButtonStyle = { padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer" } as const;
const primaryButtonStyle = { padding: "8px 12px", borderRadius: 8, border: "none", background: "var(--accent)", color: "white", cursor: "pointer" } as const;
