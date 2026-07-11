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
        The <DocInlineCode>prediction_event</DocInlineCode> source watches{" "}
        <DocStrong>Polymarket</DocStrong> for markets that look worth analyzing
        — typically ones where the odds have moved meaningfully away from a coin
        flip. When it finds one, it emits a signal that kicks off the{" "}
        <DocLink to="experiences">Prediction Event Edge</DocLink> pipeline. The
        source itself is a fast, simple scanner; the AI pipeline decides whether
        there is real probability edge and whether to trade.
      </DocParagraph>

      <DocParagraph>
        This is an <DocStrong>event-driven</DocStrong> feed, not a clock tick
        like the <DocLink to="timer-signals">timer source</DocLink>. Signals
        arrive when a new market passes the filters below, not on a fixed
        schedule per symbol. A session needs a Polymarket broker connected —
        otherwise signals are rejected at the{" "}
        <DocLink to="signal-architecture">delivery gate</DocLink>.
      </DocParagraph>

      <DocHeading id="how-it-works">How it works</DocHeading>
      <DocParagraph>
        On start the source polls Polymarket immediately, then repeats every{" "}
        <DocInlineCode>pollIntervalMinutes</DocInlineCode> (default 15 minutes,
        minimum 1 minute). Each poll fetches up to 40 active, open markets from
        the Polymarket Gamma API and runs each through the filter checklist
        below.
      </DocParagraph>
      <DocList
        items={[
          <>
            A market that fails any filter is skipped (counted as{" "}
            <em>dropped</em>).
          </>,
          <>
            A market that passes and has{" "}
            <DocStrong>never been seen before</DocStrong> in this source&apos;s
            lifetime emits a signal (counted as <em>passed</em>).
          </>,
          <>
            A market that already emitted is ignored — each market triggers at
            most once until you restart or reconfigure the source (which clears
            the seen list).
          </>,
        ]}
      />
      <DocParagraph>
        Think of it as a periodic scan of the top active markets, not continuous
        monitoring of a single contract.
      </DocParagraph>

      <DocHeading id="dislocation">
        What &quot;interesting&quot; means
      </DocHeading>
      <DocParagraph>
        On Polymarket, contract prices are implied probabilities. A price of{" "}
        <DocInlineCode>0.50</DocInlineCode> (50¢) means the market is roughly
        split 50/50. Higher prices mean the market thinks the outcome is more
        likely; lower prices mean less likely.
      </DocParagraph>
      <DocParagraph>
        The default trigger mode (
        <DocInlineCode>odds_volume_dislocation</DocInlineCode>) looks for
        markets whose last traded price is at least{" "}
        <DocInlineCode>minPriceDeviation</DocInlineCode> away from 50¢ — default{" "}
        <DocInlineCode>0.12</DocInlineCode>, so 38¢ or 62¢ and beyond. The idea
        is that a large move <em>might</em> signal mispricing, stale odds, or
        volume-driven distortion worth investigating. Passing this filter does{" "}
        <DocStrong>not</DocStrong> mean the market is wrong — it only means
        &quot;worth sending to the AI pipeline.&quot;
      </DocParagraph>

      <DocHeading id="downstream">After a signal fires</DocHeading>
      <DocParagraph>
        Qualifying events follow the same path as other experience signals:
      </DocParagraph>
      <DocList
        items={[
          <>
            <DocStrong>Delivery gate</DocStrong> — checks that the session
            supports prediction markets and has a Polymarket broker. Failures
            become <DocLink to="core-concepts">dead letters</DocLink>.
          </>,
          <>
            <DocStrong>Queue</DocStrong> — valid signals wait in the session
            queue (respecting pause state and pipeline budget).
          </>,
          <>
            <DocStrong>Pipeline</DocStrong> — the Prediction Event Edge cycle
            runs technical → fundamental → review → decision, anchored on
            probability edge rather than chart patterns.
          </>,
          <>
            <DocStrong>Outcome</DocStrong> — the pipeline may propose a trade,
            reject the setup, or drop it. Most scanner hits do not become
            trades.
          </>,
        ]}
      />

      <DocHeading id="trigger-kinds">Trigger kinds</DocHeading>
      <DocParagraph>
        <DocInlineCode>triggerKind</DocInlineCode> selects what counts as
        interesting. Two modes are live; two are placeholders that poll without
        emitting.
      </DocParagraph>
      <DocTable
        headers={["Trigger kind", "Status", "What it does"]}
        rows={[
          [
            <DocInlineCode key="t">odds_volume_dislocation</DocInlineCode>,
            "Live (default)",
            "Any liquid market whose price has moved at least minPriceDeviation away from 50¢.",
          ],
          [
            <DocInlineCode key="t">curated_event_feed</DocInlineCode>,
            "Live",
            "Only markets you list in curatedMarketSlugs — a hand-picked watchlist.",
          ],
          [
            <DocInlineCode key="t">social_spike</DocInlineCode>,
            "Planned",
            "Polls and reports running, but emits no events yet.",
          ],
          [
            <DocInlineCode key="t">hybrid_confirmation</DocInlineCode>,
            "Planned",
            "Polls and reports running, but emits no events yet.",
          ],
        ]}
      />

      <DocHeading id="filters">Filter checklist</DocHeading>
      <DocParagraph>
        Every candidate market must pass <DocStrong>all</DocStrong> of these
        before it can emit:
      </DocParagraph>
      <DocList
        items={[
          <>
            <DocStrong>Basic info</DocStrong> — must have a market ID (
            <DocInlineCode>conditionId</DocInlineCode>) and a question (e.g.
            &quot;Will X happen by Y?&quot;).
          </>,
          <>
            <DocStrong>Category whitelist</DocStrong> — optional. If{" "}
            <DocInlineCode>categoryWhitelist</DocInlineCode> is set, the
            market&apos;s category must be in the list.
          </>,
          <>
            <DocStrong>Liquidity</DocStrong> — must meet{" "}
            <DocInlineCode>minLiquidityUsd</DocInlineCode> (default{" "}
            <DocInlineCode>5000</DocInlineCode>) so you are not trading dead
            markets.
          </>,
          <>
            <DocStrong>Tradable &quot;Yes&quot; token</DocStrong> — Exva needs a
            concrete outcome token to trade, not just the question text.
          </>,
          <>
            <DocStrong>Price deviation</DocStrong> — for{" "}
            <DocInlineCode>odds_volume_dislocation</DocInlineCode>, the last
            price must be at least{" "}
            <DocInlineCode>minPriceDeviation</DocInlineCode> away from 50¢
            (default <DocInlineCode>0.12</DocInlineCode>).
          </>,
        ]}
      />

      <DocHeading id="signal-payload">What&apos;s in a signal</DocHeading>
      <DocParagraph>When a market emits, the event includes:</DocParagraph>
      <DocList
        items={[
          <>
            <DocStrong>Ticker</DocStrong> —{" "}
            <DocInlineCode>pm:&lt;conditionId&gt;</DocInlineCode> (Exva&apos;s
            name for the prediction market).
          </>,
          <>
            <DocStrong>Name</DocStrong> — the market question.
          </>,
          <>
            <DocStrong>Link</DocStrong> — Polymarket URL when a slug is
            available.
          </>,
          <>
            <DocStrong>Payload</DocStrong> — the &quot;Yes&quot; outcome token
            ID, liquidity, last trade price, category, resolution time, and
            instrument class <DocInlineCode>prediction_market</DocInlineCode>.
          </>,
        ]}
      />

      <DocHeading id="configuration">Configuration</DocHeading>
      <DocTable
        headers={["Field", "Default", "Notes"]}
        rows={[
          [
            <DocInlineCode key="f">pollIntervalMinutes</DocInlineCode>,
            "15",
            "How often to scan Polymarket. Floored at 1 minute.",
          ],
          [
            <DocInlineCode key="f">triggerKind</DocInlineCode>,
            "odds_volume_dislocation",
            "Which detection mode to use. See trigger kinds above.",
          ],
          [
            <DocInlineCode key="f">minLiquidityUsd</DocInlineCode>,
            "5000",
            "Minimum liquidity (USD) for a market to qualify.",
          ],
          [
            <DocInlineCode key="f">minPriceDeviation</DocInlineCode>,
            "0.12",
            "For odds_volume_dislocation: minimum distance from 50¢.",
          ],
          [
            <DocInlineCode key="f">categoryWhitelist</DocInlineCode>,
            "—",
            "Optional list of allowed categories. Empty = all categories.",
          ],
          [
            <DocInlineCode key="f">curatedMarketSlugs</DocInlineCode>,
            "—",
            "For curated_event_feed: Polymarket slugs to watch.",
          ],
        ]}
      />

      <DocCallout variant="tip" title="Testing without waiting">
        Use the source&apos;s test action to emit a single synthetic
        prediction-market event. This verifies delivery and pipeline wiring
        without waiting for a live dislocation on Polymarket.
      </DocCallout>
    </>
  );
}
