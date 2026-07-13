import {
  DocCallout,
  DocInlineCode,
  DocLink,
  DocParagraph,
  DocTable,
} from "../primitives";

export function SignalSourceTypesPage() {
  return (
    <>
      <DocParagraph>
        Signal sources are global resources. Create them on Signals & Schedules
        → Feeds and configure sessions to use them via the Experience Inputs
        editor. Disabling a source keeps subscriptions intact but moves
        subscribed sessions to a waiting state.
      </DocParagraph>
      <DocCallout variant="info" title="Removed types">
        The former <DocInlineCode>timer</DocInlineCode> and{" "}
        <DocInlineCode>web_search</DocInlineCode> source types are gone.
        Schedules live in the Experience Inputs editor; search remains an
        evidence-engine tool, not a signal source. Migration{" "}
        <DocInlineCode>0006_purge_deprecated_signal_sources</DocInlineCode>{" "}
        deletes leftover DB rows.
      </DocCallout>
      <DocTable
        headers={["Type", "Description", "Typical use"]}
        rows={[
          [
            "edgar_8k",
            <>
              Polls SEC Form 8-K Atom feed; resolves CIK to ticker. See{" "}
              <DocLink to="edgar-overview">EDGAR docs</DocLink>.
            </>,
            "EDGAR Catalyst experience.",
          ],
          [
            "manual",
            <>
              No automated feed; session runs from manual tickers only. See{" "}
              <DocLink to="mock-manual-sources">Mock &amp; manual</DocLink>.
            </>,
            "Operator-driven watchlists.",
          ],
          [
            "mock",
            <>
              Deterministic synthetic signals for rehearsal. See{" "}
              <DocLink to="mock-manual-sources">Mock &amp; manual</DocLink>.
            </>,
            "Development and scripted testing — not for live trading.",
          ],
          [
            "prediction_event",
            <>
              Polls prediction-market platforms for odds/volume dislocations.
              See <DocLink to="prediction-events">Prediction events</DocLink>.
            </>,
            <>
              <DocLink to="experiences">Prediction Event Edge</DocLink>{" "}
              experience.
            </>,
          ],
          [
            "kalshi_market",
            <>
              Polls Kalshi markets for dislocations with Kalshi fee costs.
              Cross-venue divergence vs Polymarket uses the approved match
              table.
            </>,
            "Prediction Event Edge (venue=kalshi) + cross-venue scan.",
          ],
          [
            "calendar",
            <>
              Earnings + seeded FOMC/CPI calendar events. Primary consumer is
              the risk-gate blackout; secondary is Dashboard attention.
            </>,
            "Risk hygiene for all equity sessions.",
          ],
          [
            "news_rss",
            <>
              PR Newswire / GlobeNewswire / Business Wire RSS. Context
              enrichment only — does not create trade candidates.
            </>,
            "Evidence freshness cross-check.",
          ],
        ]}
      />
      <DocCallout variant="info" title="Scheduled scans (not source types)">
        Form 4 insider clusters, unusual volume, funding/basis, and cross-venue
        dislocation are <DocInlineCode>scheduled_scan</DocInlineCode> strategies
        registered <DocInlineCode>available</DocInlineCode> in the strategy
        catalog — they emit <DocInlineCode>scan_hit</DocInlineCode> or{" "}
        <DocInlineCode>market_dislocation</DocInlineCode> /
        <DocInlineCode>filing</DocInlineCode> signals via the schedule
        coordinator.
      </DocCallout>
    </>
  );
}
