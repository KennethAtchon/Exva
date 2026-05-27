import { Badge } from "@/components/custom-ui";
import { Button } from "@/components/ui";
import type { SessionSummary } from "@/lib/exva";
import type { ExecutionStage } from "@/lib/types";
import { getSearchProviderDisplayName } from "@electron/shared/instruments/search-providers";
import {
  SessionExecutionProgress,
  type SessionProgressState,
} from "./SessionExecutionProgress";

type LifecycleAction = "start" | "pause" | "resume" | "stop" | "forceStop";

const FORCE_STOP_CONFIRM_MESSAGE =
  "Force stop will end automated exit management for open positions. Continue?";

const STOP_WHEN_FLAT_TITLE =
  "Stops new research immediately and completes shutdown once all open trades close.";

// ---------------------------------------------------------------------------
// SessionControls — lifecycle action button group within each card
// ---------------------------------------------------------------------------

const SessionControls = ({
  session,
  busy,
  aiBlocked,
  hasOpenTrades,
  onFocus,
  onEdit,
  onDuplicate,
  onSaveTemplate,
  onArchive,
  onLifecycle,
}: {
  session: SessionSummary;
  busy: boolean;
  aiBlocked: boolean;
  hasOpenTrades: boolean;
  onFocus: (id: string) => void;
  onEdit: (session: SessionSummary) => void;
  onDuplicate: (session: SessionSummary) => void;
  onSaveTemplate: (session: SessionSummary) => void;
  onArchive: (id: string) => void;
  onLifecycle: (session: SessionSummary, action: LifecycleAction) => void;
}) => {
  const locked =
    session.status === "active" ||
    session.status === "paused" ||
    session.status === "monitoring_only";

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        marginTop: 14,
        borderTop: "1px solid var(--border)",
        paddingTop: 12,
      }}
    >
      <Button
        onClick={() => onFocus(session.id)}
        variant="outline"
        style={{
          ...actionButtonStyle,
          ...(session.isFocused ? focusedButtonStyle : {}),
        }}
        disabled={busy || session.isFocused}
      >
        {session.isFocused ? "Focused" : "Focus"}
      </Button>
      <Button
        onClick={() => onEdit(session)}
        variant="outline"
        style={actionButtonStyle}
        disabled={busy || locked}
      >
        Edit
      </Button>
      <Button
        onClick={() => onDuplicate(session)}
        variant="outline"
        style={actionButtonStyle}
        disabled={busy}
      >
        Duplicate
      </Button>
      <Button
        onClick={() => onSaveTemplate(session)}
        variant="outline"
        style={actionButtonStyle}
        disabled={busy}
      >
        Save Template
      </Button>
      <div style={{ flex: 1 }} />
      {session.status === "draft" ||
      session.status === "idle" ||
      session.status === "stopped" ? (
        <Button
          onClick={() => onLifecycle(session, "start")}
          variant="ghost"
          style={{
            ...primaryActionButtonStyle,
            ...(aiBlocked ? blockedStyle : {}),
          }}
          disabled={busy || aiBlocked}
          title={
            aiBlocked
              ? "AI providers not connected — configure in Strategy tab"
              : undefined
          }
        >
          Start
        </Button>
      ) : null}
      {session.status === "active" ? (
        <Button
          onClick={() => onLifecycle(session, "pause")}
          variant="outline"
          style={actionButtonStyle}
          disabled={busy}
          title="Pause stops new research but keeps exits managed."
        >
          Pause
        </Button>
      ) : null}
      {session.status === "paused" ? (
        <Button
          onClick={() => onLifecycle(session, "resume")}
          variant="ghost"
          style={primaryActionButtonStyle}
          disabled={busy}
        >
          Resume
        </Button>
      ) : null}
      {(session.status === "active" || session.status === "paused") &&
      !hasOpenTrades ? (
        <Button
          onClick={() => onLifecycle(session, "stop")}
          variant="ghost"
          style={dangerButtonStyle}
          disabled={busy}
        >
          Stop
        </Button>
      ) : null}
      {(session.status === "active" || session.status === "paused") &&
      hasOpenTrades ? (
        <Button
          onClick={() => onLifecycle(session, "stop")}
          variant="ghost"
          style={stopWhenFlatButtonStyle}
          disabled={busy}
          title={STOP_WHEN_FLAT_TITLE}
        >
          Stop when flat
        </Button>
      ) : null}
      {(session.status === "active" ||
        session.status === "paused" ||
        session.status === "monitoring_only") &&
      hasOpenTrades ? (
        <Button
          onClick={() => {
            if (!window.confirm(FORCE_STOP_CONFIRM_MESSAGE)) return;
            onLifecycle(session, "forceStop");
          }}
          variant="ghost"
          style={forceStopButtonStyle}
          disabled={busy}
          title="Force stop ends automated exit management for open positions."
        >
          Force stop (loses trade management)
        </Button>
      ) : null}
      <Button
        onClick={() => onArchive(session.id)}
        variant="outline"
        style={actionButtonStyle}
        disabled={busy || locked}
      >
        Archive
      </Button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SessionCard — single session article
