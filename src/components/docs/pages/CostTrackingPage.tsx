import {
  DocCallout,
  DocHeading,
  DocLink,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function CostTrackingPage() {
  return (
    <>
      <DocParagraph>
        The <DocStrong>Costs</DocStrong> tab in Research tracks what the AI
        pipeline costs to run. Model and data spend is metered as phases
        execute, capped by the budgets on the <DocLink to="risk">Risk</DocLink>{" "}
        tab, and attributed back to phases and trades so you can see where money
        goes.
      </DocParagraph>

      <DocHeading id="budgets" level={2}>
        Budgets & caps
      </DocHeading>
      <DocParagraph>
        Each session has a daily AI spend cap and a data spend cap. Reaching the
        AI budget trips the{" "}
        <DocLink to="risk" heading="gate-types">
          api_budget
        </DocLink>{" "}
        gate and halts new research for the day — existing positions are still
        managed. Spend is also tracked at workspace scope for the whole
        environment.
      </DocParagraph>

      <DocHeading id="breakdown" level={2}>
        Breakdown views
      </DocHeading>
      <DocTable
        headers={["View", "What it shows"]}
        rows={[
          [
            "Cost by agent",
            "Model spend split by pipeline phase, so you can see where cost concentrates.",
          ],
          [
            "Cost per trade attribution",
            "Relevant model spend rolled back onto individual trades when run history links to an outcome.",
          ],
          [
            "Cache savings",
            "How much prompt caching reduced spend versus sending the full prompt every time.",
          ],
          [
            "Net P&L after costs",
            "Trading results with AI and data fees subtracted.",
          ],
          [
            "Projections",
            "Extrapolation from current spend and trade pace — planning signals, not guarantees.",
          ],
        ]}
      />

      <DocCallout variant="info" title="Where spend originates">
        Cost is produced by the <DocLink to="ai-phases">AI phases</DocLink>:
        model choice, reasoning level, and max tokens per phase are the main
        levers. Cheaper models on early phases plus caching are the usual way to
        cut spend.
      </DocCallout>
    </>
  );
}
