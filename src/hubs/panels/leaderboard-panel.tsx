import { useEffect, useState } from "react";
import { Badge } from "@/components/custom-ui";
import { HelpTooltip } from "@/components/ui";
import { EmptyState, PnL } from "@/components/ui/primitives";
import { PanelLoading } from "@/components/ui/skeleton";
import { api, type ExperienceScorecardSummary } from "@/lib/exva";
import { formatPercent } from "@/lib/format";
import { fmt } from "@/lib/formatters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const pct = (n: number) => formatPercent(n, 1);

export function LeaderboardPage({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const [scorecards, setScorecards] = useState<ExperienceScorecardSummary[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api
      .listExperienceScorecards()
      .then(setScorecards)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load scorecards"),
      )
      .finally(() => setLoading(false));
  }, []);

  const sorted = [...scorecards].sort(
    (a, b) => b.netPnlAfterCostsUsd - a.netPnlAfterCostsUsd,
  );

  return (
    <div className={embedded ? "p-0" : "mx-auto max-w-6xl space-y-4 p-6"}>
      {!embedded ? (
        <div>
          <h1 className="m-0 font-sans text-title text-text1">
            Experience leaderboard
          </h1>
          <p className="mt-1 font-sans text-body text-text3">
            Per-experience scorecards — mock-broker trades excluded.
          </p>
          <div className="mt-2">
            <HelpTooltip
              topic="Leaderboard scope"
              body="Aggregates closed trades by experience. Mock-broker rehearsal trades are excluded."
            />
          </div>
        </div>
      ) : null}

      {loading && scorecards.length === 0 && !error ? (
        <PanelLoading rows={5} />
      ) : error ? (
        <EmptyState message={error} />
      ) : sorted.length === 0 ? (
        <EmptyState message="No closed paper trades yet. Run real-data paper sessions to populate scorecards." />
      ) : (
        <div
          className={
            embedded
              ? "overflow-x-auto"
              : "overflow-hidden rounded-sm border border-border bg-surface"
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Experience</TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    Tier <HelpTooltip glossaryId="promotion-tier" />
                  </span>
                </TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Win rate</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    Expectancy <HelpTooltip glossaryId="expectancy" />
                  </span>
                </TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    Max DD <HelpTooltip glossaryId="max-drawdown" />
                  </span>
                </TableHead>
                <TableHead className="text-right">Net PnL</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    Cost/trade <HelpTooltip glossaryId="cost-per-trade" />
                  </span>
                </TableHead>
                <TableHead>Promotion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow key={row.experienceId}>
                  <TableCell>
                    <div className="font-sans text-label text-text1">
                      {row.displayName}
                    </div>
                    <div className="font-mono text-micro text-text3">
                      {row.sessionCount} session
                      {row.sessionCount === 1 ? "" : "s"}
                    </div>
                  </TableCell>
                  <TableCell className="capitalize text-text2">
                    {row.promotionTier}
                  </TableCell>
                  <TableCell className="text-right font-mono text-data tabular-nums">
                    {row.tradeCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-data tabular-nums">
                    {pct(row.winRate)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-data tabular-nums">
                    {fmt.usd(row.expectancy)}
                    {row.walkForward ? (
                      <div className="font-mono text-micro text-text3">
                        OOS {fmt.usd(row.walkForward.outOfSample.expectancy)}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono text-data tabular-nums">
                    {pct(row.maxDrawdownPct)}
                  </TableCell>
                  <TableCell className="text-right">
                    <PnL value={row.netPnlAfterCostsUsd} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-data tabular-nums">
                    {fmt.usd(row.costPerTradeUsd)}
                  </TableCell>
                  <TableCell>
                    {row.meetsPromotion ? (
                      <Badge variant="success" size="sm">
                        Ready
                      </Badge>
                    ) : (
                      <span className="font-sans text-caption text-text3">
                        {row.failedPromotionCriteria.slice(0, 2).join(", ")}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