// ---------------------------------------------------------------------------

const SessionCard = ({
  session,
  busySessionId,
  focusedSessionAiReady,
  progressBySessionId,
  researchFailuresBySessionId,
  onFocus,
  onEdit,
  onOpen,
  onDuplicate,
  onArchive,
  onSaveTemplate,
  onLifecycle,
  onRetryStep,
  onViewTrace,
  onPauseAfterStep,
}: {
  session: SessionSummary;
  busySessionId?: string | null;
  focusedSessionAiReady?: boolean | null;
  progressBySessionId?: Record<string, SessionProgressState>;
  researchFailuresBySessionId?: Record<
    string,
    { phase: string; error: string; at: string }
  >;
  onFocus: (id: string) => void;
  onEdit: (session: SessionSummary) => void;
  onOpen: (session: SessionSummary) => void;
  onDuplicate: (session: SessionSummary) => void;
  onArchive: (id: string) => void;
  onSaveTemplate: (session: SessionSummary) => void;
  onLifecycle: (session: SessionSummary, action: LifecycleAction) => void;
  onRetryStep?: (
    sessionId: string,
    cycleId: string,
    stage: ExecutionStage,
  ) => void;
  onViewTrace?: (
    sessionId: string,
    cycleId: string,
    stage: ExecutionStage,
  ) => void;
  onPauseAfterStep?: (sessionId: string) => void;
}) => {
  const busy = busySessionId === session.id;
  const aiBlocked = session.isFocused && focusedSessionAiReady === false;
  const hasOpenTrades = session.openTradeCount > 0;
  const isDraining = session.status === "monitoring_only";
  const showOrphanWarning =
    session.status === "stopped" && session.openTradeCount > 0;

  return (
    <article
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 220px",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Left: clickable name + objective */}
        <button
          type="button"
          onClick={() => onOpen(session)}
          style={titleButtonStyle}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              flexWrap: "wrap",
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--text1)",
                letterSpacing: "-0.01em",
              }}
            >
              {session.name}
            </span>
            {session.isFocused ? <Badge variant="blue">focused</Badge> : null}
            <Badge variant={statusVariant(session.status)}>
              {formatSessionStatusLabel(session.status)}
            </Badge>
          </div>
          <div style={objectiveStyle}>{session.objective}</div>
        </button>

        {/* Right: metrics + chips */}
        <div style={{ display: "grid", gap: 8 }}>
          <div style={metricStripStyle}>
            <Metric
              label="uptime"
              value={session.uptimeMin > 0 ? `${session.uptimeMin}m` : "—"}
            />
            <Metric label="trades" value={String(session.openTradeCount)} />
            <Metric label="brokers" value={String(session.brokerCount)} />
          </div>
          <div
            style={{
              display: "flex",
              gap: 5,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {session.instrumentClasses.map((ic) => (
              <span key={ic} style={chipStyle}>
                {formatInstrumentClass(ic)}
              </span>
            ))}
            <span style={{ ...chipStyle, color: "var(--text3)" }}>
              {session.selectionMode === "ai_selected_universe"
                ? "AI"
                : "Manual"}
            </span>
            <span style={{ ...chipStyle, color: "var(--text3)" }}>
              {session.executionMode === "live_allowed" ? "Live" : "Paper"}
            </span>
          </div>
        </div>
      </div>

      {/* Execution progress strip */}
      <SessionExecutionProgress
        sessionId={session.id}
        progress={progressBySessionId?.[session.id] ?? null}
        onRetry={onRetryStep ?? (() => undefined)}
        onViewTrace={onViewTrace ?? (() => undefined)}
        onPauseAfterStep={onPauseAfterStep ?? (() => undefined)}
      />
      {researchFailuresBySessionId?.[session.id] ? (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: "var(--color-error)",
            lineHeight: 1.4,
          }}
        >
          Research phase failed ({researchFailuresBySessionId[session.id].phase}
          ): {researchFailuresBySessionId[session.id].error}
        </div>
      ) : null}
      {isDraining ? (
        <div style={drainBannerStyle}>
          Stopping when flat: managing {session.openTradeCount} open trade
          {session.openTradeCount === 1 ? "" : "s"}. Session stops automatically
          once flat.
        </div>
      ) : null}
      {showOrphanWarning ? (
        <div style={orphanWarningStyle}>
          Stopped with {session.openTradeCount} open trade
          {session.openTradeCount === 1 ? "" : "s"}, no automated exits will
          fire. Restart to resume monitoring.
        </div>
      ) : null}

      {/* Meta strip */}
      <div style={metaGridStyle}>
        <MetaBlock label="Scope" value={session.instrumentScope} />
        <MetaBlock
          label="Allocated"
          value={`$${session.totalAllocatedUsd.toLocaleString()}`}
        />
        <MetaBlock
          label="Search"
          value={getSearchProviderDisplayName(session.defaultSearchProviderId)}
        />
        <MetaBlock label="Updated" value={formatTimestamp(session.updatedAt)} />
      </div>

      <SessionControls
        session={session}
        busy={busy}
        aiBlocked={aiBlocked}
        hasOpenTrades={hasOpenTrades}
        onFocus={onFocus}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onSaveTemplate={onSaveTemplate}
        onArchive={onArchive}
        onLifecycle={onLifecycle}
      />
    </article>
  );
};

