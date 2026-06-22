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
        An <DocStrong>experience</DocStrong> is a general trading theme — a
        &quot;tent&quot; — that groups one or more{" "}
        <DocStrong>signals</DocStrong> you can toggle independently per session.
        It declares a pipeline (the strategy that defines the tent), capability
        constraints, and default presets. When you create a session you pick an
        experience, choose which of its signals to enable, and Exva provisions
        the matching signal sources and routes them to the experience&apos;s
        pipeline automatically. The experience decides <em>what</em> a session
        can do; the <DocLink to="strategy">Strategy</DocLink> tab tunes{" "}
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
            <DocStrong>Signals</DocStrong> — one or more toggleable{" "}
            <DocStrong>signal descriptors</DocStrong>, each specifying a source
            type, instrument class, symbol, poll cadence (timer gap), and
            analysis timeframe. You enable or disable each signal when creating
            a session; enabled signals are provisioned into{" "}
            <DocInlineCode>signal_sources</DocInlineCode> and linked to the
            session via the many-to-many join. Adding a symbol does not require
            a new experience — it is a new signal within the same tent.
          </>,
          <>
            <DocStrong>Pipeline</DocStrong> — the analysis flow that runs when
            any of the experience&apos;s signals arrives. One pipeline per
            experience; every signal in the tent routes to the same cycle.
          </>,
          <>
            <DocStrong>Default presets</DocStrong> — the Style, Rules, Risk, and
            Timeframe presets a new session starts with. Individual signals may
            declare preset overrides that are merged on top of the tent&apos;s
            defaults.
          </>,
        ]}
      />

      <DocHeading id="lifecycle" level={2}>
        From signal to trade
      </DocHeading>
      <DocParagraph>
        Every experience follows the same path: an enabled signal source{" "}
        <DocStrong>detects</DocStrong> an event and emits a signal, the{" "}
        <DocLink to="signal-architecture">SignalBus</DocLink> fans it out to
        each subscribed session as a queued delivery, the delivery gate checks
        it against the experience&apos;s capabilities, and the pipeline turns it
        into a trade or no-trade decision. What differs between experiences is
        the set of signals offered and which pipeline runs.
      </DocParagraph>

      <DocTable
        headers={["Experience", "Signal(s)", "Instruments", "Pipeline"]}
        rows={[
          [
            "EDGAR 8-K catalyst drift",
            <DocInlineCode>edgar_8k</DocInlineCode>,
            "US stocks",
            <DocLink to="edgar-pipeline">Catalyst → review → decision</DocLink>,
          ],
          [
            "Rules: Mean Reversion",
            <>
              <DocInlineCode>timer</DocInlineCode> — SPY · checks every 15m · OHLCV 1h, QQQ · checks every 15m · OHLCV 1h
            </>,
            "Stocks",
            "Deterministic mean reversion",
          ],
          [
            "Rules: Trend Following",
            <>
              <DocInlineCode>timer</DocInlineCode> — GC · checks every 4h · OHLCV 4h, CL · checks every 4h · OHLCV 4h
            </>,
            "Futures",
            "Deterministic SMA-crossover trend",
          ],
          [
            "Rules: Momentum Breakout",
            <>
              <DocInlineCode>timer</DocInlineCode> — BTC-USD · checks every 1h · OHLCV 4h
            </>,
            "Crypto",
            "Deterministic resistance breakout",
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
        The mean-reversion, trend-following, and momentum-breakout experiences
        are <DocStrong>rule-based</DocStrong>: a{" "}
        <DocLink to="timer-signals">timer source</DocLink> fires on a fixed
        cadence per symbol, and a deterministic engine computes the setup from
        OHLCV data with no LLM involvement. The signal is the timer tick; the
        &quot;edge&quot; is the rule math. Each experience offers multiple
        symbols as toggleable signals — enabling both SPY and QQQ in one session
        runs the same mean-reversion pipeline for each independently.
      </DocParagraph>
      <DocTable
        headers={["Experience", "Signals (toggleable)", "Engine"]}
        rows={[
          [
            "Rules: Mean Reversion",
            <>
              <DocInlineCode>SPY · checks every 15m · OHLCV 1h</DocInlineCode>
              <br />
              <DocInlineCode>QQQ · checks every 15m · OHLCV 1h</DocInlineCode>
            </>,
            "Deterministic mean reversion on liquid stocks.",
          ],
          [
            "Rules: Trend Following",
            <>
              <DocInlineCode>GC · checks every 4h · OHLCV 4h</DocInlineCode>
              <br />
              <DocInlineCode>CL · checks every 4h · OHLCV 4h</DocInlineCode>
            </>,
            "Deterministic SMA-crossover trend on commodity futures.",
          ],
          [
            "Rules: Momentum Breakout",
            <DocInlineCode>BTC-USD · checks every 1h · OHLCV 4h</DocInlineCode>,
            "Deterministic resistance-breakout on crypto. Disabled by default until the breakout engine is fully tested.",
          ],
        ]}
      />
      <DocParagraph>
        All three rules experiences ship with Manual Watchlist style, Moderate
        risk, and a Swing timeframe by default. Each signal carries its own{" "}
        <DocStrong>poll cadence</DocStrong> (how often the timer fires) and{" "}
        <DocStrong>analysis timeframe</DocStrong> (the bar horizon the rule
        reasons over) — these are distinct values and are both shown in the
        signal label above. Because setup is computed deterministically, rules
        experiences spend far less on AI than catalyst or prediction flows.
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
