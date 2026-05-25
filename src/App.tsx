import { useCallback, useEffect, useState } from "react";
import { RuntimeEventToast } from "./components/RuntimeEventToast";
import { TopNav, type PageKey } from "./components/TopNav";
import { LiveReadinessModal } from "./components/sessions/LiveReadinessModal";
import { Dashboard } from "./pages/Dashboard";
import { BrokersPage } from "./pages/BrokersPage";
import { SessionsPage } from "./pages/SessionsPage";
import { TradesPage } from "./pages/TradesPage";
import { TradeDetail } from "./pages/TradeDetail";
import { StrategyConfig } from "./pages/StrategyConfig";
import { CostBreakdownPage } from "./pages/CostBreakdown";
import { DevPanel, type DevPanelFocus } from "./pages/DevPanel";
import { AccountsPage } from "./pages/AccountsPage";
import { useSessionStore } from "./store/sessionStore";
import { useTradeStore } from "./store/tradeStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { api, type SessionSummary } from "./lib/exva";
import { executionModeForEnvironment } from "./lib/environment-mode";
import { useExvaEvent } from "./hooks/useExvaEvent";
import { usePolling } from "./hooks/usePolling";
import type { SessionStatus } from "@/lib/types";

interface LiveReadinessReport {
  readyToStart: boolean;
  allChecksPassed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    requiresAck?: boolean;
    message?: string;
  }>;
  acknowledgedAt: string | null;
}

