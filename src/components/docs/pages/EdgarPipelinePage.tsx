import {
  DocHeading,
  DocInlineCode,
  DocLink,
  DocList,
  DocMermaid,
  DocParagraph,
} from "../primitives";
import { EDGAR_PIPELINE_CHART } from "../diagrams";

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
      <DocHeading id="pipeline-flow" level={2}>
        Pipeline flow
      </DocHeading>
      <DocMermaid chart={EDGAR_PIPELINE_CHART} />
      <DocHeading id="stages" level={2}>
        Stages
      </DocHeading>
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
