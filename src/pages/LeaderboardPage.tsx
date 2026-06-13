import { useEffect, useState } from "react";
import { api, type ExperienceScorecardSummary } from "@/lib/exva";
import { Card } from "@/components/ui";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const usd = (n: number) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export function LeaderboardPage() {
  const [scorecards, setScorecards] = useState<ExperienceScorecardSummary[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .listExperienceScorecards()
      .then(setScorecards)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load scorecards"),
      );
  }, []);

  const sorted = [...scorecards].sort(
    (a, b) => b.netPnlAfterCostsUsd - a.netPnlAfterCostsUsd,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text1)]">
          Experience leaderboard
        </h1>
        <p className="mt-1 text-[13px] text-[var(--text3)]">
          Per-experience scorecards — mock-broker trades excluded. Promotion
          ladder: scripted → rehearsal → paper → live.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
          {error}
        </div>
      )}

      <Card className="overflow-hidden border-border bg-[var(--surface1)]">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border bg-[var(--surface2)] text-[11px] uppercase tracking-wide text-[var(--text3)]">
            <tr>
              <th className="px-4 py-3">Experience</th>
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Trades</th>
              <th className="px-4 py-3">Win rate</th>
              <th className="px-4 py-3">Expectancy</th>
              <th className="px-4 py-3">Max DD</th>
              <th className="px-4 py-3">Net PnL (after costs)</th>
              <th className="px-4 py-3">Cost/trade</th>
              <th className="px-4 py-3">Promotion</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.experienceId}
                className="border-b border-border/60 last:border-0"
              >
                <td className="px-4 py-3 font-medium text-[var(--text1)]">
                  {row.displayName}
                  <div className="text-[11px] text-[var(--text3)]">
                    {row.sessionCount} session
                    {row.sessionCount === 1 ? "" : "s"}
                  </div>
                </td>
                <td className="px-4 py-3 capitalize text-[var(--text2)]">
                  {row.promotionTier}
                </td>
                <td className="px-4 py-3">{row.tradeCount}</td>
                <td className="px-4 py-3">{pct(row.winRate)}</td>
                <td className="px-4 py-3">
                  {usd(row.expectancy)}
                  {row.walkForward ? (
                    <div className="text-[11px] text-[var(--text3)]">
                      OOS {usd(row.walkForward.outOfSample.expectancy)}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">{pct(row.maxDrawdownPct)}</td>
                <td className="px-4 py-3">{usd(row.netPnlAfterCostsUsd)}</td>
                <td className="px-4 py-3">{usd(row.costPerTradeUsd)}</td>
                <td className="px-4 py-3">
                  {row.meetsPromotion ? (
                    <span className="text-emerald-400">Ready</span>
                  ) : (
                    <span className="text-[var(--text3)]">
                      {row.failedPromotionCriteria.slice(0, 2).join(", ")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && !error && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-[var(--text3)]"
                >
                  No closed paper trades yet. Run real-data paper sessions to
                  populate scorecards.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
