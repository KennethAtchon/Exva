import {
  DocHeading,
  DocInlineCode,
  DocLink,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function TradesDocPage() {
  return (
    <>
      <DocParagraph>
        The <DocStrong>Trades</DocStrong> page is the record of every position
        the system has opened, filtered by the current{" "}
        <DocLink to="environment">view scope</DocLink>. Each row drills into a
        trade detail view with the full execution and reasoning history, and a
        link to its <DocLink to="autopsy">autopsy</DocLink>.
      </DocParagraph>

      <DocHeading id="status" level={2}>
        Trade statuses
      </DocHeading>
      <DocTable
        headers={["Status", "Meaning"]}
        rows={[
          [
            <DocInlineCode>pending</DocInlineCode>,
            "Order accepted by the policy gate but not yet filled.",
          ],
          [
            <DocInlineCode>open</DocInlineCode>,
            "Filled and live; exits are being managed by the runtime.",
          ],
          [
            <DocInlineCode>closed</DocInlineCode>,
            "Position fully exited. Realized P&L is final.",
          ],
          [
            <DocInlineCode>cancelled</DocInlineCode>,
            "Order pulled before any fill.",
          ],
          [
            <DocInlineCode>failed</DocInlineCode>,
            "Execution error prevented the order from completing.",
          ],
          [
            <DocInlineCode>rejected</DocInlineCode>,
            "Blocked at submission (e.g. by a broker or policy check).",
          ],
        ]}
      />

      <DocHeading id="detail" level={2}>
        Trade detail
      </DocHeading>
      <DocParagraph>
        Opening a trade shows the entry/exit, the side ({" "}
        <DocInlineCode>BUY</DocInlineCode> / <DocInlineCode>SELL</DocInlineCode>
        , or <DocInlineCode>YES</DocInlineCode> /{" "}
        <DocInlineCode>NO</DocInlineCode> for prediction markets), the strategy
        snapshot it was placed under, and the research cycle that produced it.
        From here you can open the autopsy or inspect cost attribution.
      </DocParagraph>

      <DocHeading id="cost" level={2}>
        Cost attribution
      </DocHeading>
      <DocParagraph>
        Each trade carries the AI and data spend from the research cycles that
        led to it, when Exva can connect the run history to the outcome.
        Aggregate spend and per-trade cost live on the{" "}
        <DocLink to="cost-tracking">AI cost</DocLink> page.
      </DocParagraph>
    </>
  );
}
