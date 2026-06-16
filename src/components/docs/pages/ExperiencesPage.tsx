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

export function ExperiencesPage() {
  return (
    <>
      <DocParagraph>
        An <DocStrong>experience</DocStrong> bundles everything a session needs
        except runtime state: a signal source, a pipeline, default strategy
        presets, and a capability declaration. When you create a session you
        pick an experience, and Exva provisions the matching signal source type
        and pipeline automatically. The experience decides <em>what</em> a
        session can do; the <DocLink to="strategy">Strategy</DocLink> tab tunes{" "}
        <em>how</em>.
      </DocParagraph>

      <DocHeading id="anatomy" level={2}>
        Anatomy of an experience
      </DocHeading>
      <DocList
        items={[
          <>
            <DocStrong>Capabilities</DocStrong> — supported instrument classes,
            compatible signal source types, and a broker requirement. The{" "}
            <DocLink to="signal-architecture">delivery gate</DocLink> uses these
            to reject incompatible signals as{" "}
            <DocLink to="core-concepts">dead letters</DocLink> before they spend
            pipeline budget.
          </>,
          <>
            <DocStrong>Signal source</DocStrong> — the default feed and its
            config (e.g. EDGAR item codes, a timer symbol and cadence).
          </>,
          <>
            <DocStrong>Pipeline</DocStrong> — the analysis flow that runs when a
            signal arrives.
          </>,
          <>
            <DocStrong>Default presets</DocStrong> — the Style, Rules, Risk, and
            Timeframe presets a new session starts with.
          </>,
        ]}
      />

      <DocHeading id="lifecycle" level={2}>
        From signal to trade
      </DocHeading>
      <DocParagraph>
        Every experience follows the same path: the signal source{" "}
        <DocStrong>detects</DocStrong> an event and emits a signal, the{" "}
        <DocLink to="signal-architecture">SignalBus</DocLink> fans it out to
        each subscribed session as a queued delivery, the delivery gate checks
        it against the experience&apos;s capabilities, and the pipeline turns it
        into a trade or no-trade decision. What differs between experiences is
        how the signal is calculated and which pipeline runs.
      </DocParagraph>

      <DocTable
        headers={["Experience", "Signal", "Instruments", "Pipeline"]}
        rows={[
          [
            "EDGAR 8-K catalyst drift",
            <DocInlineCode>edgar_8k</DocInlineCode>,
            "US stocks",
            <DocLink to="edgar-pipeline">Catalyst → review → decision</DocLink>,
          ],
          [
            "SPY / QQQ 15m mean reversion (rules)",
            <DocInlineCode>timer</DocInlineCode>,
            "Stocks",
            "Rule-based mean reversion",
          ],
          [
            "BTC-USD 1h momentum breakout (rules)",
            <DocInlineCode>timer</DocInlineCode>,
            "Crypto",
            "Rule-based momentum (shared rules pipeline)",
          ],
          [
            "GC/CL 4h trend following (rules)",
            <DocInlineCode>timer</DocInlineCode>,
            "Futures",
            "Rule-based trend following",
          ],
          [
            "Prediction event edge",
            <DocInlineCode>prediction_event</DocInlineCode>,
            "Prediction markets",
            "Event-driven probability edge",
          ],
        ]}
      />

      <DocHeading id="edgar" level={2}>
        EDGAR 8-K catalyst drift
      </DocHeading>
      <DocParagraph>
        Trades post-filing drift on US stocks. The{" "}
        <DocLink to="edgar-detection">EDGAR source</DocLink> polls the SEC Atom
        feed, resolves each filer&apos;s CIK to a ticker, and keeps only filings
        whose item code is in the whitelist (defaults to{" "}
        <DocInlineCode>1.01, 1.03, 2.02, 2.03, 3.02, 5.02, 8.01</DocInlineCode>)
        and older than the min filing age. Matching filings emit a signal that
        runs the <DocLink to="edgar-pipeline">EDGAR 8-K pipeline</DocLink>:
        catalyst analysis, then review, then decision. It also accepts{" "}
        <DocInlineCode>mock</DocInlineCode> signals for rehearsal. Defaults:
        EDGAR Catalyst style, Catalyst Entry rules, Moderate risk, Catalyst
        timeframe.
      </DocParagraph>

      <DocHeading id="rules" level={2}>
        Rule-based experiences (timer)
      </DocHeading>
      <DocParagraph>
        The mean-reversion, momentum, and trend-following experiences are{" "}
        <DocStrong>rule-based</DocStrong>: a{" "}
        <DocLink to="timer-signals">timer source</DocLink> fires on a fixed
        cadence per symbol, and a deterministic engine computes the setup from
        OHLCV data with minimal or no LLM involvement. The signal is the timer
        tick; the &quot;edge&quot; is the rule math.
      </DocParagraph>
      <DocTable
        headers={["Experience", "Symbol · cadence", "Engine"]}
        rows={[
          [
            "SPY 15m mean reversion",
            <DocInlineCode>SPY · 15m</DocInlineCode>,
            "Mean reversion on stocks.",
          ],
          [
            "QQQ 15m mean reversion",
            <DocInlineCode>QQQ · 15m</DocInlineCode>,
            "Mean reversion focused on QQQ.",
          ],
          [
            "BTC-USD 1h momentum breakout",
            <DocInlineCode>BTC-USD · 1h</DocInlineCode>,
            "Momentum breakout (runs the shared rules pipeline).",
          ],
          [
            "GC/CL 4h trend following",
            <DocInlineCode>GC · 4h</DocInlineCode>,
            "Trend following on commodity futures.",
          ],
        ]}
      />
      <DocParagraph>
        All four ship with Manual Watchlist style, Moderate risk, and a Swing
        timeframe by default. Because the setup is computed deterministically,
        these experiences spend far less on AI than catalyst or prediction
        flows.
      </DocParagraph>

      <DocHeading id="prediction" level={2}>
        Prediction event edge
      </DocHeading>
      <DocParagraph>
        Trades event contracts on prediction markets and requires a Polymarket
        broker. The{" "}
        <DocLink to="prediction-events">prediction-event source</DocLink> polls
        every 15 minutes for an{" "}
        <DocInlineCode>odds_volume_dislocation</DocInlineCode> trigger, filtered
        by minimum liquidity (default <DocInlineCode>$5,000</DocInlineCode>) and
        a minimum price deviation (default <DocInlineCode>0.12</DocInlineCode>).
        Qualifying events run the prediction-event pipeline, which is anchored
        on probability edge rather than chart patterns. Defaults: Prediction
        Event Edge style, Probability Edge rules, Prediction Market risk,
        Prediction timeframe.
      </DocParagraph>

      <DocCallout variant="info" title="Capabilities are the contract">
        An experience only runs signals it declares it can handle. The default
        presets are a starting point — you can retune any{" "}
        <DocLink to="strategy">Strategy</DocLink> section per session within
        what the capabilities allow.
      </DocCallout>
    </>
  );
}
