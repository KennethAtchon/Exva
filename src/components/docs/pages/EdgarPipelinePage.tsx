import { DocInlineCode, DocLink, DocList, DocParagraph } from "../primitives";

export function EdgarPipelinePage() {
  return (
    <>
      <DocParagraph>
        Signals from EDGAR route to the{" "}
        <DocInlineCode>edgar-8k-cycle</DocInlineCode> pipeline — a
        catalyst-focused analysis path distinct from the generic default trade
        cycle. It is bound to the{" "}
        <DocLink to="experiences">EDGAR Catalyst experience</DocLink>.
      </DocParagraph>
      <DocList
        items={[
          <>
            <strong>Catalyst analysis</strong> (fundamental phase) — AI reads
            filing context and assesses materiality, direction, and trade
            thesis.
          </>,
          <>
            <strong>Adversarial review</strong> (review phase) — A second AI
            pass challenges the thesis and surfaces rejection reasons.
          </>,
          <>
            <strong>Catalyst decision</strong> — Deterministic policy engine
            aggregates analyst and reviewer outputs into a trade or skip
            decision.
          </>,
          <>
            <strong>Risk gate chain</strong> — Execution profile, risk limits,
            and broker allocation engines run before any order is placed.
          </>,
        ]}
      />
      <DocParagraph>
        For general phase definitions and worker tools, see{" "}
        <DocLink to="pipeline">Pipeline &amp; AI phases</DocLink>. Pre-pipeline
        liquidity checks are covered in{" "}
        <DocLink to="edgar-tradability">Tradability</DocLink>.
      </DocParagraph>
    </>
  );
}
