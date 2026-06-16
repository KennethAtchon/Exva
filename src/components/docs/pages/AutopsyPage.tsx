import {
  DocCallout,
  DocHeading,
  DocInlineCode,
  DocLink,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function AutopsyPage() {
  return (
    <>
      <DocParagraph>
        <DocStrong>Autopsy</DocStrong> is Exva&apos;s post-trade intelligence
        engine. It turns trade records and the full AI reasoning chain behind
        them into structured reviews, then tracks whether the lessons it
        surfaces actually get fixed over time. The goal is not &quot;why did
        this one trade lose&quot; but &quot;is the system getting better.&quot;
        There are two levels: <DocStrong>period autopsy</DocStrong> (primary)
        and <DocStrong>trade review</DocStrong> (per-trade).
      </DocParagraph>

      <DocHeading id="period" level={2}>
        Period autopsy
      </DocHeading>
      <DocParagraph>
        A period autopsy analyzes a window of trades and runs a multi-phase LLM
        pipeline over them. It can run at one of two{" "}
        <DocStrong>scopes</DocStrong>:
      </DocParagraph>
      <DocTable
        headers={["Scope", "Covers"]}
        rows={[
          [
            <DocInlineCode>global</DocInlineCode>,
            "All trades in the environment over the selected window.",
          ],
          [
            <DocInlineCode>session</DocInlineCode>,
            "Trades from one focused session only.",
          ],
        ]}
      />
      <DocParagraph>
        The pipeline produces structured analysis across phases — thesis,
        execution, behavioral, market context, pattern analysis, lesson
        validation, and synthesis — and a quality grade.
      </DocParagraph>

      <DocHeading id="lessons" level={2}>
        Lessons
      </DocHeading>
      <DocParagraph>
        Each autopsy can emit <DocStrong>lessons</DocStrong>: durable findings
        with a severity, category, and lifecycle status. Subsequent autopsies
        re-check open lessons (&quot;was this fixed?&quot;) and mark them as
        validated or recurring.
      </DocParagraph>
      <DocTable
        headers={["Attribute", "Values"]}
        rows={[
          [
            "Status",
            <>
              <DocInlineCode>pending</DocInlineCode>,{" "}
              <DocInlineCode>implemented</DocInlineCode>,{" "}
              <DocInlineCode>validated</DocInlineCode>,{" "}
              <DocInlineCode>recurring</DocInlineCode>,{" "}
              <DocInlineCode>dismissed</DocInlineCode>
            </>,
          ],
          [
            "Severity",
            <>
              <DocInlineCode>low</DocInlineCode>,{" "}
              <DocInlineCode>medium</DocInlineCode>,{" "}
              <DocInlineCode>high</DocInlineCode>,{" "}
              <DocInlineCode>critical</DocInlineCode>
            </>,
          ],
          [
            "Category",
            <>
              <DocInlineCode>strategy</DocInlineCode>,{" "}
              <DocInlineCode>execution</DocInlineCode>,{" "}
              <DocInlineCode>behavioral</DocInlineCode>,{" "}
              <DocInlineCode>risk</DocInlineCode>,{" "}
              <DocInlineCode>system</DocInlineCode>
            </>,
          ],
          [
            "Source",
            <>
              <DocInlineCode>trade</DocInlineCode>,{" "}
              <DocInlineCode>period</DocInlineCode>,{" "}
              <DocInlineCode>manual</DocInlineCode>
            </>,
          ],
        ]}
      />

      <DocHeading id="andon" level={2}>
        Andon Cord
      </DocHeading>
      <DocParagraph>
        The <DocStrong>Andon Cord</DocStrong> is a threshold-based escalation: a
        period autopsy assesses whether recurring failures have gone unresolved
        long enough to demand operator intervention. When it fires, the app
        surfaces a toast plus a persistent banner so a systemic problem
        can&apos;t be quietly ignored. It is a period-autopsy mechanism only.
      </DocParagraph>

      <DocHeading id="trade-review" level={2}>
        Trade review
      </DocHeading>
      <DocParagraph>
        From any closed trade you can open an AI-generated{" "}
        <DocLink to="trades">trade</DocLink> review covering what the AI
        reasoned, what worked, and what failed — with the full raw prompt/
        response chain available for audit. Trade-level findings can be promoted
        into tracked lessons manually.
      </DocParagraph>

      <DocCallout variant="tip" title="Export">
        Autopsies export as Markdown, JSON, or PDF for sharing or archiving.
      </DocCallout>
    </>
  );
}
