import {
  DocCallout,
  DocHeading,
  DocInlineCode,
  DocLink,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function LeaderboardDocPage() {
  return (
    <>
      <DocParagraph>
        The <DocStrong>Leaderboard</DocStrong> scores{" "}
        <DocLink to="experiences">experiences</DocLink> against each other and
        tracks how far each has earned its way up the promotion ladder. It turns
        scattered session results into a per-experience scorecard so you can see
        which setups are ready for more capital and which are still proving
        themselves.
      </DocParagraph>

      <DocHeading id="promotion" level={2}>
        Promotion ladder
      </DocHeading>
      <DocParagraph>
        Every experience advances through a hard, ordered ladder. A
        session&apos;s tier is derived from its execution mode and rehearsal
        state.
      </DocParagraph>
      <DocTable
        headers={["Tier", "Meaning"]}
        rows={[
          [
            <DocInlineCode>scripted</DocInlineCode>,
            "Deterministic scripted execution — development and rehearsal scaffolding.",
          ],
          [
            <DocInlineCode>rehearsal</DocInlineCode>,
            "Rehearsal execution against synthetic signals.",
          ],
          [
            <DocInlineCode>paper</DocInlineCode>,
            "Simulated execution in the paper environment, no real orders.",
          ],
          [
            <DocInlineCode>live</DocInlineCode>,
            "Production execution with live broker connectivity.",
          ],
        ]}
      />

      <DocHeading id="metrics" level={2}>
        Scorecard metrics
      </DocHeading>
      <DocTable
        headers={["Metric", "Definition"]}
        rows={[
          ["Expectancy", "Average profit or loss per trade after costs."],
          [
            "Max drawdown",
            "Largest peak-to-trough loss over the measured equity curve.",
          ],
          [
            "Cost per trade",
            "Average model spend attributed to each closed trade.",
          ],
          [
            "Out of sample",
            "Performance measured on data held back from any fitting or tuning period.",
          ],
        ]}
      />

      <DocCallout variant="tip" title="Why a ladder">
        The ladder forces an experience to demonstrate edge in cheaper, safer
        tiers before it can touch real capital — readiness is earned, not
        toggled.
      </DocCallout>
    </>
  );
}
