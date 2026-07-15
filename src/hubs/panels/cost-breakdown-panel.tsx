import { useQuery } from "@tanstack/react-query";
import { AgentLabel } from "@/components/custom-ui";
import { HelpTooltip } from "@/components/ui";
import {
  EmptyState,
  SectionHeader,
  StatTile,
} from "@/components/ui/primitives";
import { fmt } from "@/lib/formatters";
import { formatIpcError } from "@/lib/ipc-error";
import { api } from "@/lib/exva";
import type { EventSourceType } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HubQueryError } from "@/hubs/dna";
import { useSessionStore } from "@/store/sessionStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

export const CostBreakdownPage = () => {
  const stats = useSessionStore((s) => s.stats);
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const focusedSessionId = useWorkspaceStore((s) => s.focusedSessionId);
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);
  const {
    data: d,
    isError,
    error,
    refetch,
    isPending,
  } = useQuery({
    queryKey: ["cost-breakdown", viewMode, focusedSessionId, environmentMode],
    queryFn: () => api.getCostBreakdown(),
    refetchInterval: 5000,
  });

  if (isError) {
    return (
      <HubQueryError
        message={formatIpcError(error).display}
        onRetry={() => void refetch()}
      />
    );
  }

  if (isPending || !d || !stats) {
    return <div className="font-sans text-body text-text3">Loading…</div>;
  }

  const budget = stats.api_budget;
  const budgetPct = budget > 0 ? (d.total / budget) * 100 : 0;
  const avgCostPerTrade =
    stats.total_trades_today > 0 && d.total > 0
      ? d.total / stats.total_trades_today
      : 0;
  const sevenDayTotal = d.daily_history.reduce((s, h) => s + h.cost, 0);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        eyebrow="Spend"
        title="API usage"
        action={<HelpTooltip glossaryId="ai-cost" topic="API usage" />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Spent today" value={fmt.usd(d.total)} />
        <StatTile
          label="Budget used"
          value={`${Math.round(budgetPct)}%`}
          delta={`of ${fmt.usd(budget)}`}
        />
        <StatTile
          label="Cache savings"
          value={fmt.usd(d.cache_savings_usd)}
          delta="via prompt cache"
          deltaTone="success"
        />
        <StatTile
          label="7-day total"
          value={fmt.usd(sevenDayTotal)}
          delta={
            avgCostPerTrade > 0
              ? `${fmt.usd(avgCostPerTrade, 3)} / trade avg`
              : undefined
          }
        />
      </div>

      <div className="overflow-hidden rounded-sm border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Category</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.by_agent.length === 0 && d.by_trade.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <EmptyState message="No AI spend recorded for this scope yet." />
                </TableCell>
              </TableRow>
            ) : null}
            {d.by_agent.map((a) => (
              <TableRow key={`agent-${a.name}`}>
                <TableCell className="font-mono text-micro uppercase text-text3">
                  Agent
                </TableCell>
                <TableCell>
                  <AgentLabel type={a.name as EventSourceType} />
                </TableCell>
                <TableCell className="text-right font-mono text-data tabular-nums text-text2">
                  {fmt.tokens(a.tokens)}
                </TableCell>
                <TableCell className="text-right font-mono text-data tabular-nums text-text1">
                  {fmt.usd(a.cost)}
                </TableCell>
              </TableRow>
            ))}
            {d.by_trade.map((t) => (
              <TableRow key={`trade-${t.instrumentSymbol}-${t.cost}`}>
                <TableCell className="font-mono text-micro uppercase text-text3">
                  Trade
                </TableCell>
                <TableCell className="font-mono text-data text-text1">
                  {t.instrumentSymbol}
                </TableCell>
                <TableCell className="text-right font-mono text-data text-text3">
                  —
                </TableCell>
                <TableCell className="text-right font-mono text-data tabular-nums text-text1">
                  {fmt.usd(t.cost)}
                </TableCell>
              </TableRow>
            ))}
            {d.daily_history.map((h) => (
              <TableRow key={`day-${h.date}`}>
                <TableCell className="font-mono text-micro uppercase text-text3">
                  Daily
                </TableCell>
                <TableCell className="font-sans text-body text-text2">
                  {formatHistoryDate(h.date)}
                </TableCell>
                <TableCell className="text-right font-mono text-data text-text3">
                  —
                </TableCell>
                <TableCell className="text-right font-mono text-data tabular-nums text-text1">
                  {fmt.usd(h.cost)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
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
