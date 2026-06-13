import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import type { DashboardStats, SessionStatus } from "@/lib/types";
import { Dot } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import { Button } from "@/components/ui";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppNavSidebar } from "@/components/AppNavSidebar";
import { api } from "@/lib/exva";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { sessionMatchesEnvironment } from "@/lib/environment-mode";
import type { SessionSummary } from "@/lib/exva";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { useTheme } from "@/hooks/useTheme";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useNavSidebar } from "@/hooks/useNavSidebar";
import { NAV_ITEMS, NAV_WIDE_MEDIA, type PageKey } from "@/lib/nav";
import { cn } from "@/lib/utils";

export type { PageKey };

const SESSION_STATUS: Record<
  SessionStatus,
  { label: string; dot: string; pulse: boolean }
> = {
  draft: { label: "Draft", dot: "var(--text3)", pulse: false },
  active: { label: "Active", dot: "var(--color-success)", pulse: true },
  attention_required: {
    label: "Needs Attention",
    dot: "var(--color-error)",
    pulse: true,
  },
  paused: { label: "Paused", dot: "var(--color-warning)", pulse: false },
  monitoring_only: {
    label: "Stopping when flat",
    dot: "var(--color-orange)",
    pulse: true,
  },
  stopped: { label: "Stopped", dot: "var(--color-error)", pulse: false },
  idle: { label: "Idle", dot: "var(--text3)", pulse: false },
  archived: { label: "Archived", dot: "var(--text2)", pulse: false },
};

const navClass = {
  bar: "relative z-10 flex h-[58px] min-w-0 shrink-0 items-center gap-0 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-7 py-0",
  barCompact: "px-3",
  logo: "mr-9 flex shrink-0 items-center gap-[9px]",
  logoText:
    "font-mono text-[17px] font-bold tracking-[0.08em] text-[var(--text1)]",
  nav: "flex h-full items-center gap-0.5",
  navItem:
    "relative flex h-full cursor-pointer items-center gap-1.5 whitespace-nowrap border-none bg-transparent px-[14px] py-0 font-sans text-[13px] font-normal text-[var(--text2)] transition-colors duration-150",
  navItemActive: "font-medium text-[var(--text1)]",
  navItemHint: "text-[var(--accent)]",
  navUnderline:
    "absolute bottom-0 left-[14px] right-[14px] h-0.5 rounded-t-[2px] bg-[var(--accent)]",
  strategyDot:
    "inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]",
  attentionBadge:
    "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-error-border bg-error-dim px-[5px] py-0 font-mono text-[12px] font-bold text-error",
  session: "flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2",
  liveEnvPill:
    "flex cursor-default items-center gap-[5px] rounded-[20px] border border-success-border bg-success-dim px-[9px] py-1",
  paperEnvPill:
    "flex cursor-default items-center gap-[5px] rounded-[20px] border border-warning-border bg-warning-dim px-[9px] py-1",
  envLabelLive: "text-[12px] font-medium text-success",
  envLabelPaper: "text-[12px] font-medium text-warning",
  globalPill:
    "flex cursor-default items-center gap-[5px] rounded-[20px] border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1",
  globalLabel: "text-[12px] font-medium text-[var(--text3)]",
  statusPill:
    "flex max-w-[220px] cursor-default items-center gap-1.5 overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1",
  sessionLabel:
    "overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-medium text-[var(--text1)]",
  sessionStatus:
    "ml-0.5 whitespace-nowrap border-l border-[var(--border)] pl-1 text-[12px] font-normal text-[var(--text3)]",
  liveStats: "flex items-center gap-1.5 border-r border-[var(--border)] pr-2",
  liveStatVal: "font-mono text-[13px] font-bold text-success",
  liveStatSep: "text-[12px] text-[var(--text3)]",
  liveStatLabel: "font-mono text-[12px] text-[var(--text3)]",
  btnStart:
    "cursor-pointer rounded-lg border-none bg-[var(--accent)] px-3.5 py-1.5 font-mono text-[12px] font-bold tracking-[0.02em] text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:bg-[var(--surface3)] disabled:text-[var(--text3)] disabled:opacity-40",
  btnPause:
    "cursor-pointer rounded-lg border border-warning-border bg-warning-dim px-3.5 py-1.5 font-mono text-[12px] font-semibold text-warning",
  btnStop:
    "cursor-pointer rounded-lg border border-error-border bg-error-dim px-2.5 py-1.5 font-mono text-[12px] text-error",
  btnStopWhenFlat:
    "cursor-pointer whitespace-nowrap rounded-lg border border-status-orange-border bg-status-orange-dim px-2.5 py-1.5 font-mono text-[12px] font-semibold text-status-orange",
  btnForceStop:
    "cursor-pointer rounded-lg border border-error-border bg-error-dim px-2.5 py-1.5 font-mono text-[12px] font-bold text-error",
  sidebarToggle:
    "mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text2)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text1)]",
} as const;

