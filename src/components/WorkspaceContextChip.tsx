import { useEffect, useState } from "react";
import { api, type SessionSummary } from "@/lib/exva";
import { useWorkspaceStore } from "@/store/workspaceStore";

interface WorkspaceContextChipProps {
  onSwitchSession?: (id: string) => void;
  onGoGlobal?: () => void;
}

export const WorkspaceContextChip = ({ onSwitchSession, onGoGlobal }: WorkspaceContextChipProps) => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    api.listSessions({ includeArchived: false }).then((result) => setSessions(result.sessions)).catch(() => {});
  }, [open]);

  const focused = sessions.find((session) => session.id === focusedSessionId);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((current) => !current)}
        style={{
          padding: "6px 10px",
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--surface2)",
          color: "var(--text2)",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {viewMode === "global" ? "Global Workspace" : focused?.name ?? "Focused Session"}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            width: 260,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
            padding: 10,
            zIndex: 20,
          }}
        >
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase" }}>Workspace Context</div>
          <button
            onClick={() => {
              setOpen(false);
              onGoGlobal?.();
            }}
            style={menuButtonStyle}
          >
            Global Workspace
          </button>
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => {
                setOpen(false);
                onSwitchSession?.(session.id);
              }}
              style={menuButtonStyle}
            >
              <span>{session.name}</span>
              <span style={{ color: "var(--text3)", fontSize: 11 }}>{session.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const menuButtonStyle = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 10px",
  background: "transparent",
  border: "none",
  borderRadius: 8,
  color: "var(--text2)",
  cursor: "pointer",
} as const;
