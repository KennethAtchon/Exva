import { Badge } from "@/components/custom-ui";
import { Button } from "@/components/ui";
import type { SessionSummary } from "@/lib/exva";

type LifecycleAction = "start" | "pause" | "resume" | "stop";

export const SessionTable = ({
  sessions,
  busySessionId,
  focusedSessionAiReady,
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
  focusedSessionAiReady?: boolean | null;
  onFocus: (id: string) => void;
  onEdit: (session: SessionSummary) => void;
  onOpen: (session: SessionSummary) => void;
  onDuplicate: (session: SessionSummary) => void;
  onArchive: (id: string) => void;
  onSaveTemplate: (session: SessionSummary) => void;
  onLifecycle: (session: SessionSummary, action: LifecycleAction) => void;
}) => {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {sessions.map((session) => {
        const locked = session.status === "active" || session.status === "paused";
        const busy = busySessionId === session.id;
        const aiBlocked = session.isFocused && focusedSessionAiReady === false;

        return (
          <article
            key={session.id}
            style={{
              border: `1px solid ${session.isFocused ? "rgba(96,165,250,0.30)" : "var(--border)"}`,
              borderRadius: 16,
              padding: "16px 18px",
              background: session.isFocused
                ? "linear-gradient(135deg, rgba(96,165,250,0.07) 0%, rgba(13,18,25,0.97) 60%)"
                : "rgba(13,18,25,0.97)",
              boxShadow: session.isFocused
                ? "0 0 0 1px rgba(96,165,250,0.08) inset, 0 8px 24px rgba(2,6,23,0.24)"
                : "none",
            }}
          >
            {/* Top row: name+objective | metrics+chips */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 16, alignItems: "start" }}>
              {/* Left: clickable name + objective */}
              <button type="button" onClick={() => onOpen(session)} style={titleButtonStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text1)", letterSpacing: "-0.01em" }}>
                    {session.name}
                  </span>
                  {session.isFocused ? <Badge variant="blue">focused</Badge> : null}
                  <Badge variant={statusVariant(session.status)}>{session.status}</Badge>
                </div>
                <div style={objectiveStyle}>{session.objective}</div>
              </button>

              {/* Right: metrics + chips */}
              <div style={{ display: "grid", gap: 8 }}>
                <div style={metricStripStyle}>
                  <Metric label="uptime" value={session.uptimeMin > 0 ? `${session.uptimeMin}m` : "—"} />
                  <Metric label="trades" value={String(session.openTradeCount)} />
                  <Metric label="brokers" value={String(session.brokerCount)} />
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {session.instrumentClasses.map((ic) => (
                    <span key={ic} style={chipStyle}>{formatInstrumentClass(ic)}</span>
                  ))}
                  <span style={{ ...chipStyle, color: "var(--text3)" }}>
                    {session.selectionMode === "ai_selected_universe" ? "AI" : "Manual"}
                  </span>
                  <span style={{ ...chipStyle, color: "var(--text3)" }}>
                    {session.executionMode === "live_allowed" ? "Live" : "Paper"}
                  </span>
                </div>
              </div>
            </div>

            {/* Meta strip */}
            <div style={metaGridStyle}>
              <MetaBlock label="Scope" value={session.instrumentScope} />
              <MetaBlock label="Capital" value={`$${session.capitalLimitUsd.toLocaleString()}`} />
              <MetaBlock label="Search" value={session.defaultSearchProviderId ?? "Workspace default"} />
              <MetaBlock label="Updated" value={formatTimestamp(session.updatedAt)} />
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <Button
                onClick={() => onFocus(session.id)}
                variant="outline"
                style={{ ...actionButtonStyle, ...(session.isFocused ? focusedButtonStyle : {}) }}
                disabled={busy || session.isFocused}
              >
                {session.isFocused ? "Focused" : "Focus"}
              </Button>
              <Button onClick={() => onEdit(session)} variant="outline" style={actionButtonStyle} disabled={busy || locked}>
                Edit
              </Button>
              <Button onClick={() => onDuplicate(session)} variant="outline" style={actionButtonStyle} disabled={busy}>
                Duplicate
              </Button>
              <Button onClick={() => onSaveTemplate(session)} variant="outline" style={actionButtonStyle} disabled={busy}>
                Save Template
              </Button>
              <div style={{ flex: 1 }} />
              {session.status === "draft" || session.status === "idle" || session.status === "stopped" ? (
                <Button
                  onClick={() => onLifecycle(session, "start")}
                  variant="ghost"
                  style={{ ...primaryActionButtonStyle, ...(aiBlocked ? blockedStyle : {}) }}
                  disabled={busy || aiBlocked}
                  title={aiBlocked ? "AI providers not connected — configure in Strategy tab" : undefined}
                >
                  Start
                </Button>
              ) : null}
              {session.status === "active" ? (
                <Button onClick={() => onLifecycle(session, "pause")} variant="outline" style={actionButtonStyle} disabled={busy}>
                  Pause
                </Button>
              ) : null}
              {session.status === "paused" ? (
                <Button onClick={() => onLifecycle(session, "resume")} variant="ghost" style={primaryActionButtonStyle} disabled={busy}>
                  Resume
                </Button>
              ) : null}
              {session.status === "active" || session.status === "paused" ? (
                <Button onClick={() => onLifecycle(session, "stop")} variant="ghost" style={dangerButtonStyle} disabled={busy}>
                  Stop
                </Button>
              ) : null}
              <Button onClick={() => onArchive(session.id)} variant="outline" style={actionButtonStyle} disabled={busy || locked}>
                Archive
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div style={{ textAlign: "center" }}>
    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text1)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    <div style={{ marginTop: 2, fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text3)" }}>{label}</div>
  </div>
);

const MetaBlock = ({ label, value }: { label: string; value: string }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text3)", marginBottom: 3 }}>{label}</div>
    <div style={{ color: "var(--text2)", fontSize: 12, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
  </div>
);

function statusVariant(status: SessionSummary["status"]): "default" | "success" | "warn" | "danger" | "purple" {
  switch (status) {
    case "active": return "success";
    case "paused": return "warn";
    case "archived": return "danger";
    case "stopped": return "purple";
    default: return "default";
  }
}

function formatInstrumentClass(value: SessionSummary["instrumentClasses"][number]): string {
  return value === "stock" ? "Stocks" : value === "crypto" ? "Crypto" : value === "futures" ? "Futures" : "Predict";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

const titleButtonStyle = {
  background: "transparent",
  border: "none",
  color: "inherit",
  textAlign: "left" as const,
  cursor: "pointer",
  padding: 0,
  width: "100%",
  minWidth: 0,
  display: "block",
} as const;

const objectiveStyle = {
  marginTop: 6,
  color: "var(--text2)",
  fontSize: 12,
  lineHeight: 1.5,
  overflow: "hidden",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical" as const,
} as const;

const metricStripStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8,
  padding: "10px 10px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "rgba(7,10,15,0.5)",
} as const;

const metaGridStyle = {
  marginTop: 14,
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 12,
  padding: "12px 0 0",
  borderTop: "1px solid var(--border)",
} as const;

const chipStyle = {
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "rgba(7,10,15,0.5)",
  color: "var(--text2)",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.02em",
} as const;

const actionButtonStyle = {
  height: 30,
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text2)",
  fontSize: 12,
  fontWeight: 500,
} as const;

const focusedButtonStyle = {
  border: "1px solid rgba(96,165,250,0.3)",
  color: "rgba(96,165,250,0.8)",
} as const;

const primaryActionButtonStyle = {
  ...actionButtonStyle,
  border: "1px solid transparent",
  background: "var(--accent)",
  color: "white",
  fontWeight: 600,
} as const;

const dangerButtonStyle = {
  ...actionButtonStyle,
  border: "1px solid rgba(248,113,113,0.32)",
  color: "#fca5a5",
} as const;

const blockedStyle = {
  opacity: 0.4,
  cursor: "not-allowed",
} as const;
