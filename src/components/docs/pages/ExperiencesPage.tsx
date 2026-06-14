import { DocInlineCode, DocLink, DocParagraph, DocTable } from "../primitives";

export function ExperiencesPage() {
  return (
    <>
      <DocParagraph>
        An experience bundles everything a session needs except runtime state.
        When you create a session, you pick an experience; Exva provisions the
        matching signal source type and pipeline automatically.
      </DocParagraph>
      <DocTable
        headers={["Experience", "Signal", "Instruments", "Pipeline focus"]}
        rows={[
          [
            "EDGAR 8-K catalyst drift",
            "edgar_8k, mock",
            "US stocks",
            <>
              <DocLink to="edgar-pipeline">
                Catalyst analysis → review → decision
              </DocLink>
            </>,
          ],
          [
            "SPY 15m mean reversion (rules)",
            "timer (SPY, 15m)",
            "Stocks",
            "Rule-based mean reversion",
          ],
          [
            "QQQ 15m mean reversion (rules)",
            "timer (QQQ, 15m)",
            "Stocks",
            "Rule-based mean reversion",
          ],
          [
            "BTC-USD 1h momentum breakout (rules)",
            "timer (BTC-USD, 1h)",
            "Crypto",
            "Rule-based momentum",
          ],
          [
            "GC/CL 4h trend following (rules)",
            "timer (GC, 4h)",
            "Futures",
            "Rule-based trend following",
          ],
          [
            "Prediction event edge",
            "prediction_event",
            "Prediction markets",
            "Event-driven probability edge",
          ],
        ]}
      />
      <DocParagraph>
        Each experience declares <DocInlineCode>capabilities</DocInlineCode>:
        supported instrument classes, compatible{" "}
        <DocLink to="signal-source-types">signal source types</DocLink>, and
        broker requirements. The{" "}
        <DocLink to="signal-architecture">delivery gate</DocLink> uses these
        declarations to reject incompatible signals before they consume pipeline
        budget.
      </DocParagraph>
    </>
  );
}
