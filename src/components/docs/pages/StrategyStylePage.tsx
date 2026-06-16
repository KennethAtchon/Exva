import {
  DocHeading,
  DocInlineCode,
  DocLink,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function StrategyStylePage() {
  return (
    <>
      <DocParagraph>
        <DocStrong>Style</DocStrong> (stored as the session research posture)
        sets the high-level character of research: how the session treats
        signals, what kind of evidence it trusts, whether a catalyst is
        required, and how hard it checks fundamentals. Style does not place
        trades — it biases every AI phase toward the right kind of reasoning.
        For literal, non-negotiable constraints use{" "}
        <DocLink to="strategy-rules">Trade rules</DocLink> instead.
      </DocParagraph>

      <DocHeading id="fields" level={2}>
        Posture fields
      </DocHeading>
      <DocTable
        headers={["Field", "Values", "Meaning"]}
        rows={[
          [
            "Processing mode",
            <>
              <DocInlineCode>catalyst</DocInlineCode>,{" "}
              <DocInlineCode>contract</DocInlineCode>,{" "}
              <DocInlineCode>manual</DocInlineCode>
            </>,
            "How signals are interpreted: react to a catalyst, price an event contract, or run from operator-driven tickers.",
          ],
          [
            "Evidence mode",
            <>
              <DocInlineCode>document_first</DocInlineCode>,{" "}
              <DocInlineCode>probability_edge</DocInlineCode>,{" "}
              <DocInlineCode>balanced</DocInlineCode>
            </>,
            "Which evidence dominates the thesis: the source filing/document, a probability mispricing, or a blend.",
          ],
          [
            "Catalyst mode",
            <>
              <DocInlineCode>required</DocInlineCode>,{" "}
              <DocInlineCode>preferred</DocInlineCode>,{" "}
              <DocInlineCode>not_required</DocInlineCode>
            </>,
            "Whether a fresh catalyst must exist before a trade is allowed.",
          ],
          [
            "Fundamental strictness",
            <>
              <DocInlineCode>sanity_check</DocInlineCode>,{" "}
              <DocInlineCode>balanced</DocInlineCode>,{" "}
              <DocInlineCode>deep_confirmation</DocInlineCode>,{" "}
              <DocInlineCode>not_applicable</DocInlineCode>
            </>,
            "How much fundamental confirmation the fundamental phase demands before it signs off.",
          ],
        ]}
      />

      <DocHeading id="presets" level={2}>
        Built-in style presets
      </DocHeading>
      <DocTable
        headers={["Preset", "Thesis"]}
        rows={[
          [
            "EDGAR Catalyst",
            "Trade EDGAR catalysts document-first: catalyst processing, document evidence, catalyst required, balanced fundamentals.",
          ],
          [
            "Earnings Event",
            "Earnings-linked catalysts with balanced evidence and a fundamentals sanity check.",
          ],
          [
            "Prediction Event Edge",
            "Contract processing, probability-edge evidence; fundamentals not applicable.",
          ],
          [
            "Manual Watchlist",
            "Operator-driven tickers, balanced evidence, catalysts preferred not required.",
          ],
          [
            "Custom Style",
            "No preset assumptions — set processing/evidence/catalyst/fundamentals yourself; use posture notes for workflow context.",
          ],
        ]}
      />

      <DocHeading id="notes" level={2}>
        Posture notes vs. worker instructions
      </DocHeading>
      <DocParagraph>
        Style carries a free-text <DocStrong>posture notes</DocStrong> field for
        workflow-specific context. That is distinct from{" "}
        <DocLink to="ai-phases" heading="guidance">
          worker guidance
        </DocLink>{" "}
        on the AI tab: posture notes color the research style, while worker
        guidance is hard guidance injected verbatim into every AI phase.
      </DocParagraph>
    </>
  );
}
