import { useEffect, useState } from "react";
import { HelpTooltip } from "@/components/ui";
import { HubBody, HubFrame, HubHeader, HubTabBar, type HubTab } from "./dna";
import { SessionsPage } from "./panels/sessions-panel";
import { TradesPage } from "./panels/trades-panel";
import { StrategyConfig } from "./panels/strategy-config-panel";
import type { SessionStatus } from "@/lib/types";
import type { DevPanelFocus } from "./panels/dev-panel";

type SessionsTab = "run" | "trades" | "config";

const TABS: HubTab<SessionsTab>[] = [
  { id: "run", label: "Run", hint: "Session list, controls, execution" },
  { id: "trades", label: "Trades", hint: "Trade history for this workspace" },
  {
    id: "config",
    label: "Config",
    hint: "Session strategy document for the focused session",
  },
];

type Props = {
  initialStatusFilter?: SessionStatus | "all";
  onInitialStatusFilterApplied?: () => void;
  onGoToAccounts?: () => void;
  onViewTrace?: (
    sessionId: string,
    cycleId: string,
    stage: DevPanelFocus["stage"],
  ) => void;
  onViewAutopsy?: (tradeId: string) => void;
  initialTab?: SessionsTab;
};

/**
 * Journey: arrive → see what's running → open a session → trades or config →
 * leave with one focused session under control.
 */
export function SessionsHub({
  initialStatusFilter = "all",
  onInitialStatusFilterApplied,
  onGoToAccounts,
  onViewTrace,
  onViewAutopsy,
  initialTab = "run",
}: Props) {
  const [tab, setTab] = useState<SessionsTab>(initialTab);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <HubFrame>
      <HubHeader
        eyebrow="Execution"
        title="Sessions"
        subtitle="Runtime state, trades, and session config in one instrument panel."
        help={<HelpTooltip glossaryId="session" />}
      />
      <HubTabBar
        tabs={TABS}
        active={tab}
        onChange={setTab}
        aria-label="Sessions sections"
      />
      <HubBody
        scroll={tab !== "run"}
        className={tab === "run" ? "overflow-hidden" : "p-4"}
      >
        {tab === "run" ? (
          <SessionsPage
            initialStatusFilter={initialStatusFilter}
            onInitialStatusFilterApplied={onInitialStatusFilterApplied}
            onGoToStrategy={() => setTab("config")}
            onGoToAccounts={onGoToAccounts}
            onViewTrace={onViewTrace}
          />
        ) : null}
        {tab === "trades" ? (
          <TradesPage onViewAutopsy={onViewAutopsy ?? (() => undefined)} />
        ) : null}
        {tab === "config" ? (
          <StrategyConfig onGoToSessions={() => setTab("run")} />
        ) : null}
      </HubBody>
    </HubFrame>
  );
}