interface NavShellProps {
  activePage: PageKey;
  onNavigate: (p: PageKey) => void;
  onNavigateToAttentionSessions?: () => void;
  sessionStatus: SessionStatus;
  onSessionAction: (
    a: "start" | "pause" | "resume" | "stop" | "forceStop",
  ) => void;
  sessionActionPending?: boolean;
  stats: DashboardStats | null;
  children: ReactNode;
}

type SessionStatusView = {
  context: "global" | "focused";
  lifecycle: "inactive" | "active" | "draining";
  tradeState: "none" | "open";
};

const NavItems = ({
  activePage,
  onNavigate,
  onNavigateToAttentionSessions,
  attentionCount,
  needsStrategyConfig,
  isGlobal,
  sessionName,
}: {
  activePage: PageKey;
  onNavigate: (p: PageKey) => void;
  onNavigateToAttentionSessions?: () => void;
  attentionCount: number;
  needsStrategyConfig: boolean;
  isGlobal: boolean;
  sessionName: string;
}) => (
  <nav className={navClass.nav}>
    {NAV_ITEMS.map((item) => {
      const active = activePage === item.id;
      const isStrategy = item.id === "strategy";
      const isSessions = item.id === "sessions";
      return (
        <Button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          variant="ghost"
          className={cn(
            navClass.navItem,
            active && navClass.navItemActive,
            isStrategy && needsStrategyConfig && navClass.navItemHint,
          )}
          title={
            isStrategy && !isGlobal
              ? `Configure AI phases, risk limits, and strategy for "${sessionName}"`
              : undefined
          }
        >
          {item.label}
          {isSessions && attentionCount > 0 && (
            <span
              className={navClass.attentionBadge}
              title={`${attentionCount} session(s) need attention`}
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onNavigateToAttentionSessions?.();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onNavigateToAttentionSessions?.();
                }
              }}
            >
              {attentionCount}
            </span>
          )}
          {isStrategy && needsStrategyConfig && (
            <span
              className={navClass.strategyDot}
              title="This session has unconfigured strategy settings"
            />
          )}
          {active && <div className={navClass.navUnderline} />}
        </Button>
      );
    })}
  </nav>
);

const NavStatus = ({
  environmentMode,
  stats,
  sessionStatus,
  statusView,
  sessionName,
  ss,
  aiReady,
  sessionControlsDisabled,
  sessionActionPending,
  onSessionAction,
}: {
  environmentMode: "live" | "paper";
  stats: DashboardStats | null;
  sessionStatus: SessionStatus;
  statusView: SessionStatusView;
  sessionName: string;
  ss: { label: string; dot: string; pulse: boolean };
  aiReady: boolean | null | undefined;
  sessionControlsDisabled: boolean;
  sessionActionPending: boolean;
  onSessionAction: (
    a: "start" | "pause" | "resume" | "stop" | "forceStop",
  ) => void;
}) => {
  const isGlobal = statusView.context === "global";
  const isRunning = statusView.lifecycle === "active";
  const isMonitorAlive = statusView.lifecycle !== "inactive";
  const hasOpenTrades = statusView.tradeState === "open";
  const stopWhenFlatTitle =
    "Stops new research immediately and completes shutdown once all open trades close.";
  const startDisabled = aiReady === false || sessionControlsDisabled;
  return (
    <div className={navClass.session}>
      <div
        className={
          environmentMode === "live"
            ? navClass.liveEnvPill
            : navClass.paperEnvPill
        }
        title={
          environmentMode === "live"
            ? "Live trading mode — real broker connection"
            : "Paper trading mode — no real orders"
        }
      >
        <Dot
          color={
            environmentMode === "live"
              ? "var(--color-success)"
              : "var(--color-warning)"
          }
          pulse={environmentMode === "live"}
          size={7}
        />
        <span
          className={
            environmentMode === "live"
              ? navClass.envLabelLive
              : navClass.envLabelPaper
          }
        >
          {environmentMode === "live" ? "Live" : "Paper"}
        </span>
      </div>

      {stats && sessionStatus === "active" && (
        <div className={navClass.liveStats}>
          <span className={navClass.liveStatVal}>
            {fmt.pnl(stats.daily_pnl_usd)}
          </span>
          <span className={navClass.liveStatSep}>·</span>
          <span className={navClass.liveStatLabel}>
            {fmt.uptime(stats.session_uptime_min)}
          </span>
        </div>
      )}

      {isGlobal ? (
        <div
          className={navClass.globalPill}
          title="No session focused — viewing global workspace. Go to Sessions to focus a session."
        >
          <span className={navClass.globalLabel}>Global</span>
        </div>
      ) : (
        <div
          className={navClass.statusPill}
          title={`Focused session: "${sessionName}" — status: ${ss.label}`}
        >
          <Dot color={ss.dot} pulse={ss.pulse} size={7} />
          <span className={navClass.sessionLabel}>{sessionName}</span>
          <span className={navClass.sessionStatus}>{ss.label}</span>
        </div>
      )}

      {!isGlobal &&
        sessionStatus !== "active" &&
        sessionStatus !== "monitoring_only" && (
          <Button
            className={navClass.btnStart}
            variant="ghost"
            disabled={startDisabled}
            title={
              sessionControlsDisabled
                ? "Focused session is not in the current workspace environment"
                : aiReady === false
                  ? "AI providers not connected — configure in Strategy tab"
                  : undefined
            }
            onClick={() =>
              onSessionAction(
                sessionStatus === "paused" ||
                  sessionStatus === "attention_required"
                  ? "resume"
                  : "start",
              )
            }
          >
            ▶{" "}
            {sessionStatus === "paused" ||
            sessionStatus === "attention_required"
              ? "Resume"
              : "Start"}
          </Button>
        )}
      {sessionStatus === "active" && !sessionControlsDisabled && (
        <Button
          variant="ghost"
          className={navClass.btnPause}
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
          className={navClass.btnStop}
          disabled={sessionActionPending}
          onClick={() => onSessionAction("stop")}
        >
          ■
        </Button>
      ) : null}
      {isRunning && !sessionControlsDisabled && hasOpenTrades ? (
        <Button
          variant="ghost"
          className={navClass.btnStopWhenFlat}
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
          className={navClass.btnForceStop}
          disabled={sessionActionPending}
          title="Force stop ends automated exit management for open positions."
          onClick={() => onSessionAction("forceStop")}
        >
          Force stop
        </Button>
      ) : null}
    </div>
  );
};

