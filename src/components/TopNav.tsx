import { type CSSProperties, useEffect, useState } from "react";
import type { DashboardStats, SessionStatus } from "@/lib/types";
import { Dot } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import { Button } from "@/components/ui";
import { api } from "@/lib/exva";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { SessionSummary } from "@/lib/exva";

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

const SESSION_STATUS: Record<SessionStatus, { label: string; dot: string; pulse: boolean }> = {
  draft: { label: "Draft", dot: "#94a3b8", pulse: false },
  active: { label: "Active", dot: "#34d399", pulse: true },
  attention_required: { label: "Needs Attention", dot: "#fb7185", pulse: true },
  paused: { label: "Paused", dot: "#fbbf24", pulse: false },
  stopped: { label: "Stopped", dot: "#f87171", pulse: false },
  idle: { label: "Idle", dot: "#556068", pulse: false },
  archived: { label: "Archived", dot: "#64748b", pulse: false },
};

interface Props {
  activePage: PageKey;
  onNavigate: (p: PageKey) => void;
  sessionStatus: SessionStatus;
  onSessionAction: (a: "start" | "pause" | "resume" | "stop") => void;
  stats: DashboardStats | null;
  showMock: boolean;
}

export const TopNav = ({
  activePage,
  onNavigate,
  sessionStatus,
  onSessionAction,
  stats,
  showMock,
}: Props) => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const aiReady = useWorkspaceStore((state) => state.focusedSessionAiReady);
  const [focusedSession, setFocusedSession] = useState<SessionSummary | null>(null);

  useEffect(() => {
    if (!focusedSessionId) { setFocusedSession(null); return; }
    api.listSessions({ includeArchived: false })
      .then((res) => {
        const found = res.sessions.find((s) => s.id === focusedSessionId) ?? null;
        setFocusedSession(found);
      })
      .catch(() => setFocusedSession(null));
  }, [focusedSessionId]);

  const ss = SESSION_STATUS[sessionStatus];
  const isRunning = sessionStatus === "active" || sessionStatus === "paused";
  const isGlobal = viewMode === "global" || !focusedSessionId;
  const sessionName = focusedSession?.name ?? "Focused Session";

  const needsStrategyConfig =
    !isGlobal &&
    (sessionStatus === "draft" || sessionStatus === "idle" || sessionStatus === "stopped") &&
    activePage !== "strategy";

  return (
    <header style={s.bar}>
      <div style={s.logo}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M11 2L20 7V15L11 20L2 15V7L11 2Z" fill="var(--accent)" opacity="0.9" />
          <path d="M11 6.5L15.5 9.25V14.5L11 17.25L6.5 14.5V9.25L11 6.5Z" fill="var(--bg)" />
        </svg>
        <span style={s.logoText}>exva</span>
      </div>

      <nav style={s.nav}>
        {NAV_ITEMS.map((item) => {
          const active = activePage === item.id;
          const isStrategy = item.id === "strategy";
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
              title={isStrategy && !isGlobal
                ? `Configure AI phases, risk limits, and strategy for "${sessionName}"`
                : undefined}
            >
              {item.label}
              {isStrategy && needsStrategyConfig && (
                <span style={s.strategyDot} title="This session has unconfigured strategy settings" />
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
          style={showMock ? s.mockPill : s.connectedPill}
          title={showMock
            ? "Using simulated data — no real broker connection"
            : "Connected to live broker data feed"}
        >
          <Dot color={showMock ? "#fbbf24" : "#34d399"} pulse={!showMock} size={7} />
          <span style={{ fontSize: 11, color: showMock ? "#fbbf24" : "#34d399", fontWeight: 500 }}>
            {showMock ? "Mock" : "Connected"}
          </span>
        </div>

        {stats && sessionStatus === "active" && (
          <div style={s.liveStats}>
            <span style={s.liveStatVal}>{fmt.pnl(stats.daily_pnl_usd)}</span>
            <span style={s.liveStatSep}>·</span>
            <span style={s.liveStatLabel}>{fmt.uptime(stats.session_uptime_min)}</span>
          </div>
        )}

        {/* Session context pill */}
        {isGlobal ? (
          <div
            style={s.globalPill}
            title="No session focused — viewing global workspace. Go to Sessions to focus a session."
          >
            <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 500 }}>Global</span>
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

        {!isGlobal && sessionStatus !== "active" && (
          <Button
            style={{
              ...s.btnStart,
              ...(aiReady === false ? { opacity: 0.4, cursor: "not-allowed", background: "var(--surface3)", color: "var(--text3)" } : {}),
            }}
            variant="ghost"
            disabled={aiReady === false}
            title={aiReady === false ? "AI providers not connected — configure in Strategy tab" : undefined}
            onClick={() => onSessionAction(sessionStatus === "paused" ? "resume" : "start")}
          >
            ▶ {sessionStatus === "paused" ? "Resume" : "Start"}
          </Button>
        )}
        {sessionStatus === "active" && (
          <Button variant="ghost" style={s.btnPause} onClick={() => onSessionAction("pause")}>
            ⏸ Pause
          </Button>
        )}
        {isRunning && (
          <Button variant="ghost" style={s.btnStop} onClick={() => onSessionAction("stop")}>
            ■
          </Button>
        )}
      </div>
    </header>
  );
};

const s: Record<string, CSSProperties> = {
  bar: {
    height: 58, display: "flex", alignItems: "center", gap: 0,
    borderBottom: "1px solid var(--border)", padding: "0 28px",
    background: "var(--surface)", flexShrink: 0,
    position: "relative", zIndex: 10,
  },
  logo: { display: "flex", alignItems: "center", gap: 9, marginRight: 36, flexShrink: 0 },
  logoText: {
    fontFamily: "var(--font-mono)", fontSize: 17, fontWeight: 700,
    letterSpacing: "0.08em", color: "var(--text1)",
  },
  nav: { display: "flex", alignItems: "center", gap: 2, height: "100%" },
  navItem: {
    position: "relative", height: "100%", padding: "0 14px",
    background: "none", border: "none", cursor: "pointer",
    fontSize: 13, fontWeight: 400, color: "var(--text2)",
    fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", gap: 6,
    transition: "color 0.15s", whiteSpace: "nowrap",
  },
  navItemActive: { color: "var(--text1)", fontWeight: 500 },
  navItemHint: { color: "oklch(0.65 0.14 240)" },
  navUnderline: {
    position: "absolute", bottom: 0, left: 14, right: 14, height: 2,
    background: "var(--accent)", borderRadius: "2px 2px 0 0",
  },
  strategyDot: {
    width: 6, height: 6, borderRadius: "50%",
    background: "oklch(0.65 0.14 240)",
    display: "inline-block", flexShrink: 0,
  },
  session: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  connectedPill: {
    display: "flex", alignItems: "center", gap: 5, padding: "4px 9px",
    background: "rgba(52,211,153,0.08)", borderRadius: 20, border: "1px solid rgba(52,211,153,0.15)",
    cursor: "default",
  },
  mockPill: {
    display: "flex", alignItems: "center", gap: 5, padding: "4px 9px",
    background: "rgba(251,191,36,0.08)", borderRadius: 20, border: "1px solid rgba(251,191,36,0.18)",
    cursor: "default",
  },
  globalPill: {
    display: "flex", alignItems: "center", gap: 5, padding: "4px 10px",
    background: "var(--surface2)", borderRadius: 20, border: "1px solid var(--border)",
    cursor: "default",
  },
  statusPill: {
    display: "flex", alignItems: "center", gap: 6, padding: "4px 10px",
    background: "var(--surface2)", borderRadius: 20, border: "1px solid var(--border)",
    cursor: "default", maxWidth: 220, overflow: "hidden",
  },
  sessionLabel: {
    fontSize: 11, color: "var(--text1)", fontWeight: 500,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  sessionStatus: {
    fontSize: 10, color: "var(--text3)", fontWeight: 400,
    paddingLeft: 4, borderLeft: "1px solid var(--border)", marginLeft: 2,
    whiteSpace: "nowrap",
  },
  strategyNudge: {
    display: "flex", alignItems: "center", gap: 4,
    padding: "4px 9px", borderRadius: 20,
    border: "1px solid rgba(96,165,250,0.25)",
    background: "rgba(96,165,250,0.08)",
    color: "rgba(96,165,250,0.9)", fontSize: 11, fontWeight: 500,
    cursor: "pointer", whiteSpace: "nowrap",
  },
  liveStats: {
    display: "flex", alignItems: "center", gap: 6,
    paddingRight: 8, borderRight: "1px solid var(--border)",
  },
  liveStatVal: {
    fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "#34d399",
  },
  liveStatSep: { color: "var(--text3)", fontSize: 12 },
  liveStatLabel: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text3)" },
  btnStart: {
    padding: "6px 14px", background: "var(--accent)", border: "none", borderRadius: 8,
    color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
    fontFamily: "var(--font-mono)", letterSpacing: "0.02em",
  },
  btnPause: {
    padding: "6px 14px", background: "rgba(251,191,36,0.1)",
    border: "1px solid rgba(251,191,36,0.25)", borderRadius: 8,
    color: "#fbbf24", fontSize: 12, fontWeight: 600, cursor: "pointer",
    fontFamily: "var(--font-mono)",
  },
  btnStop: {
    padding: "6px 10px", background: "rgba(248,113,113,0.1)",
    border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8,
    color: "#f87171", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-mono)",
  },
};
