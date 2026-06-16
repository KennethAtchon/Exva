import {
  DocCallout,
  DocHeading,
  DocInlineCode,
  DocLink,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function StrategyRulesPage() {
  return (
    <>
      <DocParagraph>
        <DocStrong>Trade rules</DocStrong> are the hard mechanics the decision
        flow must obey: what setup to take, which direction, how to enter, how
        to exit, and how to scale. Where{" "}
        <DocLink to="strategy-style">Style</DocLink> biases reasoning, Rules
        constrain the actual trade shape. On save, the rule fields are compiled
        into a trade-rules markdown block that is injected into the AI prompts.
      </DocParagraph>

      <DocHeading id="fields" level={2}>
        Rule fields
      </DocHeading>
      <DocTable
        headers={["Field", "Values", "Meaning"]}
        rows={[
          [
            "Setup type",
            <>
              <DocInlineCode>catalyst_entry</DocInlineCode>,{" "}
              <DocInlineCode>event_entry</DocInlineCode>,{" "}
              <DocInlineCode>probability_edge</DocInlineCode>,{" "}
              <DocInlineCode>custom</DocInlineCode>
            </>,
            "The pattern the session is hunting for.",
          ],
          [
            "Side bias",
            <>
              <DocInlineCode>long_only</DocInlineCode>,{" "}
              <DocInlineCode>short_only</DocInlineCode>,{" "}
              <DocInlineCode>both</DocInlineCode>,{" "}
              <DocInlineCode>market_neutral</DocInlineCode>,{" "}
              <DocInlineCode>n_a</DocInlineCode>
            </>,
            "Allowed trade direction. Enforced by the runtime, not just suggested.",
          ],
          [
            "Entry style",
            <>
              <DocInlineCode>catalyst</DocInlineCode>,{" "}
              <DocInlineCode>event</DocInlineCode>,{" "}
              <DocInlineCode>probability_edge</DocInlineCode>
            </>,
            "What triggers the entry.",
          ],
          [
            "Exit style",
            <>
              <DocInlineCode>fixed_pct</DocInlineCode>,{" "}
              <DocInlineCode>trailing_atr</DocInlineCode>,{" "}
              <DocInlineCode>partial_exits</DocInlineCode>,{" "}
              <DocInlineCode>time_based</DocInlineCode>,{" "}
              <DocInlineCode>thesis_based</DocInlineCode>,{" "}
              <DocInlineCode>market_resolution</DocInlineCode>
            </>,
            "How the position is intended to be closed.",
          ],
          [
            "Scaling mode",
            <>
              <DocInlineCode>single_entry</DocInlineCode>,{" "}
              <DocInlineCode>scale_in_2</DocInlineCode>,{" "}
              <DocInlineCode>scale_in_3</DocInlineCode>,{" "}
              <DocInlineCode>scale_out_partial</DocInlineCode>
            </>,
            "Whether the position is taken at once or built/reduced in tranches.",
          ],
        ]}
      />

      <DocHeading id="presets" level={2}>
        Built-in rule presets
      </DocHeading>
      <DocTable
        headers={["Preset", "Setup / entry / exit"]}
        rows={[
          [
            "Catalyst Entry",
            "catalyst_entry · catalyst entry · thesis-based exit · single entry.",
          ],
          [
            "Event Entry",
            "event_entry · event entry · time-based exit · single entry.",
          ],
          [
            "Probability Edge",
            "probability_edge · probability-edge entry · market-resolution exit.",
          ],
          [
            "Custom Rules",
            "Define your own mechanics; use rule notes for setup-specific filters and invalidation.",
          ],
        ]}
      />

      <DocCallout variant="info" title="Exit style vs. stop loss type">
        Exit style here is the <em>intended</em> close mechanic the AI reasons
        with. The literal stop placement (fixed %, trailing ATR, broker-native,
        or none) lives on the{" "}
        <DocLink to="risk" heading="stops">
          Risk
        </DocLink>{" "}
        tab and is what the order policy actually enforces.
      </DocCallout>

      <DocParagraph>
        The free-text <DocStrong>rule notes</DocStrong> field carries
        setup-specific filters and invalidation conditions that do not map to a
        dropdown. It is folded into the compiled trade-rules markdown.
      </DocParagraph>
    </>
  );
}
