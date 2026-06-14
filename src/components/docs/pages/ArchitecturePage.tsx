import { DocCode, DocInlineCode, DocLink, DocParagraph } from "../primitives";

export function ArchitecturePage() {
  return (
    <>
      <DocParagraph>
        Exva runs as an Electron desktop app. The renderer (React UI) talks to
        the main process over typed IPC. The main process owns session
        orchestration, signal polling, the AI pipeline, broker routing, and
        local SQLite persistence.
      </DocParagraph>
      <DocCode>{`Signal Source → SignalBus → Session Queue → Pipeline → Decision → Broker

┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  EDGAR / Timer  │────▶│  SignalBus   │────▶│ Session delivery │
│  Mock / etc.    │     │  + SQLite    │     │ queue (FIFO)     │
└─────────────────┘     └──────────────┘     └────────┬────────┘
                                                      │
                                                      ▼
                                            ┌─────────────────┐
                                            │ AgentOrchestrator│
                                            │ → PipelineRuntime│
                                            │ → LLM phases     │
                                            └────────┬────────┘
                                                      │
                                                      ▼
                                            ┌─────────────────┐
                                            │ Risk gate +     │
                                            │ broker routing  │
                                            └─────────────────┘`}</DocCode>
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
