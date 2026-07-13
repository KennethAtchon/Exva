import { DocLink, DocParagraph, DocTable } from "../primitives";

export function EdgarTradabilityPage() {
  return (
    <>
      <DocParagraph>
        After a signal passes detection and enters the{" "}
        <DocLink to="signal-architecture">delivery queue</DocLink>,
        deterministic tradability filters may reject illiquid or unsuitable
        instruments before AI analysis consumes budget. Implementation:{" "}
        <code className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-caption">
          electron/shared/instruments/edgar-tradability.ts
        </code>
        .
      </DocParagraph>
      <DocTable
        headers={["Filter", "Default threshold"]}
        rows={[
          ["Minimum price", "$5.00 USD"],
          ["Minimum dollar volume", "$500,000 (price × volume)"],
          ["Maximum spread", "0.5%"],
          ["Market cap buckets", "Mega, large, mid, and small cap allowed"],
        ]}
      />
      <DocParagraph>
        Instruments that fail tradability checks are rejected during the
        pipeline rather than at signal detection. Pair this with{" "}
        <DocLink to="edgar-pipeline">pipeline stage</DocLink> documentation to
        understand the full evaluation path.
      </DocParagraph>
    </>
  );
}
