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
import { SignalSourcesPage } from "./panels/signal-sources-panel";
import { EventSourcesPage } from "./panels/event-sources-panel";
import { InstrumentSetsPage } from "./panels/instrument-sets-panel";
import { DataDoctorPanel } from "./panels/data-doctor-panel";

type SignalsTab = "overview" | "instruments" | "doctor";

const TABS: HubTab<SignalsTab>[] = [
  { id: "overview", label: "Feeds & schedules", hint: "Two-pane input room" },
  {
    id: "instruments",
    label: "Instrument sets",
    hint: "Watchlists and universes",
  },
  { id: "doctor", label: "Data doctor", hint: "Coverage, gaps, backfill" },
];

/**
 * Journey: arrive → check feed health vs next-fire schedules →
 * tune instrument sets → leave knowing sources are live.
 */
export function SignalsHub({
  initialTab = "overview",
}: {
  initialTab?: SignalsTab;
} = {}) {
  const [tab, setTab] = useState<SignalsTab>(initialTab);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <HubFrame>
      <HubHeader
        eyebrow="Inputs"
        title="Signals & Schedules"
        subtitle="Information feeds versus schedules — same mental model as the ops room."
        help={<HelpTooltip glossaryId="signal-source" />}
      />
      <HubTabBar
        tabs={TABS}
        active={tab}
        onChange={setTab}
        aria-label="Signals sections"
      />
      <HubBody scroll={false} className="overflow-hidden">
        {tab === "overview" ? (
          <HubSplit
            leftWidth="50%"
            left={
              <HubPane
                eyebrow="Information"
                title="Signal feeds"
                className="h-full"
              >
                <div className="p-3">
                  <SignalSourcesPage />
                </div>
              </HubPane>
            }
            right={
              <HubPane
                eyebrow="Cadence"
                title="Schedules & events"
                className="h-full"
              >
                <div className="p-3">
                  <EventSourcesPage />
                </div>
              </HubPane>
            }
          />
        ) : null}
        {tab === "instruments" ? (
          <div className="h-full overflow-auto p-4">
            <InstrumentSetsPage />
          </div>
        ) : null}
        {tab === "doctor" ? (
          <div className="h-full overflow-auto">
            <DataDoctorPanel />
          </div>
        ) : null}
      </HubBody>
    </HubFrame>
  );
}
