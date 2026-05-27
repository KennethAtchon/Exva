import { useQuery } from "@tanstack/react-query";
import {
  AgentLabel,
  Card,
  PageShell,
  SectionTitle,
} from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import { api } from "@/lib/exva";
import type { EventSourceType } from "@/lib/types";
import { useSessionStore } from "@/store/sessionStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

const Bar = ({
  value,
  max,
  color = "var(--accent)",
  h = 6,
}: {
  value: number;
  max: number;
  color?: string;
  h?: number;
}) => (
  <div
    style={{
      height: h,
      background: "var(--surface3)",
      borderRadius: h,
      overflow: "hidden",
    }}
  >
    <div
      style={{
        height: "100%",
        width: "100%",
        background: color,
        borderRadius: h,
        transform: `scaleX(${Math.min(value / max, 1)})`,
        transformOrigin: "left center",
        transition: "transform 0.5s ease",
      }}
    />
  </div>
);

export const CostBreakdownPage = () => {
  const stats = useSessionStore((s) => s.stats);
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const focusedSessionId = useWorkspaceStore((s) => s.focusedSessionId);
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);
  const { data: d } = useQuery({
    queryKey: ["cost-breakdown", viewMode, focusedSessionId, environmentMode],
    queryFn: () => api.getCostBreakdown(),
    refetchInterval: 5000,
  });
  if (!d || !stats)
    return (
      <PageShell>
        <div style={{ color: "var(--text3)" }}>Loading…</div>
      </PageShell>
    );

  const budget = stats.api_budget;
  const agentMax = Math.max(0.01, ...d.by_agent.map((a) => a.cost));
  const tradeMax = Math.max(0.01, ...d.by_trade.map((t) => t.cost));
  const histMax = Math.max(0.01, ...d.daily_history.map((h) => h.cost));
  const todayIso = new Date().toISOString().slice(0, 10);
  const avgCostPerTrade =
    stats.total_trades_today > 0 && d.total > 0
      ? d.total / stats.total_trades_today
      : 0;

  return (
    <PageShell>
      <div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "var(--text1)",
            margin: 0,
          }}
        >
          API Usage
        </h1>
        <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
          Token consumption and cost tracking by agent
        </p>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}
        >
          <BudgetCard
            total={d.total}
            budget={budget}
            cacheSavingsUsd={d.cache_savings_usd}
          />
          <CostByAgentCard rows={d.by_agent} agentMax={agentMax} />
          <CostPerTradeCard rows={d.by_trade} tradeMax={tradeMax} />
        </div>

        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}
        >
          <DailyHistoryCard
            rows={d.daily_history}
            histMax={histMax}
            todayIso={todayIso}
          />
          <ProjectionsCard
            avgCostPerTrade={avgCostPerTrade}
            budget={budget}
            total={d.total}
          />
        </div>
      </div>
    </PageShell>
  );
};

const EmptyState = ({ text }: { text: string }) => (
  <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5 }}>
    {text}
  </div>
);

type AgentRow = { name: string; tokens: number; cost: number };
type TradeRow = { instrumentSymbol: string; cost: number };
type HistoryRow = { date: string; cost: number };

const BudgetCard = ({
  total,
  budget,
  cacheSavingsUsd,
}: {
  total: number;
  budget: number;
  cacheSavingsUsd: number;
}) => {
  const pct = budget > 0 ? (total / budget) * 100 : 0;
  const barColor =
    pct > 80
      ? "var(--color-error)"
      : pct > 60
        ? "var(--color-warning)"
        : "var(--accent)";
  return (
    <Card>
      <SectionTitle>Today's Budget</SectionTitle>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 28,
          marginTop: 18,
        }}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          <svg width={108} height={108} viewBox="0 0 108 108">
            <circle
              cx={54}
              cy={54}
              r={44}
              fill="none"
              stroke="var(--surface3)"
              strokeWidth={9}
            />
            <circle
              cx={54}
              cy={54}
              r={44}
              fill="none"
              stroke={barColor}
              strokeWidth={9}
              strokeDasharray={`${2 * Math.PI * 44}`}
              strokeDashoffset={`${2 * Math.PI * 44 * (1 - pct / 100)}`}
              strokeLinecap="round"
              transform="rotate(-90 54 54)"
              style={{ transition: "stroke-dashoffset 0.7s ease" }}
            />
            <text
              x={54}
              y={50}
              textAnchor="middle"
              fill="var(--text1)"
              fontSize={16}
              fontWeight={700}
              fontFamily="JetBrains Mono,monospace"
            >
              {Math.round(pct)}%
            </text>
            <text
              x={54}
              y={65}
              textAnchor="middle"
              fill="var(--text3)"
              fontSize={12}
              fontFamily="JetBrains Mono,monospace"
            >
              of budget
            </text>
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text3)",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                marginBottom: 4,
              }}
            >
              Spent today
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 32,
                fontWeight: 700,
                color: "var(--text1)",
                lineHeight: 1,
              }}
            >
              {fmt.usd(total)}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "var(--text3)",
                marginTop: 4,
              }}
            >
              of {fmt.usd(budget)} budget
            </div>
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              background: "var(--color-success-dim)",
              border: "1px solid var(--color-success-border)",
              borderRadius: 8,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--color-success)" }}>
              ↓ {fmt.usd(cacheSavingsUsd)} saved via prompt cache
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
};

