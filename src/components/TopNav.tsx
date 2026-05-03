import type { CSSProperties } from "react";
import type { DashboardStats, SessionStatus } from "@/lib/types";
import { Dot } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import { Button } from "@/components/ui";

export type PageKey =
  | "dashboard"
  | "sessions"
  | "trades"
  | "strategy"
  | "costs"
  | "devpanel"
  | "accounts";

const NAV_ITEMS: { id: PageKey; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "sessions", label: "Sessions" },
  { id: "trades", label: "Trades" },
  { id: "strategy", label: "Strategy" },
  { id: "costs", label: "API Usage" },
  { id: "devpanel", label: "Developer" },
  { id: "accounts", label: "Accounts" },
];

const SESSION: Record<SessionStatus, { label: string; dot: string; pulse: boolean }> = {
  draft: { label: "Draft", dot: "#94a3b8", pulse: false },
  active: { label: "Active", dot: "#34d399", pulse: true },
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
  const ss = SESSION[sessionStatus];
  const isRunning = sessionStatus === "active" || sessionStatus === "paused";

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
          return (
            <Button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              variant="ghost"
              style={{ ...s.navItem, ...(active ? s.navItemActive : {}) }}
            >
              {item.label}
              {active && <div style={s.navUnderline} />}
            </Button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <div style={s.session}>
        <div style={showMock ? s.mockPill : s.livePill}>
          <Dot color={showMock ? "#fbbf24" : "#34d399"} pulse={!showMock} size={7} />
          <span style={{ fontSize: 12, color: showMock ? "#fbbf24" : "#34d399", fontWeight: 600 }}>
            {showMock ? "Mock Data" : "Live Data"}
          </span>
        </div>

        {stats && sessionStatus === "active" && (
          <div style={s.liveStats}>
            <span style={s.liveStatVal}>{fmt.pnl(stats.daily_pnl_usd)}</span>
            <span style={s.liveStatSep}>·</span>
            <span style={s.liveStatLabel}>{fmt.uptime(stats.session_uptime_min)}</span>
          </div>
        )}

        <div style={s.statusPill}>
          <Dot color={ss.dot} pulse={ss.pulse} size={7} />
          <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 500 }}>{ss.label}</span>
        </div>

        {sessionStatus !== "active" && (
          <Button
            style={s.btnStart}
            variant="ghost"
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
    fontFamily: "var(--font-sans)", display: "flex", alignItems: "center",
    transition: "color 0.15s", whiteSpace: "nowrap",
  },
  navItemActive: { color: "var(--text1)", fontWeight: 500 },
  navUnderline: {
    position: "absolute", bottom: 0, left: 14, right: 14, height: 2,
    background: "var(--accent)", borderRadius: "2px 2px 0 0",
  },
  session: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },
  mockPill: {
    display: "flex", alignItems: "center", gap: 6, padding: "5px 11px",
    background: "rgba(251,191,36,0.1)", borderRadius: 20, border: "1px solid rgba(251,191,36,0.2)",
  },
  livePill: {
    display: "flex", alignItems: "center", gap: 6, padding: "5px 11px",
    background: "rgba(52,211,153,0.1)", borderRadius: 20, border: "1px solid rgba(52,211,153,0.2)",
  },
  liveStats: {
    display: "flex", alignItems: "center", gap: 6,
    paddingRight: 10, borderRight: "1px solid var(--border)",
  },
  liveStatVal: {
    fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "#34d399",
  },
  liveStatSep: { color: "var(--text3)", fontSize: 12 },
  liveStatLabel: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text3)" },
  statusPill: {
    display: "flex", alignItems: "center", gap: 6, padding: "5px 11px",
    background: "var(--surface2)", borderRadius: 20, border: "1px solid var(--border)",
  },
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