export default function App() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const [sessionsStatusFilter, setSessionsStatusFilter] = useState<
    SessionStatus | "all"
  >("all");
  const [devPanelFocus, setDevPanelFocus] = useState<DevPanelFocus | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionActionPending, setSessionActionPending] = useState(false);
  const [liveReadinessSession, setLiveReadinessSession] =
    useState<SessionSummary | null>(null);
  const [liveReadinessReport, setLiveReadinessReport] =
    useState<LiveReadinessReport | null>(null);
  const status = useSessionStore((s) => s.status);
  const setStatus = useSessionStore((s) => s.setStatus);
  const stats = useSessionStore((s) => s.stats);
  const setStats = useSessionStore((s) => s.setStats);

  const setTrades = useTradeStore((s) => s.setTrades);
  const selectedId = useTradeStore((s) => s.selectedId);
  const setSelected = useTradeStore((s) => s.setSelected);
  const loadWorkspaceView = useWorkspaceStore((s) => s.loadWorkspaceView);
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const focusedSessionId = useWorkspaceStore((s) => s.focusedSessionId);
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);

  const reloadTrades = useCallback(() => {
    return api
      .getActiveTrades({
        executionMode: executionModeForEnvironment(environmentMode),
      })
      .then(setTrades)
      .catch((err) => {
        setLoadError(
          (current) =>
            current ??
            (err instanceof Error ? err.message : "Failed to load trades."),
        );
      });
  }, [environmentMode, setTrades]);

  const reloadStats = useCallback(() => {
    return api
      .getDashboardStats()
      .then((next) => {
        setStats(next);
        setStatus(next.session_status);
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError(
          (current) =>
            current ??
            (err instanceof Error
              ? err.message
              : "Failed to load dashboard stats."),
        );
      });
  }, [setStats, setStatus]);

  useEffect(() => {
    void reloadStats();
    void reloadTrades();
    void loadWorkspaceView();
  }, [loadWorkspaceView, reloadStats, reloadTrades]);

  useEffect(() => {
    void reloadStats();
    if (page === "trades") return;
    void reloadTrades();
  }, [focusedSessionId, page, reloadStats, reloadTrades, viewMode]);

  useEffect(() => {
    void reloadStats();
    void reloadTrades();
  }, [environmentMode, reloadStats, reloadTrades]);

  useExvaEvent("stats_update", () => {
    void reloadStats();
  });
  useExvaEvent("trade_opened", () => {
    void reloadTrades();
  });
  useExvaEvent("trade_closed", () => {
    void reloadTrades();
  });
  useExvaEvent("session_status_changed", () => {
    void reloadStats();
  });

  usePolling(
    async () => {
      const next = await api.getDashboardStats();
      setStats(next);
      setStatus(next.session_status);
    },
    5000,
    status !== "idle",
  );

  const handleSession = async (
    action: "start" | "pause" | "resume" | "stop" | "forceStop",
  ) => {
    if (sessionActionPending) return;
    setSessionActionPending(true);
    setLoadError(null);
    try {
      if (action === "start" || action === "resume") {
        const sessions = await api.listSessions({ includeArchived: false });
        const focused = sessions.sessions.find(
          (session) => session.id === focusedSessionId,
        );
        if (
          focused?.executionMode === "live_allowed" &&
          environmentMode === "live"
        ) {
          const readiness = await api.getLiveReadiness(focused.id);
          if (!readiness.readyToStart || !readiness.acknowledgedAt) {
            setLiveReadinessReport(readiness);
            setLiveReadinessSession(focused);
            return;
          }
        }
        setStatus(await api.startSession());
      } else if (action === "pause") {
        setStatus(await api.pauseSession());
      } else if (action === "stop") {
        setStatus(await api.stopSession());
      } else if (action === "forceStop") {
        if (
          !window.confirm(
            "Force stop will end automated exit management for open positions. Continue?",
          )
        ) {
          return;
        }
        setStatus(await api.forceStopSession());
      }
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Session action failed.",
      );
    } finally {
      setSessionActionPending(false);
    }
  };

  const pageEl = () => {
    switch (page) {
      case "dashboard":
        return <Dashboard />;
      case "sessions":
        return (
          <SessionsPage
            initialStatusFilter={sessionsStatusFilter}
            onInitialStatusFilterApplied={() => setSessionsStatusFilter("all")}
            onGoToStrategy={() => setPage("strategy")}
            onGoToAccounts={() => setPage("accounts")}
            onViewTrace={(sessionId, cycleId, stage) => {
              setDevPanelFocus({ sessionId, cycleId, stage });
              setPage("devpanel");
            }}
          />
        );
      case "brokers":
        return (
          <BrokersPage
            onJumpToSession={async (sessionId) => {
              await api.focusSession(sessionId);
              await loadWorkspaceView();
              setPage("sessions");
            }}
          />
        );
      case "trades":
        return <TradesPage />;
      case "strategy":
        return <StrategyConfig onGoToSessions={() => setPage("sessions")} />;
      case "costs":
        return <CostBreakdownPage />;
      case "devpanel":
        return (
          <DevPanel
            focus={devPanelFocus}
            onFocusConsumed={() => setDevPanelFocus(null)}
          />
        );
      case "accounts":
        return <AccountsPage />;
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        background: "var(--bg)",
        color: "var(--text1)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <TopNav
        activePage={page}
        onNavigate={(p) => {
          setPage(p);
          setSelected(null);
          if (p !== "sessions") setSessionsStatusFilter("all");
        }}
        onNavigateToAttentionSessions={() => {
          setSessionsStatusFilter("attention_required");
          setPage("sessions");
          setSelected(null);
        }}
        sessionStatus={status}
        onSessionAction={handleSession}
        sessionActionPending={sessionActionPending}
        stats={stats}
      />
      {loadError && (
        <div
          style={{
            padding: "10px 28px",
            borderBottom: "1px solid rgba(248,113,113,0.18)",
            background: "rgba(248,113,113,0.08)",
            color: "#fca5a5",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
          }}
        >
          {loadError}
        </div>
      )}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {pageEl()}
      </div>
      <RuntimeEventToast />
      {selectedId && (
        <TradeDetail tradeId={selectedId} onClose={() => setSelected(null)} />
      )}
      {liveReadinessSession && liveReadinessReport ? (
        <LiveReadinessModal
          sessionId={liveReadinessSession.id}
          report={liveReadinessReport}
          onAcknowledged={async () => {
            const session = liveReadinessSession;
            setLiveReadinessReport(null);
            setLiveReadinessSession(null);
            try {
              setStatus(await api.startSession());
            } catch (error) {
              setLoadError(
                error instanceof Error
                  ? error.message
                  : "Failed to start session.",
              );
            }
          }}
          onCancel={() => {
            setLiveReadinessReport(null);
            setLiveReadinessSession(null);
          }}
        />
      ) : null}
    </div>
  );
}
