import { type CSSProperties, useCallback, useEffect, useState } from "react";
import type { DashboardStats, SessionStatus } from "@/lib/types";
import { Dot } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import { Button } from "@/components/ui";
import { api } from "@/lib/exva";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { sessionMatchesEnvironment } from "@/lib/environment-mode";
import type { SessionSummary } from "@/lib/exva";
import { useExvaEvent } from "@/hooks/useExvaEvent";

export type PageKey =
  | "dashboard"
  | "sessions"
  | "brokers"
  | "trades"
  | "strategy"
  | "costs"
  | "devpanel"
  | "accounts";

const NAV_ITEMS: { id: PageKey; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "sessions", label: "Sessions" },
  { id: "brokers", label: "Brokers" },
  { id: "trades", label: "Trades" },
  { id: "strategy", label: "Strategy" },
  { id: "costs", label: "API Usage" },
  { id: "devpanel", label: "Developer" },
  { id: "accounts", label: "Accounts" },
];

const SESSION_STATUS: Record<
  SessionStatus,
  { label: string; dot: string; pulse: boolean }
> = {
  draft: { label: "Draft", dot: "#94a3b8", pulse: false },
  active: { label: "Active", dot: "#34d399", pulse: true },
  attention_required: { label: "Needs Attention", dot: "#fb7185", pulse: true },
  paused: { label: "Paused", dot: "#fbbf24", pulse: false },
  monitoring_only: {
    label: "Stopping when flat",
    dot: "#fb923c",
    pulse: true,
  },
  stopped: { label: "Stopped", dot: "#f87171", pulse: false },
  idle: { label: "Idle", dot: "#556068", pulse: false },
  archived: { label: "Archived", dot: "#64748b", pulse: false },
};

interface Props {
  activePage: PageKey;
  onNavigate: (p: PageKey) => void;
  onNavigateToAttentionSessions?: () => void;
  sessionStatus: SessionStatus;
  onSessionAction: (a: "start" | "pause" | "resume" | "stop" | "forceStop") => void;
  sessionActionPending?: boolean;
  stats: DashboardStats | null;
}

