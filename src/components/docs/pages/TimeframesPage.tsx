import {
  DocCallout,
  DocHeading,
  DocInlineCode,
  DocLink,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function TimeframesPage() {
  return (
    <>
      <DocParagraph>
        <DocStrong>Timeframe</DocStrong> defines the expected holding horizon
        and the bar size the session analyzes on. It steers two things: the
        market data the AI phases receive, and how the runtime reasons about
        hold windows and exits. A catalyst session and a position session can
        run the same experience but behave very differently because of this
        section.
      </DocParagraph>

      <DocHeading id="fields" level={2}>
        Timeframe fields
      </DocHeading>
      <DocTable
        headers={["Field", "Values", "Meaning"]}
        rows={[
          [
            "Primary trading timeframe",
            <>
              <DocInlineCode>15m</DocInlineCode>,{" "}
              <DocInlineCode>30m</DocInlineCode>,{" "}
              <DocInlineCode>1h</DocInlineCode>,{" "}
              <DocInlineCode>4h</DocInlineCode>,{" "}
              <DocInlineCode>1d</DocInlineCode>,{" "}
              <DocInlineCode>1w</DocInlineCode>
            </>,
            "Bar size used for analysis and the chart context handed to the technical phase.",
          ],
          [
            "Holding style",
            <>
              <DocInlineCode>multi_day_swing</DocInlineCode>,{" "}
              <DocInlineCode>weeks_position</DocInlineCode>,{" "}
              <DocInlineCode>custom</DocInlineCode>
            </>,
            "Coarse intended hold length. Steers prompts and approval copy.",
          ],
          [
            "Target hold days",
            "number or empty",
            "The typical intended hold. Empty for resolution-driven holds.",
          ],
          [
            "Max hold days",
            "number or empty",
            "Upper bound passed to the order policy as part of the exit policy.",
          ],
          [
            "Timeframe notes",
            "free text",
            "Authority for any horizon assumption the presets don't capture.",
          ],
        ]}
      />

      <DocHeading id="presets" level={2}>
        Timeframe presets
      </DocHeading>
      <DocTable
        headers={["Preset", "Bars / hold", "Use"]}
        rows={[
          [
            "Catalyst",
            "1d bars · 2-day target, 5-day max",
            "Fast reaction window for EDGAR and event-driven catalysts.",
          ],
          [
            "Swing",
            "4h bars · 3–5 day target, 14-day max",
            "Multi-day structures that persist beyond intraday noise.",
          ],
          [
            "Position",
            "1d bars · 2–4 week hold (max ~60d)",
            "Longer holds where durable fundamentals carry more weight.",
          ],
          [
            "Prediction",
            "1d bars · hold to resolution",
            "No fixed time target — exit at event resolution or thesis invalidation.",
          ],
          [
            "Custom Timeframe",
            "set manually",
            "Explicit fields and notes are the authority; no preset horizon assumption.",
          ],
        ]}
      />

      <DocHeading id="effect" level={2}>
        How timeframe reaches the trade
      </DocHeading>
      <DocParagraph>
        Holding style and max-hold days flow into the order policy&apos;s exit
        policy alongside the <DocLink to="risk">Risk</DocLink> stop settings, so
        a position never sits open past its configured window. The presets also
        carry phase guidance — e.g. the Swing preset tells the{" "}
        <DocLink to="ai-phases">technical phase</DocLink> to prefer multi-day
        structures, while the Position preset tells the fundamental and decision
        phases to weight durable context and reject purely tactical setups.
      </DocParagraph>

      <DocCallout variant="info" title="Pairs with Style">
        Timeframe answers <em>how long</em>;{" "}
        <DocLink to="strategy-style">Style</DocLink> answers{" "}
        <em>what kind of evidence</em>. Catalyst style with a Position
        timeframe, for example, hunts catalysts but holds them for weeks.
      </DocCallout>
    </>
  );
}
