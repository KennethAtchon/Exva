import { useEffect, useState } from "react";
import { TopNav, type PageKey } from "./components/TopNav";
import { Dashboard } from "./pages/Dashboard";
import { TradesPage } from "./pages/TradesPage";
import { TradeDetail } from "./pages/TradeDetail";
import { StrategyConfig } from "./pages/StrategyConfig";
import { CostBreakdownPage } from "./pages/CostBreakdown";
import { DevPanel } from "./pages/DevPanel";
import { AccountsPage } from "./pages/AccountsPage";
import { useSessionStore } from "./store/sessionStore";
import { useTradeStore } from "./store/tradeStore";
import { api } from "./lib/tauri";
import { useTauriEvent } from "./hooks/useTauriEvent";
import { usePolling } from "./hooks/usePolling";

export default function App() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const status = useSessionStore((s) => s.status);
  const setStatus = useSessionStore((s) => s.setStatus);
  const stats = useSessionStore((s) => s.stats);
  const setStats = useSessionStore((s) => s.setStats);

  const setTrades = useTradeStore((s) => s.setTrades);
  const upsertTrade = useTradeStore((s) => s.upsertTrade);
  const selectedId = useTradeStore((s) => s.selectedId);
  const setSelected = useTradeStore((s) => s.setSelected);

  // Initial load
  useEffect(() => {
    api.getDashboardStats().then(setStats).catch(() => {});
    api.getActiveTrades().then(setTrades).catch(() => {});
  }, [setStats, setTrades]);

  // Live updates via Tauri events
  useTauriEvent("stats_update", (payload) => setStats(payload));
  useTauriEvent("trade_opened", (t) => upsertTrade(t));
  useTauriEvent("trade_closed", (t) => upsertTrade(t));

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
      />
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {pageEl()}
      </div>
      {selectedId && <TradeDetail tradeId={selectedId} onClose={() => setSelected(null)} />}
    </div>
  );
}
