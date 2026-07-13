import { useEffect, useState } from "react";
import { HelpTooltip } from "@/components/ui";
import { HubBody, HubFrame, HubHeader, HubTabBar, type HubTab } from "./dna";
import { LeaderboardPage } from "./panels/leaderboard-panel";
import { PeriodAutopsyPage } from "./panels/period-autopsy-panel";
import { CostBreakdownPage } from "./panels/cost-breakdown-panel";
import { BacktestLabPanel } from "./panels/backtest-lab-panel";
import { EquityCurvePanel } from "./panels/equity-curve-panel";
import { HubPane } from "./dna";

type ResearchTab = "scorecards" | "autopsies" | "costs" | "lab" | "attribution";

const TABS: HubTab<ResearchTab>[] = [
  { id: "scorecards", label: "Scorecards", hint: "Experience leaderboard" },
  { id: "autopsies", label: "Autopsies", hint: "Merged period post-mortems" },
  { id: "costs", label: "Costs", hint: "API spend breakdown" },
  { id: "lab", label: "Backtest lab", hint: "Run, compare, sweep" },
  {
    id: "attribution",
    label: "Attribution",
    hint: "Equity net of AI spend",
  },
];

type Props = {
  initialTab?: ResearchTab;
  periodAutopsyScope?: "global" | "session";
  periodAutopsySessionId?: string | null;
  periodAutopsyId?: string | null;
  onReviewTrade?: (tradeId: string) => void;
};

/**
 * Journey: arrive → check scorecards / promotion → run or review autopsy →
 * glance at AI cost → leave with one research action taken.
 */
export function ResearchHub({
  initialTab = "scorecards",
  periodAutopsyScope = "global",
  periodAutopsySessionId = null,
  periodAutopsyId = null,
  onReviewTrade,
}: Props) {
  const [tab, setTab] = useState<ResearchTab>(initialTab);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <HubFrame>
      <HubHeader
        eyebrow="Evidence"
        title="Research"
        subtitle="Scorecards, merged autopsies, spend honesty, Backtest Lab, and attribution."
        help={<HelpTooltip glossaryId="promotion-tier" />}
      />
      <HubTabBar
        tabs={TABS}
        active={tab}
        onChange={setTab}
        aria-label="Research sections"
      />
      <HubBody scroll className="p-4">
        {tab === "scorecards" ? <LeaderboardPage /> : null}
        {tab === "autopsies" ? (
          <PeriodAutopsyPage
            initialScope={periodAutopsyScope}
            initialSessionId={periodAutopsySessionId}
            initialPeriodAutopsyId={periodAutopsyId}
            onReviewTrade={onReviewTrade ?? (() => undefined)}
          />
        ) : null}
        {tab === "costs" ? <CostBreakdownPage /> : null}
        {tab === "lab" ? <BacktestLabPanel /> : null}
        {tab === "attribution" ? (
          <HubPane eyebrow="P&L" title="Attribution (net of AI)">
            <EquityCurvePanel showAiCost />
          </HubPane>
        ) : null}
      </HubBody>
    </HubFrame>
  );
}
