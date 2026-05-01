import { useEffect, useState } from "react";
import { TopNav, type PageKey } from "./components/TopNav";
import { Dashboard } from "./pages/Dashboard";
import { SessionsPage } from "./pages/SessionsPage";
import { TradesPage } from "./pages/TradesPage";
import { TradeDetail } from "./pages/TradeDetail";
import { StrategyConfig } from "./pages/StrategyConfig";
import { CostBreakdownPage } from "./pages/CostBreakdown";
import { DevPanel } from "./pages/DevPanel";
import { AccountsPage } from "./pages/AccountsPage";
import { useSessionStore } from "./store/sessionStore";
import { useTradeStore } from "./store/tradeStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { api, showMock } from "./lib/exva";
import { useExvaEvent } from "./hooks/useExvaEvent";
import { usePolling } from "./hooks/usePolling";

export default function App() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const [loadError, setLoadError] = useState<string | null>(null);
  const status = useSessionStore((s) => s.status);
  const setStatus = useSessionStore((s) => s.setStatus);
  const stats = useSessionStore((s) => s.stats);
  const setStats = useSessionStore((s) => s.setStats);

  const setTrades = useTradeStore((s) => s.setTrades);
  const upsertTrade = useTradeStore((s) => s.upsertTrade);
  const selectedId = useTradeStore((s) => s.selectedId);
  const setSelected = useTradeStore((s) => s.setSelected);
  const loadWorkspaceView = useWorkspaceStore((s) => s.loadWorkspaceView);
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const focusedSessionId = useWorkspaceStore((s) => s.focusedSessionId);

  // Initial load
  useEffect(() => {
    api.getDashboardStats()
      .then((next) => {
        setStats(next);
        setStatus(next.session_status);
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load dashboard stats.");
      });
    api.getActiveTrades()
      .then(setTrades)
      .catch((err) => {
        setLoadError((current) => current ?? (err instanceof Error ? err.message : "Failed to load trades."));
      });
    void loadWorkspaceView();
  }, [loadWorkspaceView, setStats, setTrades]);

  useEffect(() => {
    api.getDashboardStats()
      .then((next) => {
        setStats(next);
        setStatus(next.session_status);
      })
      .catch(() => {});
    api.getActiveTrades()
      .then(setTrades)
      .catch(() => {});
  }, [focusedSessionId, setStats, setStatus, setTrades, viewMode]);

  // Live updates from the Electron main process
  useExvaEvent("stats_update", (payload) => setStats(payload));
  useExvaEvent("trade_opened", (t) => upsertTrade(t));
  useExvaEvent("trade_closed", (t) => upsertTrade(t));

  // Fallback polling when events aren't flowing (e.g. dev browser)
  usePolling(
    async () => {
      const next = await api.getDashboardStats();
      setStats(next);
      setStatus(next.session_status);
    },
    5000,
    status !== "idle",
  );

  const handleSession = async (action: "start" | "pause" | "resume" | "stop") => {
    try {
      if (action === "start" || action === "resume") {
        setStatus(await api.startSession());
      } else if (action === "pause") {
        setStatus(await api.pauseSession());
      } else if (action === "stop") {
        setStatus(await api.stopSession());
      }
    } catch (err) {
      console.error("session action failed", err);
    }
  };

  const pageEl = () => {
    switch (page) {
      case "dashboard": return <Dashboard />;
      case "sessions":  return <SessionsPage />;
      case "trades":    return <TradesPage />;
      case "strategy":  return <StrategyConfig />;
      case "costs":     return <CostBreakdownPage />;
      case "devpanel":  return <DevPanel />;
      case "accounts":  return <AccountsPage />;
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
        }}
        sessionStatus={status}
        onSessionAction={handleSession}
        stats={stats}
        showMock={showMock}
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
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {pageEl()}
      </div>
      {selectedId && <TradeDetail tradeId={selectedId} onClose={() => setSelected(null)} />}
    </div>
  );
}
