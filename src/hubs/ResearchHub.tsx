import { useEffect, useState } from "react";
import { HelpTooltip } from "@/components/ui";
import {
  HubBody,
  HubFrame,
  HubHeader,
  HubPane,
  HubSplit,
  HubTabBar,
  type HubTab,
} from "./dna";
import { LeaderboardPage } from "./panels/leaderboard-panel";
import { PeriodAutopsyPage } from "./panels/period-autopsy-panel";
import { CostBreakdownPage } from "./panels/cost-breakdown-panel";
import { BacktestLabPanel } from "./panels/backtest-lab-panel";
import { EquityCurvePanel } from "./panels/equity-curve-panel";

type ResearchTab = "scorecards" | "autopsies" | "costs" | "lab" | "attribution";

const TABS: HubTab<ResearchTab>[] = [
  { id: "scorecards", label: "Scorecards", hint: "Experience leaderboard" },
  { id: "autopsies", label: "Autopsies", hint: "Merged period post-mortems" },
  { id: "costs", label: "Costs", hint: "API spend breakdown" },
  { id: "lab", label: "Lab", hint: "Run, compare, sweep" },
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
        subtitle="Scorecards, autopsies, spend honesty, and backtest lab."
        help={<HelpTooltip glossaryId="promotion-tier" />}
      />
      <HubTabBar
        tabs={TABS}
        active={tab}
        onChange={setTab}
        aria-label="Research sections"
      />
      <HubBody
        scroll={tab !== "autopsies"}
        className={tab === "autopsies" ? "overflow-hidden" : "p-6"}
      >
        {tab === "scorecards" ? (
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <HubSplit
              leftWidth="58%"
              left={
                <HubPane
                  eyebrow="Rankings"
                  title="Experience leaderboard"
                  className="min-h-[420px]"
                >
                  <LeaderboardPage embedded />
                </HubPane>
              }
              right={
                <HubPane
                  eyebrow="Equity"
                  title="Portfolio curve"
                  className="min-h-[420px]"
                >
                  <EquityCurvePanel />
                </HubPane>
              }
            />
          </div>
        ) : null}
        {tab === "autopsies" ? (
          <PeriodAutopsyPage
            initialScope={periodAutopsyScope}
            initialSessionId={periodAutopsySessionId}
            initialPeriodAutopsyId={periodAutopsyId}
            onReviewTrade={onReviewTrade ?? (() => undefined)}
          />
        ) : null}
        {tab === "costs" ? (
          <div className="mx-auto max-w-5xl">
            <CostBreakdownPage />
          </div>
        ) : null}
        {tab === "lab" ? (
          <div className="mx-auto max-w-6xl">
            <BacktestLabPanel />
          </div>
        ) : null}
        {tab === "attribution" ? (
          <div className="mx-auto max-w-3xl">
            <HubPane eyebrow="P&L" title="Attribution (net of AI)">
              <EquityCurvePanel showAiCost />
            </HubPane>
          </div>
        ) : null}
      </HubBody>
    </HubFrame>
  );
}
