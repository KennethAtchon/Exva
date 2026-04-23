import { useEffect, useState } from "react";
import { AgentLabel, Card, PageShell, SectionTitle } from "@/components/atoms";
import { fmt } from "@/lib/formatters";
import { api } from "@/lib/exva";
import type { AgentType, CostBreakdown } from "@/lib/types";
import { useSessionStore } from "@/store/sessionStore";

const Bar = ({ value, max, color = "var(--accent)", h = 6 }: { value: number; max: number; color?: string; h?: number }) => (
  <div style={{ height: h, background: "var(--surface3)", borderRadius: h, overflow: "hidden" }}>
    <div
      style={{
        height: "100%",
        width: `${Math.min((value / max) * 100, 100)}%`,
        background: color, borderRadius: h,
        transition: "width 0.5s ease",
      }}
    />
  </div>
);

export const CostBreakdownPage = () => {
  const stats = useSessionStore((s) => s.stats);
  const [d, setD] = useState<CostBreakdown | null>(null);
  useEffect(() => { api.getCostBreakdown().then(setD).catch(() => {}); }, []);
  if (!d || !stats) return <PageShell><div style={{ color: "var(--text3)" }}>Loading…</div></PageShell>;

  const budget = stats.api_budget;
  const pct = (d.total / budget) * 100;
  const barColor = pct > 80 ? "#f87171" : pct > 60 ? "#fbbf24" : "var(--accent)";
  const agentColors: Record<AgentType, string> = {
    researcher_bull: "#34d399", researcher_bear: "#f87171",
    reviewer: "#60a5fa", decision_maker: "#a78bfa",
  };
  const agentMax = Math.max(...d.by_agent.map((a) => a.cost));
  const histMax = Math.max(...d.daily_history.map((h) => h.cost));

  return (
    <PageShell>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text1)", margin: 0 }}>API Usage</h1>
        <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
          Token consumption and cost tracking by agent
        </p>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <SectionTitle>Today's Budget</SectionTitle>
            <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 18 }}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <svg width={108} height={108} viewBox="0 0 108 108">
                  <circle cx={54} cy={54} r={44} fill="none" stroke="var(--surface3)" strokeWidth={9} />
                  <circle
                    cx={54} cy={54} r={44} fill="none" stroke={barColor} strokeWidth={9}
                    strokeDasharray={`${2 * Math.PI * 44}`}
                    strokeDashoffset={`${2 * Math.PI * 44 * (1 - pct / 100)}`}
                    strokeLinecap="round" transform="rotate(-90 54 54)"
                    style={{ transition: "stroke-dashoffset 0.7s ease" }}
                  />
                  <text x={54} y={50} textAnchor="middle" fill="var(--text1)" fontSize={16} fontWeight={700} fontFamily="JetBrains Mono,monospace">{Math.round(pct)}%</text>
                  <text x={54} y={65} textAnchor="middle" fill="var(--text3)" fontSize={9} fontFamily="JetBrains Mono,monospace">of budget</text>
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Spent today</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 32, fontWeight: 700, color: "var(--text1)", lineHeight: 1 }}>
                    {fmt.usd(d.total)}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
                    of {fmt.usd(budget)} budget
                  </div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 8 }}>
                  <span style={{ fontSize: 12, color: "#34d399" }}>↓ {fmt.usd(d.cache_savings_usd)} saved via prompt cache</span>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle>Cost by Agent</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 18 }}>
              {d.by_agent.map((a) => (
                <div key={a.name}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                    <AgentLabel type={a.name} />
                    <div style={{ display: "flex", gap: 14 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text3)" }}>
                        {fmt.tokens(a.tokens)} tok
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text2)", fontWeight: 600, width: 38, textAlign: "right" }}>
                        {fmt.usd(a.cost)}
                      </span>
                    </div>
                  </div>
                  <Bar value={a.cost} max={agentMax} color={agentColors[a.name]} h={5} />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle>Cost per Trade</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
              {d.by_trade.map((t) => (
                <div key={t.asset} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--text1)", width: 48, flexShrink: 0 }}>
                    {t.asset}
                  </span>
                  <Bar value={t.cost} max={0.4} h={4} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text2)", width: 38, textAlign: "right", flexShrink: 0 }}>
                    {fmt.usd(t.cost)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <SectionTitle>7-Day History</SectionTitle>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 130, marginTop: 20 }}>
              {d.daily_history.map((h) => {
                const barH = histMax > 0 ? (h.cost / histMax) * 100 : 0;
                const today = h.date === "21";
                return (
                  <div key={h.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: today ? "var(--accent)" : "var(--text3)", height: 14 }}>
                      {h.cost > 0 ? fmt.usd(h.cost) : ""}
                    </span>
                    <div style={{ width: "100%", flex: 1, display: "flex", alignItems: "flex-end" }}>
                      <div
                        style={{
                          width: "100%",
                          height: `${Math.max(barH, h.cost > 0 ? 4 : 0)}%`,
                          minHeight: h.cost > 0 ? 4 : 0,
                          background: today ? "var(--accent)" : "var(--surface3)",
                          borderRadius: "4px 4px 0 0",
                          transition: "height 0.5s",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 10, color: today ? "var(--accent)" : "var(--text3)", fontFamily: "var(--font-mono)" }}>
                      Apr {h.date}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>7-day total</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: "var(--text1)" }}>
                {fmt.usd(d.daily_history.reduce((s, h) => s + h.cost, 0))}
              </span>
            </div>
          </Card>

          <Card>
            <SectionTitle>Projections</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 14 }}>
              {(() => {
                const trades = stats.total_trades_today || 1;
                const rows: [string, string][] = [
                  ["Cost per trade (avg)", fmt.usd(d.total / trades, 3)],
                  ["Projected daily · 8 trades", fmt.usd((d.total / trades) * 8)],
                  ["Projected monthly", fmt.usd((d.total / trades) * 8 * 22)],
                  ["Budget remaining today", fmt.usd(budget - d.total)],
                  ["Est. trades remaining", `${Math.max(0, Math.floor((budget - d.total) / (d.total / trades)))}`],
                ];
                return rows.map(([k, v], i) => (
                  <div
                    key={k}
                    style={{
                      display: "flex", justifyContent: "space-between",
                      padding: "11px 0",
                      borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "var(--text3)" }}>{k}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text2)", fontWeight: 600 }}>{v}</span>
                  </div>
                ));
              })()}
            </div>
          </Card>
        </div>
      </div>
    </PageShell>
  );
};
