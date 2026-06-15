import {
  DocCallout,
  DocHeading,
  DocInlineCode,
  DocLink,
  DocList,
  DocParagraph,
  DocStrong,
} from "../primitives";

export function MockManualSourcesPage() {
  return (
    <>
      <DocParagraph>
        Two source types exist outside the live feeds: a synthetic{" "}
        <DocInlineCode>mock</DocInlineCode> source for testing and a{" "}
        <DocInlineCode>manual</DocInlineCode> mode with no automated feed at
        all.
      </DocParagraph>

      <DocHeading id="mock">Mock</DocHeading>
      <DocParagraph>
        The <DocInlineCode>mock</DocInlineCode> source emits synthetic
        EDGAR-style 8-K events through the full bus → delivery → orchestrator
        path, so it exercises the same code as a real catalyst. It is built for
        scripted end-to-end testing and rehearsal — not live trading.
      </DocParagraph>
      <DocList
        items={[
          <>
            <DocStrong>ticker</DocStrong> — defaults to{" "}
            <DocInlineCode>NVDA</DocInlineCode>; payload includes item codes{" "}
            <DocInlineCode>1.01</DocInlineCode> and{" "}
            <DocInlineCode>8.01</DocInlineCode> and a{" "}
            <DocInlineCode>scripted: true</DocInlineCode> flag.
          </>,
          <>
            <DocStrong>intervalMs</DocStrong> — <DocInlineCode>0</DocInlineCode>{" "}
            (default) means it only fires on a manual test; a positive value
            auto-fires on that cadence.
          </>,
          <>
            <DocStrong>instrumentClass</DocStrong> — from config (default{" "}
            <DocInlineCode>stock</DocInlineCode>).
          </>,
        ]}
      />
      <DocCallout variant="warning" title="Not for live trading">
        Mock signals are deterministic and synthetic. Use them in development
        and scripted tests only.
      </DocCallout>

      <DocHeading id="manual">Manual</DocHeading>
      <DocParagraph>
        The <DocInlineCode>manual</DocInlineCode> type is not a polling source —
        it has no source class and emits nothing. A session set to manual runs
        from the tickers the operator enters directly, feeding the manual
        shortlist entry mode instead of a detected catalyst.
      </DocParagraph>
      <DocParagraph>
        Use it for operator-driven watchlists where you choose the instruments
        and let the pipeline evaluate them. See{" "}
        <DocLink to="sessions">Sessions &amp; lifecycle</DocLink> for how manual
        tickers attach to a session.
      </DocParagraph>
    </>
  );
}
