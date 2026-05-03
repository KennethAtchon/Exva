import { Badge } from "@/components/custom-ui";
import type { SessionSummary } from "@/lib/exva";

type LifecycleAction = "start" | "pause" | "resume" | "stop";

export const SessionTable = ({
  sessions,
  busySessionId,
  onFocus,
  onEdit,
  onOpen,
  onDuplicate,
  onArchive,
  onSaveTemplate,
  onLifecycle,
}: {
  sessions: SessionSummary[];
  busySessionId?: string | null;
  onFocus: (id: string) => void;
  onEdit: (session: SessionSummary) => void;
  onOpen: (session: SessionSummary) => void;
  onDuplicate: (session: SessionSummary) => void;
  onArchive: (id: string) => void;
  onSaveTemplate: (session: SessionSummary) => void;
  onLifecycle: (session: SessionSummary, action: LifecycleAction) => void;
}) => {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {sessions.map((session) => {
        const locked = session.status === "active" || session.status === "paused";
        const busy = busySessionId === session.id;

        return (
          <article
            key={session.id}
            style={{
              border: `1px solid ${session.isFocused ? "var(--accent-dim)" : "var(--border)"}`,
              borderRadius: 18,
              padding: 18,
              background: session.isFocused
                ? "linear-gradient(180deg, rgba(96,165,250,0.10), rgba(13,18,25,0.95))"
                : "linear-gradient(180deg, rgba(18,26,36,0.95), rgba(13,18,25,0.98))",
              boxShadow: session.isFocused ? "0 18px 40px rgba(2,6,23,0.32)" : "none",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", minWidth: 0 }}>
              <button onClick={() => onOpen(session)} style={titleButtonStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 17,
                      fontWeight: 700,
                      color: "var(--text1)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                      flex: "1 1 200px",
                    }}
                  >
                    {session.name}
                  </span>
                  {session.isFocused ? <Badge variant="blue">focused</Badge> : null}
                  <Badge variant={statusVariant(session.status)}>{session.status}</Badge>
                </div>
                <div style={{ marginTop: 8, color: "var(--text2)", fontSize: 13, lineHeight: 1.5 }}>{session.objective}</div>
              </button>

              <div style={{ minWidth: 220, display: "grid", gap: 10 }}>
                <div style={metricStripStyle}>
                  <Metric label="uptime" value={session.uptimeMin > 0 ? `${session.uptimeMin} min` : "offline"} />
                  <Metric label="open trades" value={String(session.openTradeCount)} />
                  <Metric label="brokers" value={String(session.brokerCount)} />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {session.instrumentClasses.map((instrumentClass) => (
                    <span key={instrumentClass} style={chipStyle}>
                      {formatInstrumentClass(instrumentClass)}
                    </span>
                  ))}
                  <span style={chipStyle}>{session.selectionMode === "ai_selected_universe" ? "AI universe" : "Manual shortlist"}</span>
                  <span style={chipStyle}>{session.executionMode === "live_allowed" ? "Live allowed" : "Paper only"}</span>
                </div>
              </div>
            </div>

            <div style={metaGridStyle}>
              <MetaBlock label="Instrument scope" value={session.instrumentScope} />
              <MetaBlock label="Capital limit" value={`$${session.capitalLimitUsd.toLocaleString()}`} />
              <MetaBlock label="Search override" value={session.defaultSearchProviderId ?? "Workspace default"} />
              <MetaBlock label="Updated" value={formatTimestamp(session.updatedAt)} />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              <button onClick={() => onFocus(session.id)} style={actionButtonStyle} disabled={busy || session.isFocused}>
                {session.isFocused ? "Focused" : "Focus"}
              </button>
              <button onClick={() => onEdit(session)} style={actionButtonStyle} disabled={busy || locked}>
                Edit
              </button>
              <button onClick={() => onDuplicate(session)} style={actionButtonStyle} disabled={busy}>
                Duplicate
              </button>
              <button onClick={() => onSaveTemplate(session)} style={actionButtonStyle} disabled={busy}>
                Save Template
              </button>
              {session.status === "draft" || session.status === "idle" || session.status === "stopped" ? (
                <button onClick={() => onLifecycle(session, "start")} style={primaryActionButtonStyle} disabled={busy}>
                  Start
                </button>
              ) : null}
              {session.status === "active" ? (
                <button onClick={() => onLifecycle(session, "pause")} style={actionButtonStyle} disabled={busy}>
                  Pause
                </button>
              ) : null}
              {session.status === "paused" ? (
                <button onClick={() => onLifecycle(session, "resume")} style={primaryActionButtonStyle} disabled={busy}>
                  Resume
                </button>
              ) : null}
              {session.status === "active" || session.status === "paused" ? (
                <button onClick={() => onLifecycle(session, "stop")} style={dangerButtonStyle} disabled={busy}>
                  Stop
                </button>
              ) : null}
              <button onClick={() => onArchive(session.id)} style={actionButtonStyle} disabled={busy || locked}>
                Archive
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text3)" }}>{label}</div>
    <div style={{ marginTop: 4, color: "var(--text1)", fontSize: 14, fontWeight: 600 }}>{value}</div>
  </div>
);

const MetaBlock = ({ label, value }: { label: string; value: string }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text3)" }}>{label}</div>
    <div style={{ marginTop: 6, color: "var(--text2)", fontSize: 13, lineHeight: 1.45, wordBreak: "break-word" }}>{value}</div>
  </div>
);

function statusVariant(status: SessionSummary["status"]): "default" | "success" | "warn" | "danger" | "purple" {
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

function formatInstrumentClass(value: SessionSummary["instrumentClasses"][number]): string {
  return value === "stock" ? "Stocks" : value === "crypto" ? "Crypto" : "Futures";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

const titleButtonStyle = {
  background: "transparent",
  border: "none",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
  padding: 0,
  flex: 1,
  minWidth: 0,
} as const;

const metricStripStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 12,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "rgba(7,10,15,0.38)",
} as const;

const metaGridStyle = {
  marginTop: 16,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
} as const;

const chipStyle = {
  padding: "5px 9px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "rgba(7,10,15,0.44)",
  color: "var(--text2)",
  fontSize: 11,
} as const;

const actionButtonStyle = {
  padding: "8px 11px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text2)",
  cursor: "pointer",
  fontSize: 12,
} as const;

const primaryActionButtonStyle = {
  ...actionButtonStyle,
  border: "1px solid transparent",
  background: "var(--accent)",
  color: "white",
} as const;

const dangerButtonStyle = {
  ...actionButtonStyle,
  border: "1px solid rgba(248,113,113,0.32)",
  color: "#fca5a5",
} as const;
