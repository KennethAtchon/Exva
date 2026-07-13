import { useEffect, useState } from "react";
import { Button, HelpTooltip } from "@/components/ui";
import { SectionHeader } from "@/components/ui/primitives";
import { HubBody, HubFrame, HubHeader, HubTabBar, type HubTab } from "./dna";
import { SignalSourcesPage } from "./panels/signal-sources-panel";
import { EventSourcesPage } from "./panels/event-sources-panel";
import { InstrumentSetsPage } from "./panels/instrument-sets-panel";
import { DataDoctorPanel } from "./panels/data-doctor-panel";

type SignalsTab = "overview" | "instruments" | "doctor";

const TABS: HubTab<SignalsTab>[] = [
  { id: "overview", label: "Overview", hint: "Signal and event source health" },
  {
    id: "instruments",
    label: "Instruments",
    hint: "Watchlists and universes",
  },
  { id: "doctor", label: "Doctor", hint: "Coverage checks and data gaps" },
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
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <HubFrame>
      <HubHeader
        eyebrow="Inputs"
        title="Signals & Schedules"
        subtitle="Source health, instrument universes, and data coverage in one place."
        help={<HelpTooltip glossaryId="signal-source" />}
      />
      <HubTabBar
        tabs={TABS}
        active={tab}
        onChange={setTab}
        aria-label="Signals sections"
      />
      <HubBody scroll className="p-6">
        {tab === "overview" ? (
          <div className="mx-auto flex max-w-6xl flex-col gap-8">
            <section>
              <SectionHeader
                eyebrow="Information"
                title="Signal sources"
                action={
                  <Button size="sm" onClick={() => setAddSourceOpen(true)}>
                    Add source
                  </Button>
                }
              />
              <SignalSourcesPage
                embedded
                addOpenExternal={addSourceOpen}
                onAddOpenChange={setAddSourceOpen}
              />
            </section>
            <section>
              <SectionHeader eyebrow="Cadence" title="Event sources" />
              <EventSourcesPage embedded />
            </section>
          </div>
        ) : null}
        {tab === "instruments" ? (
          <div className="mx-auto max-w-6xl">
            <InstrumentSetsPage />
          </div>
        ) : null}
        {tab === "doctor" ? (
          <div className="mx-auto max-w-5xl">
            <DataDoctorPanel />
          </div>
        ) : null}
      </HubBody>
    </HubFrame>
  );
}
