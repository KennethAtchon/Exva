import { useEffect, useState } from "react";
import { HelpTooltip } from "@/components/ui";
import { HubBody, HubFrame, HubHeader } from "./dna";
import { SessionsMasterDetail } from "./panels/sessions-panel";
import type { SessionStatus } from "@/lib/types";
import type { DevPanelFocus } from "./panels/dev-panel";

type SessionsTab = "run" | "trades" | "config";

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
 * Journey: arrive → pick a session from the list → run, trades, or config →
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
      <HubBody scroll={false} className="overflow-hidden">
        <SessionsMasterDetail
          tab={tab}
          onTabChange={setTab}
          initialStatusFilter={initialStatusFilter}
          onInitialStatusFilterApplied={onInitialStatusFilterApplied}
          onGoToAccounts={onGoToAccounts}
          onViewTrace={onViewTrace}
          onViewAutopsy={onViewAutopsy}
        />
      </HubBody>
    </HubFrame>
  );
}