export const TopNav = ({
  activePage,
  onNavigate,
  onNavigateToAttentionSessions,
  sessionStatus,
  onSessionAction,
  sessionActionPending = false,
  stats,
}: Props) => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const aiReady = useWorkspaceStore((state) => state.focusedSessionAiReady);
  const environmentMode = useWorkspaceStore((state) => state.environmentMode);
  const [focusedSession, setFocusedSession] = useState<SessionSummary | null>(
    null,
  );
  const [attentionCount, setAttentionCount] = useState(0);

  const refreshAttentionCount = useCallback(() => {
    api
      .listSessions({ includeArchived: false })
      .then((res) => {
        setAttentionCount(
          res.sessions.filter((s) => s.status === "attention_required").length,
        );
        if (focusedSessionId) {
          const found =
            res.sessions.find((s) => s.id === focusedSessionId) ?? null;
          setFocusedSession(found);
        }
      })
      .catch(() => {
        setAttentionCount(0);
        // Don't clear focusedSession on transient IPC error — preserving the
        // last known value prevents sessionControlsDisabled from locking all
        // buttons until the next successful poll.
      });
  }, [focusedSessionId]);

  useEffect(() => {
    if (!focusedSessionId) {
      setFocusedSession(null);
      refreshAttentionCount();
      return;
    }
    refreshAttentionCount();
  }, [focusedSessionId, environmentMode, refreshAttentionCount]);

  useExvaEvent("session_status_changed", () => {
    refreshAttentionCount();
  });
  useExvaEvent("stats_update", () => {
    refreshAttentionCount();
  });

  const focusedInCurrentEnvironment =
    focusedSession != null &&
    sessionMatchesEnvironment(
      focusedSession.executionMode,
      environmentMode,
    );
  const sessionControlsDisabled =
    !focusedInCurrentEnvironment || viewMode === "global" || sessionActionPending;

  const ss = SESSION_STATUS[sessionStatus];
  const isRunning = sessionStatus === "active" || sessionStatus === "paused";
  const isDraining = sessionStatus === "monitoring_only";
  const isMonitorAlive = isRunning || isDraining;
  const openTradeCount = focusedSession?.openTradeCount ?? 0;
  const hasOpenTrades = openTradeCount > 0;
  const stopWhenFlatTitle =
    "Stops new research immediately and completes shutdown once all open trades close.";
  const isGlobal =
    viewMode === "global" || !focusedSessionId || !focusedInCurrentEnvironment;
  const sessionName = focusedInCurrentEnvironment
    ? (focusedSession?.name ?? "Focused Session")
    : "Focused Session";

  const needsStrategyConfig =
    !isGlobal &&
    (sessionStatus === "draft" ||
      sessionStatus === "idle" ||
      sessionStatus === "stopped") &&
    activePage !== "strategy";

  return (
    <header style={s.bar}>
      <div style={s.logo}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path
            d="M11 2L20 7V15L11 20L2 15V7L11 2Z"
            fill="var(--accent)"
            opacity="0.9"
          />
          <path
            d="M11 6.5L15.5 9.25V14.5L11 17.25L6.5 14.5V9.25L11 6.5Z"
            fill="var(--bg)"
          />
        </svg>
        <span style={s.logoText}>exva</span>
      </div>

      <nav style={s.nav}>
        {NAV_ITEMS.map((item) => {
          const active = activePage === item.id;
          const isStrategy = item.id === "strategy";
          const isSessions = item.id === "sessions";
          return (
            <Button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              variant="ghost"
              style={{
                ...s.navItem,
                ...(active ? s.navItemActive : {}),
                ...(isStrategy && needsStrategyConfig ? s.navItemHint : {}),
              }}
              title={
                isStrategy && !isGlobal
                  ? `Configure AI phases, risk limits, and strategy for "${sessionName}"`
                  : undefined
              }
            >
              {item.label}
              {isSessions && attentionCount > 0 && (
                <span
                  style={s.attentionBadgeStyle}
                  title={`${attentionCount} session(s) need attention`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNavigateToAttentionSessions?.();
                  }}
                >
                  {attentionCount}
                </span>
              )}
              {isStrategy && needsStrategyConfig && (
                <span
                  style={s.strategyDot}
                  title="This session has unconfigured strategy settings"
                />
              )}
              {active && <div style={s.navUnderline} />}
            </Button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <div style={s.session}>
        {/* Data source indicator */}
        <div
          style={
            environmentMode === "live" ? s.liveEnvPill : s.paperEnvPill
          }
          title={
            environmentMode === "live"
              ? "Live trading mode — real broker connection"
              : "Paper trading mode — no real orders"
          }
        >
          <Dot
            color={environmentMode === "live" ? "#34d399" : "#fbbf24"}
            pulse={environmentMode === "live"}
            size={7}
          />
          <span
            style={{
              fontSize: 11,
              color: environmentMode === "live" ? "#34d399" : "#fbbf24",
              fontWeight: 500,
            }}
          >
            {environmentMode === "live" ? "Live" : "Paper"}
          </span>
        </div>

        {stats && sessionStatus === "active" && (
          <div style={s.liveStats}>
            <span style={s.liveStatVal}>{fmt.pnl(stats.daily_pnl_usd)}</span>
            <span style={s.liveStatSep}>·</span>
            <span style={s.liveStatLabel}>
              {fmt.uptime(stats.session_uptime_min)}
            </span>
          </div>
        )}

        {/* Session context pill */}
        {isGlobal ? (
          <div
            style={s.globalPill}
            title="No session focused — viewing global workspace. Go to Sessions to focus a session."
          >
            <span
              style={{ fontSize: 11, color: "var(--text3)", fontWeight: 500 }}
            >
              Global
            </span>
          </div>
        ) : (
          <div
            style={s.statusPill}
            title={`Focused session: "${sessionName}" — status: ${ss.label}`}
          >
            <Dot color={ss.dot} pulse={ss.pulse} size={7} />
            <span style={s.sessionLabel}>{sessionName}</span>
            <span style={s.sessionStatus}>{ss.label}</span>
          </div>
        )}

        {!isGlobal &&
          sessionStatus !== "active" &&
          sessionStatus !== "monitoring_only" && (
          <Button
            style={{
              ...s.btnStart,
              ...(aiReady === false || sessionControlsDisabled
                ? {
                    opacity: 0.4,
                    cursor: "not-allowed",
                    background: "var(--surface3)",
                    color: "var(--text3)",
                  }
                : {}),
            }}
            variant="ghost"
            disabled={aiReady === false || sessionControlsDisabled}
            title={
              sessionControlsDisabled
                ? "Focused session is not in the current workspace environment"
                : aiReady === false
                  ? "AI providers not connected — configure in Strategy tab"
                  : undefined
            }
            onClick={() =>
              onSessionAction(
                sessionStatus === "paused" || sessionStatus === "attention_required"
                  ? "resume"
                  : "start",
              )
            }
          >
            ▶{" "}
            {sessionStatus === "paused" || sessionStatus === "attention_required"
              ? "Resume"
              : "Start"}
          </Button>
        )}
        {sessionStatus === "active" && !sessionControlsDisabled && (
          <Button
            variant="ghost"
            style={s.btnPause}
            disabled={sessionActionPending}
            onClick={() => onSessionAction("pause")}
            title="Pause stops new research but keeps exits managed."
          >
            {sessionActionPending ? "⏸ Pausing…" : "⏸ Pause"}
          </Button>
        )}
        {isRunning && !sessionControlsDisabled && !hasOpenTrades ? (
          <Button
            variant="ghost"
            style={s.btnStop}
            disabled={sessionActionPending}
            onClick={() => onSessionAction("stop")}
          >
            ■
          </Button>
        ) : null}
        {isRunning && !sessionControlsDisabled && hasOpenTrades ? (
          <Button
            variant="ghost"
            style={s.btnStopWhenFlat}
            disabled={sessionActionPending}
            title={stopWhenFlatTitle}
            onClick={() => onSessionAction("stop")}
          >
            {sessionActionPending ? "Stopping…" : "Stop when flat"}
          </Button>
        ) : null}
        {isMonitorAlive && !sessionControlsDisabled && hasOpenTrades ? (
          <Button
            variant="ghost"
            style={s.btnForceStop}
            disabled={sessionActionPending}
            title="Force stop ends automated exit management for open positions."
            onClick={() => onSessionAction("forceStop")}
          >
            Force stop
          </Button>
        ) : null}
      </div>
    </header>
  );
};

const s: Record<string, CSSProperties> = {
  bar: {
    height: 58,
    display: "flex",
    alignItems: "center",
    gap: 0,
    borderBottom: "1px solid var(--border)",
    padding: "0 28px",
    background: "var(--surface)",
    flexShrink: 0,
    position: "relative",
    zIndex: 10,
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    marginRight: 36,
    flexShrink: 0,
  },
  logoText: {
    fontFamily: "var(--font-mono)",
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "var(--text1)",
  },
  nav: { display: "flex", alignItems: "center", gap: 2, height: "100%" },
  navItem: {
    position: "relative",
    height: "100%",
    padding: "0 14px",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 400,
    color: "var(--text2)",
    fontFamily: "var(--font-sans)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    transition: "color 0.15s",
    whiteSpace: "nowrap",
  },
  navItemActive: { color: "var(--text1)", fontWeight: 500 },
  navItemHint: { color: "oklch(0.65 0.14 240)" },
  navUnderline: {
    position: "absolute",
    bottom: 0,
    left: 14,
    right: 14,
    height: 2,
    background: "var(--accent)",
    borderRadius: "2px 2px 0 0",
  },
  strategyDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "oklch(0.65 0.14 240)",
    display: "inline-block",
    flexShrink: 0,
  },
  attentionBadgeStyle: {
    minWidth: 18,
    height: 18,
    padding: "0 5px",
    borderRadius: 999,
    background: "rgba(251,113,133,0.18)",
    border: "1px solid rgba(251,113,133,0.35)",
    color: "#fb7185",
    fontSize: 10,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "var(--font-mono)",
  },
  session: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  liveEnvPill: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 9px",
    background: "rgba(52,211,153,0.08)",
    borderRadius: 20,
    border: "1px solid rgba(52,211,153,0.15)",
    cursor: "default",
  },
  paperEnvPill: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 9px",
    background: "rgba(251,191,36,0.08)",
    borderRadius: 20,
    border: "1px solid rgba(251,191,36,0.18)",
    cursor: "default",
  },
  globalPill: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 10px",
    background: "var(--surface2)",
    borderRadius: 20,
    border: "1px solid var(--border)",
    cursor: "default",
  },
  statusPill: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    background: "var(--surface2)",
    borderRadius: 20,
    border: "1px solid var(--border)",
    cursor: "default",
    maxWidth: 220,
    overflow: "hidden",
  },
  sessionLabel: {
    fontSize: 11,
    color: "var(--text1)",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sessionStatus: {
    fontSize: 10,
    color: "var(--text3)",
    fontWeight: 400,
    paddingLeft: 4,
    borderLeft: "1px solid var(--border)",
    marginLeft: 2,
    whiteSpace: "nowrap",
  },
  strategyNudge: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 9px",
    borderRadius: 20,
    border: "1px solid rgba(96,165,250,0.25)",
    background: "rgba(96,165,250,0.08)",
    color: "rgba(96,165,250,0.9)",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  liveStats: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingRight: 8,
    borderRight: "1px solid var(--border)",
  },
  liveStatVal: {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    fontWeight: 700,
    color: "#34d399",
  },
  liveStatSep: { color: "var(--text3)", fontSize: 12 },
  liveStatLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--text3)",
  },
  btnStart: {
    padding: "6px 14px",
    background: "var(--accent)",
    border: "none",
    borderRadius: 8,
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.02em",
  },
  btnPause: {
    padding: "6px 14px",
    background: "rgba(251,191,36,0.1)",
    border: "1px solid rgba(251,191,36,0.25)",
    borderRadius: 8,
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
  },
  btnStop: {
    padding: "6px 10px",
    background: "rgba(248,113,113,0.1)",
    border: "1px solid rgba(248,113,113,0.2)",
    borderRadius: 8,
    color: "#f87171",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
  },
  btnStopWhenFlat: {
    padding: "6px 10px",
    background: "rgba(251,146,60,0.12)",
    border: "1px solid rgba(251,146,60,0.35)",
    borderRadius: 8,
    color: "#fdba74",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    whiteSpace: "nowrap",
  },
  btnForceStop: {
    padding: "6px 10px",
    background: "rgba(127,29,29,0.28)",
    border: "1px solid rgba(239,68,68,0.55)",
    borderRadius: 8,
    color: "#fecaca",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
  },
};
