import { useEffect, useState } from "react";
import { HelpTooltip } from "@/components/ui";
import { HubBody, HubFrame, HubHeader, HubSideNav, type HubTab } from "./dna";
import { AccountsPage } from "./panels/accounts-panel";
import { BrokersPage } from "./panels/brokers-panel";
import { DevPanel, type DevPanelFocus } from "./panels/dev-panel";

type SettingsTab = "accounts" | "brokers" | "developer";

type Props = {
  initialTab?: SettingsTab;
  onJumpToSession?: (sessionId: string) => void | Promise<void>;
  devPanelFocus?: DevPanelFocus | null;
  onDevFocusConsumed?: () => void;
};

/**
 * Journey: arrive → accounts / brokers / ops → (dev) open workbench →
 * leave with credentials and sinks healthy.
 */
export function SettingsHub({
  initialTab = "accounts",
  onJumpToSession,
  devPanelFocus,
  onDevFocusConsumed,
}: Props) {
  const isDev =
    typeof window !== "undefined" && Boolean(window.exva?.developer);
  const [tab, setTab] = useState<SettingsTab>(
    initialTab === "developer" && !isDev ? "accounts" : initialTab,
  );

  useEffect(() => {
    const next = initialTab === "developer" && !isDev ? "accounts" : initialTab;
    setTab(next);
  }, [initialTab, isDev]);

  useEffect(() => {
    if (devPanelFocus) {
      setTab("developer");
    }
  }, [devPanelFocus]);

  const navItems: HubTab<SettingsTab>[] = [
    {
      id: "accounts",
      label: "Accounts",
      hint: "AI, search, notifications, backups",
    },
    {
      id: "brokers",
      label: "Brokers",
      hint: "Balances, paper reset, routing",
    },
    ...(isDev
      ? [
          {
            id: "developer" as const,
            label: "Developer",
            hint: "Traces, events, injectors",
          },
        ]
      : []),
  ];

  return (
    <HubFrame>
      <HubHeader
        eyebrow="System"
        title="Settings"
        subtitle="Accounts, brokers, notification sinks, backups, and (dev) the workbench."
        help={<HelpTooltip glossaryId="broker-accounts" />}
      />
      <HubBody scroll={false} className="flex min-h-0 flex-1">
        <HubSideNav
          items={navItems}
          active={tab}
          onChange={setTab}
          aria-label="Settings sections"
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {tab === "developer" && isDev ? (
            <DevPanel
              focus={devPanelFocus}
              onFocusConsumed={onDevFocusConsumed}
            />
          ) : (
            <div className="mx-auto w-full max-w-[760px] px-6 py-5">
              {tab === "accounts" ? <AccountsPage /> : null}
              {tab === "brokers" ? (
                <BrokersPage
                  onJumpToSession={onJumpToSession ?? (async () => undefined)}
                />
              ) : null}
            </div>
          )}
        </div>
      </HubBody>
    </HubFrame>
  );
}