const agentColors: Record<string, string> = {
  technical: "var(--color-success)",
  fundamental: "var(--color-error)",
  review: "var(--color-info)",
  decision: "var(--color-market)",
  selector: "var(--color-warning)",
};

const CostByAgentCard = ({
  rows,
  agentMax,
}: {
  rows: AgentRow[];
  agentMax: number;
}) => (
  <Card>
    <SectionTitle>Cost by Agent</SectionTitle>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        marginTop: 18,
      }}
    >
      {rows.length > 0 ? (
        rows.map((a) => (
          <div key={a.name}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 7,
              }}
            >
              <AgentLabel type={a.name as EventSourceType} />
              <div style={{ display: "flex", gap: 14 }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text3)",
                  }}
                >
                  {fmt.tokens(a.tokens)} tok
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text2)",
                    fontWeight: 600,
                    width: 38,
                    textAlign: "right",
                  }}
                >
                  {fmt.usd(a.cost)}
                </span>
              </div>
            </div>
            <Bar
              value={a.cost}
              max={agentMax}
              color={agentColors[a.name]}
              h={5}
            />
          </div>
        ))
      ) : (
        <EmptyState text="No AI spend recorded for this scope yet." />
      )}
    </div>
  </Card>
);

const CostPerTradeCard = ({
  rows,
  tradeMax,
}: {
  rows: TradeRow[];
  tradeMax: number;
}) => (
  <Card>
    <SectionTitle>Cost per Trade</SectionTitle>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        marginTop: 16,
      }}
    >
      {rows.length > 0 ? (
        rows.map((t) => (
          <div
            key={`${t.instrumentSymbol}:${t.cost}`}
            style={{ display: "flex", alignItems: "center", gap: 12 }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--text1)",
                width: 48,
                flexShrink: 0,
              }}
            >
              {t.instrumentSymbol}
            </span>
            <Bar value={t.cost} max={tradeMax} h={4} />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--text2)",
                width: 38,
                textAlign: "right",
                flexShrink: 0,
              }}
            >
              {fmt.usd(t.cost)}
            </span>
          </div>
        ))
      ) : (
        <EmptyState text="Trade-level cost appears once runs are tied to a trade." />
      )}
    </div>
  </Card>
);

const DailyHistoryCard = ({
  rows,
  histMax,
  todayIso,
}: {
  rows: HistoryRow[];
  histMax: number;
  todayIso: string;
}) => (
  <Card>
    <SectionTitle>7-Day History</SectionTitle>
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-end",
        height: 130,
        marginTop: 20,
      }}
    >
      {rows.length > 0 ? (
        rows.map((h) => {
          const barH = histMax > 0 ? (h.cost / histMax) * 100 : 0;
          const barScale = h.cost > 0 ? Math.max(barH, 4) / 100 : 0;
          const today = h.date === todayIso;
          const label = formatHistoryDate(h.date);
          return (
            <div
              key={h.date}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: today ? "var(--accent)" : "var(--text3)",
                  height: 14,
                }}
              >
                {h.cost > 0 ? fmt.usd(h.cost) : ""}
              </span>
              <div
                style={{
                  width: "100%",
                  flex: 1,
                  display: "flex",
                  alignItems: "flex-end",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    background: today ? "var(--accent)" : "var(--surface3)",
                    borderRadius: "4px 4px 0 0",
                    transform: `scaleY(${barScale})`,
                    transformOrigin: "center bottom",
                    transition: "transform 0.5s",
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: today ? "var(--accent)" : "var(--text3)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {label}
              </span>
            </div>
          );
        })
      ) : (
        <EmptyState text="No AI spend recorded in the last 7 days." />
      )}
    </div>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginTop: 14,
        paddingTop: 14,
        borderTop: "1px solid var(--border)",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--text3)" }}>7-day total</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 15,
          fontWeight: 700,
          color: "var(--text1)",
        }}
      >
        {fmt.usd(rows.reduce((s, h) => s + h.cost, 0))}
      </span>
    </div>
  </Card>
);

const ProjectionsCard = ({
  avgCostPerTrade,
  budget,
  total,
}: {
  avgCostPerTrade: number;
  budget: number;
  total: number;
}) => {
  const rows: [string, string][] = [
    [
      "Cost per trade (avg)",
      avgCostPerTrade > 0 ? fmt.usd(avgCostPerTrade, 3) : "—",
    ],
    [
      "Projected daily · 8 trades",
      avgCostPerTrade > 0 ? fmt.usd(avgCostPerTrade * 8) : "—",
    ],
    [
      "Projected monthly",
      avgCostPerTrade > 0 ? fmt.usd(avgCostPerTrade * 8 * 22) : "—",
    ],
    ["Budget remaining today", fmt.usd(budget - total)],
    [
      "Est. trades remaining",
      avgCostPerTrade > 0
        ? `${Math.max(0, Math.floor((budget - total) / avgCostPerTrade))}`
        : "—",
    ],
  ];
  return (
    <Card>
      <SectionTitle>Projections</SectionTitle>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          marginTop: 14,
        }}
      >
        {rows.map(([k, v], i) => (
          <div
            key={k}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "11px 0",
              borderBottom:
                i < rows.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            <span style={{ fontSize: 13, color: "var(--text3)" }}>{k}</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "var(--text2)",
                fontWeight: 600,
              }}
            >
              {v}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
};

function formatHistoryDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
