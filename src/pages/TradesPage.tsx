import { useState } from "react";
import { Badge, Card, PageShell } from "@/components/atoms";
import { fmt } from "@/lib/formatters";
import { useTradeStore } from "@/store/tradeStore";

type Filter = "all" | "open" | "closed";

export const TradesPage = () => {
  const [filter, setFilter] = useState<Filter>("all");
  const allTrades = useTradeStore((s) => s.trades);
  const selectedId = useTradeStore((s) => s.selectedId);
  const setSelected = useTradeStore((s) => s.setSelected);

  const trades = allTrades.filter((t) => filter === "all" || t.status === filter);
  const closed = allTrades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (t.final_pnl_usd ?? 0) > 0);
  const realPnl = closed.reduce((s, t) => s + (t.final_pnl_usd ?? 0), 0);

  return (
    <PageShell>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text1)", margin: 0 }}>Trades</h1>
        <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
          All trade history and open positions
        </p>
      </div>

      <div style={{ display: "flex", gap: 14 }}>
        {[
          ["Realized P&L", fmt.pnl(realPnl), realPnl >= 0 ? "#34d399" : "#f87171"],
          ["Win Rate", closed.length ? `${Math.round((wins.length / closed.length) * 100)}%` : "—", "var(--text1)"],
          ["Total Trades", `${allTrades.length}`, "var(--text1)"],
          ["Open", `${allTrades.filter((t) => t.status === "open").length}`, "#60a5fa"],
        ].map(([lbl, val, color]) => (
          <Card key={lbl} style={{ flex: 1, padding: "18px 22px" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 600 }}>
              {lbl}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>
              {val}
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 6, padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          {(["all", "open", "closed"] as Filter[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                padding: "5px 14px", fontSize: 12, borderRadius: 7, cursor: "pointer",
                background: filter === s ? "var(--surface3)" : "transparent",
                border: `1px solid ${filter === s ? "var(--border)" : "transparent"}`,
                color: filter === s ? "var(--text1)" : "var(--text3)",
                fontFamily: "var(--font-sans)",
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "130px 60px 70px 90px 90px 90px 80px 60px 55px 60px",
              padding: "10px 20px 8px", fontSize: 10, color: "var(--text3)",
              textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600,
              borderBottom: "1px solid var(--border)", minWidth: 780,
            }}
          >
            {["Asset", "Side", "Size", "Entry", "Cur/Exit", "P&L", "AI Cost", "Conf", "Status", "Time"].map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
          {trades.map((t) => {
            const isOpen = t.status === "open";
            const pnl = (isOpen ? t.unrealized_pnl : t.final_pnl_usd) ?? null;
            const pos = pnl != null && pnl >= 0;
            return (
              <div
                key={t.id}
                onClick={() => setSelected(t.id === selectedId ? null : t.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "130px 60px 70px 90px 90px 90px 80px 60px 55px 60px",
                  padding: "11px 20px", alignItems: "center",
                  cursor: "pointer", borderBottom: "1px solid var(--border)",
                  background: t.id === selectedId ? "var(--surface2)" : "transparent",
                  transition: "background 0.1s", minWidth: 780,
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--text1)" }}>{t.asset}</span>
                <Badge variant={t.side === "BUY" ? "success" : "danger"} size="sm">{t.side}</Badge>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text2)" }}>{fmt.usd(t.position_size_usd, 0)}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text2)" }}>{t.entry_price != null ? fmt.usd(t.entry_price) : "—"}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text2)" }}>{isOpen && t.current_price != null ? fmt.usd(t.current_price) : "—"}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: pos ? "#34d399" : "#f87171", fontWeight: 600 }}>
                  {pnl != null ? fmt.pnl(pnl) : "—"}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)" }}>{fmt.usd(t.ai_cost_usd, 3)}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text2)" }}>
                  {t.confidence_score != null ? `${Math.round(t.confidence_score * 100)}%` : "—"}
                </span>
                <Badge variant={isOpen ? "success" : "default"} size="sm">{t.status}</Badge>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)" }}>
                  {t.opened_at ? fmt.time(t.opened_at) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </PageShell>
  );
};
