import { useCallback, useEffect, useReducer, useRef } from "react";
import { RuntimeEventToast } from "./components/RuntimeEventToast";
import { TopNav, type PageKey } from "./components/TopNav";
import { LiveReadinessModal } from "./components/sessions/LiveReadinessModal";
import { Dashboard } from "./pages/Dashboard";
import { BrokersPage } from "./pages/BrokersPage";
import { SessionsPage } from "./pages/SessionsPage";
import { TradesPage } from "./pages/TradesPage";
import { TradeDetail } from "./pages/TradeDetail";
import { AutopsyPage } from "./pages/AutopsyPage";
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

const appRootStyle = {
  display: "flex",
  flexDirection: "column" as const,
  height: "100vh",
  width: "100vw",
  overflow: "hidden",
  background: "var(--bg)",
  color: "var(--text1)",
  fontFamily: "var(--font-sans)",
} as const;

const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

type AppUiState = {
  page: PageKey;
  sessionsStatusFilter: SessionStatus | "all";
  devPanelFocus: DevPanelFocus | null;
  loadError: string | null;
  sessionActionPending: boolean;
  liveReadinessSession: SessionSummary | null;
  liveReadinessReport: LiveReadinessReport | null;
  autopsyTradeId: string | null;
};

export default function App() {
  const [ui, dispatchUi] = useReducer(mergeReducer<AppUiState>, {
    page: "dashboard",
    sessionsStatusFilter: "all",
    devPanelFocus: null,
    loadError: null,
    sessionActionPending: false,
    liveReadinessSession: null,
    liveReadinessReport: null,
    autopsyTradeId: null,
  });
  const loadErrorRef = useRef<string | null>(null);
  loadErrorRef.current = ui.loadError;
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
        if (!loadErrorRef.current) {
          dispatchUi({
            loadError:
              err instanceof Error ? err.message : "Failed to load trades.",
          });
        }
      });
  }, [environmentMode, setTrades]);

  const reloadStats = useCallback(() => {
    return api
      .getDashboardStats()
      .then((next) => {
        setStats(next);
        setStatus(next.session_status);
        dispatchUi({ loadError: null });
      })
      .catch((err) => {
        if (!loadErrorRef.current) {
          dispatchUi({
            loadError:
              err instanceof Error
                ? err.message
                : "Failed to load dashboard stats.",
          });
        }
      });
  }, [setStats, setStatus]);

  useEffect(() => {
    void reloadStats();
    void reloadTrades();
    void loadWorkspaceView();
  }, [loadWorkspaceView, reloadStats, reloadTrades]);

  useEffect(() => {
    void reloadStats();
    if (ui.page === "trades") return;
    void reloadTrades();
  }, [focusedSessionId, ui.page, reloadStats, reloadTrades, viewMode]);

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
    if (ui.sessionActionPending) return;
    dispatchUi({ sessionActionPending: true, loadError: null });
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
            dispatchUi({
              liveReadinessReport: readiness,
              liveReadinessSession: focused,
            });
            return;
          }
        }
        setStatus(
          action === "start"
            ? await api.startSession()
            : await api.resumeSession(),
        );
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
      dispatchUi({
        loadError:
          error instanceof Error ? error.message : "Session action failed.",
      });
    } finally {
      dispatchUi({ sessionActionPending: false });
    }
  };

  const pageEl = () => {
    switch (ui.page) {
      case "dashboard":
        return <Dashboard />;
      case "sessions":
        return (
          <SessionsPage
            initialStatusFilter={ui.sessionsStatusFilter}
            onInitialStatusFilterApplied={() =>
              dispatchUi({ sessionsStatusFilter: "all" })
            }
            onGoToStrategy={() => dispatchUi({ page: "strategy" })}
            onGoToAccounts={() => dispatchUi({ page: "accounts" })}
            onViewTrace={(sessionId, cycleId, stage) => {
              dispatchUi({
                devPanelFocus: { sessionId, cycleId, stage },
                page: "devpanel",
              });
            }}
          />
        );
      case "brokers":
        return (
          <BrokersPage
            onJumpToSession={async (sessionId) => {
              await api.focusSession(sessionId);
              await loadWorkspaceView();
              dispatchUi({ page: "sessions" });
            }}
          />
        );
      case "trades":
        return (
          <TradesPage
            onViewAutopsy={(tradeId) => dispatchUi({ autopsyTradeId: tradeId })}
          />
        );
      case "strategy":
        return (
          <StrategyConfig
            onGoToSessions={() => dispatchUi({ page: "sessions" })}
          />
        );
      case "costs":
        return <CostBreakdownPage />;
      case "devpanel":
        return (
          <DevPanel
            focus={ui.devPanelFocus}
            onFocusConsumed={() => dispatchUi({ devPanelFocus: null })}
          />
        );
      case "accounts":
        return <AccountsPage />;
    }
  };

  return (
    <div style={appRootStyle}>
      <TopNav
        activePage={ui.page}
        onNavigate={(p) => {
          dispatchUi({
            page: p,
            sessionsStatusFilter:
              p !== "sessions" ? "all" : ui.sessionsStatusFilter,
          });
          setSelected(null);
        }}
        onNavigateToAttentionSessions={() => {
          dispatchUi({
            sessionsStatusFilter: "attention_required",
            page: "sessions",
          });
          setSelected(null);
        }}
        sessionStatus={status}
        onSessionAction={handleSession}
        sessionActionPending={ui.sessionActionPending}
        stats={stats}
      />
      {ui.loadError && (
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
          {ui.loadError}
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
        <TradeDetail
          tradeId={selectedId}
          onClose={() => setSelected(null)}
          onViewAutopsy={(tradeId) => {
            dispatchUi({ autopsyTradeId: tradeId });
            setSelected(null);
          }}
        />
      )}
      {ui.autopsyTradeId && (
        <AutopsyPage
          tradeId={ui.autopsyTradeId}
          trade={null}
          onClose={() => dispatchUi({ autopsyTradeId: null })}
        />
      )}
      {ui.liveReadinessSession && ui.liveReadinessReport ? (
        <LiveReadinessModal
          sessionId={ui.liveReadinessSession.id}
          report={ui.liveReadinessReport}
          onAcknowledged={async () => {
            dispatchUi({
              liveReadinessReport: null,
              liveReadinessSession: null,
            });
            try {
              setStatus(await api.startSession());
            } catch (error) {
              dispatchUi({
                loadError:
                  error instanceof Error
                    ? error.message
                    : "Failed to start session.",
              });
            }
          }}
          onCancel={() => {
            dispatchUi({
              liveReadinessReport: null,
              liveReadinessSession: null,
            });
          }}
        />
      ) : null}
    </div>
  );
}
