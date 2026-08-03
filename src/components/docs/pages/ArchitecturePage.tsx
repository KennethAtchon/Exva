import {
  DocHeading,
  DocInlineCode,
  DocLink,
  DocMermaid,
  DocParagraph,
} from "../primitives";
import { SYSTEM_ARCHITECTURE_CHART } from "../diagrams";

export function ArchitecturePage() {
  return (
    <>
      <DocParagraph>
        Exva is a local desktop app. The renderer (React UI) talks to the main
        process over typed IPC. The main process owns session orchestration,
        signal polling, the AI pipeline, broker routing, and local SQLite
        persistence.
      </DocParagraph>
      <DocHeading id="system-overview" level={2}>
        System overview
      </DocHeading>
      <DocMermaid chart={SYSTEM_ARCHITECTURE_CHART} />
      <DocParagraph>
        Signal sources live under{" "}
        <DocInlineCode>electron/main/services/signals/</DocInlineCode>; the
        pipeline runtime under{" "}
        <DocInlineCode>electron/main/services/pipeline/</DocInlineCode>;
        experiences under{" "}
        <DocInlineCode>electron/main/experiences/</DocInlineCode>.
      </DocParagraph>
      <DocParagraph>
        For the signal path in detail, see{" "}
        <DocLink to="signal-architecture">Signal architecture</DocLink>. For AI
        phase execution, see{" "}
        <DocLink to="pipeline">Pipeline &amp; AI phases</DocLink>.
      </DocParagraph>
    </>
  );
}
