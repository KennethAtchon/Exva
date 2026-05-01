import type { SessionSummary } from "@/lib/exva";

export const SessionTable = ({
  sessions,
  onFocus,
  onEdit,
  onOpen,
  onDuplicate,
  onArchive,
}: {
  sessions: SessionSummary[];
  onFocus: (id: string) => void;
  onEdit: (session: SessionSummary) => void;
  onOpen: (session: SessionSummary) => void;
  onDuplicate: (session: SessionSummary) => void;
  onArchive: (id: string) => void;
}) => {
  return (
    // TODO(phase-04): Replace this basic grid with the richer session table from the plan,
    // including status/instrument filters, focus affordance, save-as-template, pause/resume/stop,
    // and clearer lock-state presentation for active/paused sessions.
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 110px 110px 90px 220px", padding: "10px 14px", fontSize: 11, color: "var(--text3)", textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>
        <span>Session</span>
        <span>Instruments</span>
        <span>Status</span>
        <span>Open Trades</span>
        <span>Brokers</span>
        <span>Actions</span>
      </div>
      {sessions.map((session) => {
        const locked = session.status === "active" || session.status === "paused";
        return (
          <div key={session.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 110px 110px 90px 220px", padding: "12px 14px", borderBottom: "1px solid var(--border)", alignItems: "center", gap: 10 }}>
            <button onClick={() => onOpen(session)} style={{ background: "transparent", border: "none", color: "inherit", textAlign: "left", cursor: "pointer" }}>
              <div style={{ color: "var(--text1)", fontWeight: 600 }}>{session.name}</div>
              <div style={{ color: "var(--text3)", fontSize: 12 }}>{session.objective}</div>
            </button>
            <span style={{ color: "var(--text2)", fontSize: 12 }}>{session.instrumentScope}</span>
            <span style={{ color: "var(--text2)", fontSize: 12 }}>{session.status}</span>
            <span style={{ color: "var(--text2)", fontSize: 12 }}>{session.openTradeCount}</span>
            <span style={{ color: "var(--text2)", fontSize: 12 }}>{session.brokerCount}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => onFocus(session.id)} style={tinyButtonStyle}>{session.isFocused ? "Focused" : "Focus"}</button>
              <button onClick={() => onEdit(session)} style={tinyButtonStyle} disabled={locked}>Edit</button>
              <button onClick={() => onDuplicate(session)} style={tinyButtonStyle}>Duplicate</button>
              <button onClick={() => onArchive(session.id)} style={tinyButtonStyle} disabled={locked}>Archive</button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const tinyButtonStyle = { padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer", fontSize: 11 } as const;
