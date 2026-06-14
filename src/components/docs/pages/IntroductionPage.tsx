import {
  DocCallout,
  DocCard,
  DocCardGrid,
  DocLink,
  DocParagraph,
  DocStrong,
} from "../primitives";

export function IntroductionPage() {
  return (
    <>
      <DocParagraph>
        Exva is a desktop trading operations platform. It connects to broker
        accounts and AI providers, listens for market catalysts through
        configurable signal sources, runs a structured research pipeline for
        each candidate instrument, and executes trades when risk gates pass.
      </DocParagraph>
      <DocParagraph>
        The system is organized around <DocStrong>experiences</DocStrong> —
        packaged trading setups that define which signal types, instrument
        classes, pipeline, and strategy presets a session uses. You configure
        global infrastructure once (accounts, brokers, signal sources), then
        create sessions that subscribe to those resources.
      </DocParagraph>
      <DocCallout variant="tip" title="How to use these docs">
        Browse topics in the left sidebar. Each page is self-contained with
        cross-references, a table of contents on the right, and previous/next
        navigation at the bottom. Terminology matches the in-app help tooltips.
      </DocCallout>
      <DocCardGrid>
        <DocCard
          title="Quickstart"
          description="First-run setup: accounts, signals, sessions, and paper trading."
          to="quickstart"
        />
        <DocCard
          title="EDGAR 8-K signals"
          description="How Exva detects SEC filings and converts them into trade candidates."
          to="edgar-overview"
        />
        <DocCard
          title="Signal architecture"
          description="End-to-end flow from detection through delivery to the pipeline."
          to="signal-architecture"
        />
        <DocCard
          title="Glossary"
          description="Definitions for terms used across Exva and this documentation."
          to="glossary"
        />
      </DocCardGrid>
      <DocParagraph>
        New to catalyst trading? Start with{" "}
        <DocLink to="core-concepts">Core concepts</DocLink>, then follow the{" "}
        <DocLink to="quickstart">Quickstart</DocLink> before enabling live
        execution.
      </DocParagraph>
    </>
  );
}
