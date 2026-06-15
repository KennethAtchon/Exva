import {
  DocHeading,
  DocLink,
  DocMermaid,
  DocParagraph,
  DocTable,
} from "../primitives";
import { PIPELINE_RUNTIME_CHART } from "../diagrams";

export function PipelinePage() {
  return (
    <>
      <DocParagraph>
        The pipeline runtime turns a session plus an instrument into AI analysis
        output. Phases are definition-first: each phase declares worker batches,
        tools, and aggregation engines registered at boot.
      </DocParagraph>
      <DocHeading id="execution-flow" level={2}>
        Execution flow
      </DocHeading>
      <DocMermaid chart={PIPELINE_RUNTIME_CHART} />
      <DocHeading id="ai-phases" level={2}>
        AI phases
      </DocHeading>
      <DocTable
        headers={["Phase", "Role"]}
        rows={[
          [
            "Selector / Universe",
            "Finds and narrows candidate instruments (discovery-style flows).",
          ],
          [
            "Technical",
            "Examines price action, levels, momentum, and chart context.",
          ],
          [
            "Fundamental",
            "Examines catalyst details, company context, and filing evidence.",
          ],
          [
            "Review",
            "Challenges the thesis and looks for reasons to reject weak setups.",
          ],
          [
            "Decision",
            "Turns research output into a concrete trade or no-trade decision.",
          ],
        ]}
      />
      <DocParagraph>
        Catalyst pipelines (<DocLink to="edgar-pipeline">EDGAR</DocLink>) skip
        traditional chart-pattern discovery and focus on filing materiality plus
        price reaction. Rule-based experiences use deterministic engines with
        minimal or no LLM involvement.
      </DocParagraph>
      <DocParagraph>
        AI spend is tracked per phase with session and daily caps enforced by
        the spend tracker. Worker tools include web search, URL fetch (for
        filings), market quotes, OHLCV data, and structured result submission.
      </DocParagraph>
    </>
  );
}
