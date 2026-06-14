import {
  DocCallout,
  DocLink,
  DocList,
  DocParagraph,
  DocStrong,
} from "../primitives";

export function QuickstartPage() {
  return (
    <>
      <DocParagraph>
        This guide walks through the minimum setup to run Exva in paper mode
        with an EDGAR catalyst session. Adjust steps if you use a different{" "}
        <DocLink to="experiences">experience</DocLink>.
      </DocParagraph>
      <DocList
        items={[
          <>
            <DocStrong>Accounts</DocStrong> — Add AI provider keys (Anthropic,
            OpenAI, or OpenRouter) and broker credentials on the Accounts page.
            Test connections before trading.
          </>,
          <>
            <DocStrong>Brokers</DocStrong> — Review broker health, supported{" "}
            <DocLink to="glossary" heading="term-instrument-class">
              instrument classes
            </DocLink>
            , and capital allocation per session.
          </>,
          <>
            <DocStrong>Signals</DocStrong> — Create and enable an{" "}
            <DocLink to="edgar-overview">EDGAR 8-K</DocLink> source on the
            Signals page. Sources are global; sessions subscribe when created.
          </>,
          <>
            <DocStrong>Strategy</DocStrong> — Configure risk limits, position
            sizing, AI phase models, and trade rules for the focused session.
          </>,
          <>
            <DocStrong>Sessions</DocStrong> — Create a session, pick the EDGAR
            Catalyst experience, subscribe to your signal source, assign
            brokers, then start from the header controls.
          </>,
        ]}
      />
      <DocCallout variant="warning" title="Paper first">
        Keep the workspace in Paper mode until you have validated{" "}
        <DocLink to="signal-architecture">signal flow</DocLink>, strategy
        settings, and session behavior. Live execution requires additional{" "}
        <DocLink to="environment">readiness checks</DocLink>.
      </DocCallout>
      <DocParagraph>
        After your first session is active, monitor signal deliveries in the
        session detail drawer and review the{" "}
        <DocLink to="sessions">session lifecycle</DocLink> docs if status
        changes unexpectedly.
      </DocParagraph>
    </>
  );
}