// ---------------------------------------------------------------------------
// SessionTable
// ---------------------------------------------------------------------------

export const SessionTable = ({
  sessions,
  busySessionId,
  focusedSessionAiReady,
  progressBySessionId,
  researchFailuresBySessionId,
  onFocus,
  onEdit,
  onOpen,
  onDuplicate,
  onArchive,
  onSaveTemplate,
  onLifecycle,
  onRetryStep,
  onViewTrace,
  onPauseAfterStep,
}: {
  sessions: SessionSummary[];
  busySessionId?: string | null;
  focusedSessionAiReady?: boolean | null;
  progressBySessionId?: Record<string, SessionProgressState>;
  researchFailuresBySessionId?: Record<
    string,
    { phase: string; error: string; at: string }
  >;
  onFocus: (id: string) => void;
  onEdit: (session: SessionSummary) => void;
  onOpen: (session: SessionSummary) => void;
  onDuplicate: (session: SessionSummary) => void;
  onArchive: (id: string) => void;
  onSaveTemplate: (session: SessionSummary) => void;
  onLifecycle: (session: SessionSummary, action: LifecycleAction) => void;
  onRetryStep?: (
    sessionId: string,
    cycleId: string,
    stage: ExecutionStage,
  ) => void;
  onViewTrace?: (
    sessionId: string,
    cycleId: string,
    stage: ExecutionStage,
  ) => void;
  onPauseAfterStep?: (sessionId: string) => void;
}) => {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          busySessionId={busySessionId}
          focusedSessionAiReady={focusedSessionAiReady}
          progressBySessionId={progressBySessionId}
          researchFailuresBySessionId={researchFailuresBySessionId}
          onFocus={onFocus}
          onEdit={onEdit}
          onOpen={onOpen}
          onDuplicate={onDuplicate}
          onArchive={onArchive}
          onSaveTemplate={onSaveTemplate}
          onLifecycle={onLifecycle}
          onRetryStep={onRetryStep}
          onViewTrace={onViewTrace}
          onPauseAfterStep={onPauseAfterStep}
        />
      ))}
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div style={{ textAlign: "center" }}>
    <div
      style={{
        fontSize: 15,
        fontWeight: 700,
        color: "var(--text1)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </div>
    <div
      style={{
        marginTop: 2,
        fontSize: 12,
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        color: "var(--text3)",
      }}
    >
      {label}
    </div>
  </div>
);

const MetaBlock = ({ label, value }: { label: string; value: string }) => (
  <div style={{ minWidth: 0 }}>
    <div
      style={{
        fontSize: 12,
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        color: "var(--text3)",
        marginBottom: 3,
      }}
    >
      {label}
    </div>
    <div
      style={{
        color: "var(--text2)",
        fontSize: 12,
        lineHeight: 1.4,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </div>
  </div>
);

function formatSessionStatusLabel(status: SessionSummary["status"]): string {
  if (status === "monitoring_only") return "Stopping when flat";
  if (status === "attention_required") return "Needs attention";
  return status;
}

function statusVariant(
  status: SessionSummary["status"],
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

function formatInstrumentClass(
  value: SessionSummary["instrumentClasses"][number],
): string {
  return value === "stock"
    ? "Stocks"
    : value === "crypto"
      ? "Crypto"
      : value === "futures"
        ? "Futures"
        : "Predict";
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
  fontSize: 12,
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
  color: "hsl(var(--primary-foreground))",
  fontWeight: 600,
} as const;

const dangerButtonStyle = {
  ...actionButtonStyle,
  border: "1px solid var(--color-error-border)",
  color: "var(--color-error)",
} as const;

const forceStopButtonStyle = {
  ...dangerButtonStyle,
  border: "1px solid var(--color-error-border)",
  background: "var(--color-error-dim)",
  color: "var(--color-error)",
} as const;

const stopWhenFlatButtonStyle = {
  ...actionButtonStyle,
  border: "1px solid var(--color-orange-border)",
  background: "var(--color-orange-dim)",
  color: "var(--color-orange)",
  fontWeight: 600,
} as const;

const drainBannerStyle = {
  marginTop: 8,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-orange-border)",
  background: "var(--color-orange-dim)",
  color: "var(--color-orange)",
  fontSize: 12,
  lineHeight: 1.45,
} as const;

const orphanWarningStyle = {
  marginTop: 8,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-orange-border)",
  background: "var(--color-orange-dim)",
  color: "var(--color-orange)",
  fontSize: 12,
  lineHeight: 1.45,
} as const;

const blockedStyle = {
  opacity: 0.4,
  cursor: "not-allowed",
} as const;
