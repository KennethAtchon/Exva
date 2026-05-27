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
import { cn } from "@/lib/utils";
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
    className="overflow-hidden bg-[var(--surface3)]"
    style={{ height: h, borderRadius: h }}
  >
    <div
      className="h-full w-full origin-left transition-transform duration-500 ease-in-out"
      style={{
        background: color,
        borderRadius: h,
        transform: `scaleX(${Math.min(value / max, 1)})`,
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
        <div className="text-[var(--text3)]">Loading…</div>
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
        <h1 className="m-0 text-[22px] font-semibold text-[var(--text1)]">
          API Usage
        </h1>
        <p className="mt-1 text-[13px] text-[var(--text3)]">
          Token consumption and cost tracking by agent
        </p>
      </div>

      <div className="flex gap-4">
        <div className={columnClass}>
          <BudgetCard
            total={d.total}
            budget={budget}
            cacheSavingsUsd={d.cache_savings_usd}
          />
          <CostByAgentCard rows={d.by_agent} agentMax={agentMax} />
          <CostPerTradeCard rows={d.by_trade} tradeMax={tradeMax} />
        </div>

        <div className={columnClass}>
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
  <div className="text-[12px] leading-normal text-[var(--text3)]">{text}</div>
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
      <div className="mt-[18px] flex items-center gap-7">
        <div className="relative shrink-0">
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
              className="transition-[stroke-dashoffset] duration-700 ease-in-out"
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
        <div className="flex flex-col gap-3.5">
          <div>
            <div className="mb-1 text-[12px] uppercase tracking-[0.07em] text-[var(--text3)]">
              Spent today
            </div>
            <div className="font-mono text-[32px] font-bold leading-none text-[var(--text1)]">
              {fmt.usd(total)}
            </div>
            <div className="mt-1 font-mono text-[13px] text-[var(--text3)]">
              of {fmt.usd(budget)} budget
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-success-border bg-success-dim px-2.5 py-1.5">
            <span className="text-[12px] text-success">
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
    <div className="mt-[18px] flex flex-col gap-4">
      {rows.length > 0 ? (
        rows.map((a) => (
          <div key={a.name}>
            <div className="mb-[7px] flex items-center justify-between">
              <AgentLabel type={a.name as EventSourceType} />
              <div className="flex gap-3.5">
                <span className="font-mono text-[12px] text-[var(--text3)]">
                  {fmt.tokens(a.tokens)} tok
                </span>
                <span className="w-[38px] text-right font-mono text-[12px] font-semibold text-[var(--text2)]">
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
    <div className="mt-4 flex flex-col gap-2.5">
      {rows.length > 0 ? (
        rows.map((t) => (
          <div
            key={`${t.instrumentSymbol}:${t.cost}`}
            className="flex items-center gap-3"
          >
            <span className="w-12 shrink-0 font-mono text-[13px] font-bold text-[var(--text1)]">
              {t.instrumentSymbol}
            </span>
            <Bar value={t.cost} max={tradeMax} h={4} />
            <span className="w-[38px] shrink-0 text-right font-mono text-[12px] text-[var(--text2)]">
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
    <div className="mt-5 flex h-[130px] items-end gap-2">
      {rows.length > 0 ? (
        rows.map((h) => {
          const barH = histMax > 0 ? (h.cost / histMax) * 100 : 0;
          const barScale = h.cost > 0 ? Math.max(barH, 4) / 100 : 0;
          const today = h.date === todayIso;
          const label = formatHistoryDate(h.date);
          return (
            <div
              key={h.date}
              className="flex flex-1 flex-col items-center gap-1.5"
            >
              <span
                className={cn(
                  "h-3.5 font-mono text-[12px]",
                  today ? "text-[var(--accent)]" : "text-[var(--text3)]",
                )}
              >
                {h.cost > 0 ? fmt.usd(h.cost) : ""}
              </span>
              <div className="flex w-full flex-1 items-end">
                <div
                  className={cn(
                    "h-full w-full origin-bottom rounded-t-[4px] transition-transform duration-500",
                    today ? "bg-[var(--accent)]" : "bg-[var(--surface3)]",
                  )}
                  style={{ transform: `scaleY(${barScale})` }}
                />
              </div>
              <span
                className={cn(
                  "font-mono text-[12px]",
                  today ? "text-[var(--accent)]" : "text-[var(--text3)]",
                )}
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
    <div className="mt-3.5 flex justify-between border-t border-[var(--border)] pt-3.5">
      <span className="text-[12px] text-[var(--text3)]">7-day total</span>
      <span className="font-mono text-[15px] font-bold text-[var(--text1)]">
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
      <div className="mt-3.5 flex flex-col">
        {rows.map(([k, v], i) => (
          <div
            key={k}
            className={cn(
              "flex justify-between py-[11px]",
              i < rows.length - 1 && "border-b border-[var(--border)]",
            )}
          >
            <span className="text-[13px] text-[var(--text3)]">{k}</span>
            <span className="font-mono text-[13px] font-semibold text-[var(--text2)]">
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

const columnClass = "flex flex-1 flex-col gap-3.5";