export const NavShell = ({
  activePage,
  onNavigate,
  onNavigateToAttentionSessions,
  sessionStatus,
  onSessionAction,
  sessionActionPending = false,
  stats,
  children,
}: NavShellProps) => {
  const isNavWide = useMediaQuery(NAV_WIDE_MEDIA);
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } =
    useNavSidebar();
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

  const { theme, toggleTheme } = useTheme();
  const focusedInCurrentEnvironment =
    focusedSession != null &&
    sessionMatchesEnvironment(focusedSession.executionMode, environmentMode);
  const sessionControlsDisabled =
    !focusedInCurrentEnvironment ||
    viewMode === "global" ||
    sessionActionPending;

  const ss = SESSION_STATUS[sessionStatus];
  const isRunning = sessionStatus === "active" || sessionStatus === "paused";
  const isDraining = sessionStatus === "monitoring_only";
  const openTradeCount = focusedSession?.openTradeCount ?? 0;
  const hasOpenTrades = openTradeCount > 0;
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
  const statusView: SessionStatusView = {
    context: isGlobal ? "global" : "focused",
    lifecycle: isDraining ? "draining" : isRunning ? "active" : "inactive",
    tradeState: hasOpenTrades ? "open" : "none",
  };

  const sidebarProps = {
    activePage,
    onNavigate,
    onNavigateToAttentionSessions,
    collapsed: sidebarCollapsed,
    onToggleCollapse: toggleSidebar,
    attentionCount,
    needsStrategyConfig,
    isGlobal,
    sessionName,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-[var(--bg)] font-sans text-[var(--text1)]">
        {!isNavWide && <AppNavSidebar {...sidebarProps} />}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header
            className={cn(navClass.bar, !isNavWide && navClass.barCompact)}
          >
            {isNavWide ? (
              <div className={navClass.logo}>
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
                <span className={navClass.logoText}>exva</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={toggleSidebar}
                className={navClass.sidebarToggle}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={
                  sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                }
              >
                <PanelLeft size={18} />
              </button>
            )}

            {isNavWide && (
              <NavItems
                activePage={activePage}
                onNavigate={onNavigate}
                onNavigateToAttentionSessions={onNavigateToAttentionSessions}
                attentionCount={attentionCount}
                needsStrategyConfig={needsStrategyConfig}
                isGlobal={isGlobal}
                sessionName={sessionName}
              />
            )}

            <div className="flex-1" />

            <button
              onClick={toggleTheme}
              title={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text2)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text1)]"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>

            <NavStatus
              environmentMode={environmentMode}
              stats={stats}
              sessionStatus={sessionStatus}
              statusView={statusView}
              sessionName={sessionName}
              ss={ss}
              aiReady={aiReady}
              sessionControlsDisabled={sessionControlsDisabled}
              sessionActionPending={sessionActionPending}
              onSessionAction={onSessionAction}
            />
          </header>

          {children}
        </div>
      </div>
    </TooltipProvider>
  );
};

/** @deprecated Use NavShell instead */
export const TopNav = NavShell;
