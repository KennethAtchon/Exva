import {
  DocCallout,
  DocHeading,
  DocInlineCode,
  DocLink,
  DocList,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function PredictionEventsPage() {
  return (
    <>
      <DocParagraph>
        The <DocInlineCode>prediction_event</DocInlineCode> source polls
        prediction-market platforms for tradable dislocations and emits signals
        scoped to the <DocInlineCode>prediction_market</DocInlineCode>{" "}
        instrument class. It backs the{" "}
        <DocLink to="experiences">Prediction Event Edge</DocLink> experience.
      </DocParagraph>

      <DocHeading id="polling">Polling</DocHeading>
      <DocParagraph>
        On start it polls immediately, then on a fixed interval set by{" "}
        <DocInlineCode>pollIntervalMinutes</DocInlineCode> (default 15 minutes,
        floored at 1 minute). Each poll fetches active, open markets from the
        Polymarket Gamma API (<DocInlineCode>limit=40</DocInlineCode>) and
        deduplicates by <DocInlineCode>conditionId</DocInlineCode> so a market
        only emits once per source lifetime.
      </DocParagraph>
      <DocParagraph>
        Emitted events carry ticker{" "}
        <DocInlineCode>pm:&lt;conditionId&gt;</DocInlineCode>, the market
        question as the company name, and a payload with the resolved{" "}
        <DocInlineCode>outcomeTokenId</DocInlineCode> (the &quot;Yes&quot;
        token), liquidity, last trade price, category, and resolution time.
      </DocParagraph>

      <DocHeading id="trigger-kinds">Trigger kinds</DocHeading>
      <DocParagraph>
        The configured <DocInlineCode>triggerKind</DocInlineCode> selects which
        detection family runs. Two are live; two are stubs that poll without
        emitting.
      </DocParagraph>
      <DocTable
        headers={["Trigger kind", "Status", "Behavior"]}
        rows={[
          [
            <DocInlineCode key="t">odds_volume_dislocation</DocInlineCode>,
            "Live (default)",
            "Emits when a market's last price deviates from 0.50 by at least minPriceDeviation.",
          ],
          [
            <DocInlineCode key="t">curated_event_feed</DocInlineCode>,
            "Live",
            "Emits only for markets whose slug is in curatedMarketSlugs.",
          ],
          [
            <DocInlineCode key="t">social_spike</DocInlineCode>,
            "Stub",
            "Polls and reports running, but emits no events yet.",
          ],
          [
            <DocInlineCode key="t">hybrid_confirmation</DocInlineCode>,
            "Stub",
            "Polls and reports running, but emits no events yet.",
          ],
        ]}
      />

      <DocHeading id="filters">Filters</DocHeading>
      <DocParagraph>
        Each candidate market must clear every gate below before it emits:
      </DocParagraph>
      <DocList
        items={[
          <>
            <DocStrong>Identity</DocStrong> — must have a{" "}
            <DocInlineCode>conditionId</DocInlineCode> and a question.
          </>,
          <>
            <DocStrong>Category whitelist</DocStrong> — if{" "}
            <DocInlineCode>categoryWhitelist</DocInlineCode> is set, the market
            category must be in it.
          </>,
          <>
            <DocStrong>Liquidity</DocStrong> — must meet{" "}
            <DocInlineCode>minLiquidityUsd</DocInlineCode> (default{" "}
            <DocInlineCode>5000</DocInlineCode>).
          </>,
          <>
            <DocStrong>Yes token</DocStrong> — a resolvable &quot;Yes&quot;
            outcome <DocInlineCode>token_id</DocInlineCode> must exist.
          </>,
          <>
            <DocStrong>Price deviation</DocStrong> — for{" "}
            <DocInlineCode>odds_volume_dislocation</DocInlineCode>, deviation
            from 0.50 must reach{" "}
            <DocInlineCode>minPriceDeviation</DocInlineCode> (default{" "}
            <DocInlineCode>0.12</DocInlineCode>).
          </>,
        ]}
      />

      <DocCallout variant="tip" title="Testing a source">
        The source&apos;s test action emits a single synthetic prediction-market
        event so you can verify delivery and pipeline wiring without waiting for
        a live dislocation.
      </DocCallout>
    </>
  );
}
