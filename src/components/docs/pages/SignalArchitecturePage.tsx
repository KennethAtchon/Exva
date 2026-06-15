import {
  DocHeading,
  DocLink,
  DocMermaid,
  DocParagraph,
  DocTable,
  FlowStep,
  DocInlineCode,
} from "../primitives";
import { SIGNAL_END_TO_END_CHART } from "../diagrams";

export function SignalArchitecturePage() {
  return (
    <>
      <DocParagraph>
        Exva uses a signal-driven model: the pipeline does not actively hunt for
        instruments via web search in catalyst experiences. Independent signal
        sources identify candidates and push structured events into a central
        bus.
      </DocParagraph>

      <DocHeading id="end-to-end-flow" level={2}>
        End-to-end flow
      </DocHeading>
      <DocMermaid chart={SIGNAL_END_TO_END_CHART} />
      <FlowStep step={1} title="Detection">
        A running signal source polls or listens for events. See{" "}
        <DocLink to="edgar-detection">EDGAR detection</DocLink> or{" "}
        <DocLink to="signal-source-types">source types</DocLink>.
      </FlowStep>
      <FlowStep step={2} title="Normalization">
        Raw events become <DocInlineCode>SignalEvent</DocInlineCode> records
        with ticker, document URL, accession number, instrument class, and
        metadata JSON.
      </FlowStep>
      <FlowStep step={3} title="Persistence">
        Events are stored in SQLite. The SignalBus notifies subscribed sessions.
      </FlowStep>
      <FlowStep step={4} title="Delivery gate">
        Before enqueueing, Exva checks experience compatibility, instrument
        class support, signal-source emission rules, and broker routing.
        Failures become dead letters with a reason code.
      </FlowStep>
      <FlowStep step={5} title="Session queue">
        Valid deliveries enter a per-session FIFO queue. Paused sessions hold
        deliveries with a 4-hour expiry TTL.
      </FlowStep>
      <FlowStep step={6} title="Pipeline trigger">
        When the session is active, the orchestrator dequeues the next delivery
        and runs the experience&apos;s pipeline for that instrument.
      </FlowStep>
      <FlowStep step={7} title="Terminal status">
        Deliveries complete as traded, rejected, dropped, or expired. Status
        appears in the session detail drawer signal log.
      </FlowStep>

      <DocHeading id="source-readiness" level={2}>
        Source readiness states
      </DocHeading>
      <DocTable
        headers={["State", "Meaning"]}
        rows={[
          [
            "Armed",
            "Session has live inputs and can process signals immediately (enabled subscribed source).",
          ],
          [
            "Manual only",
            "Manual tickers configured but no enabled automated source.",
          ],
          [
            "Waiting for source enable",
            "Subscribed to a source that is currently disabled.",
          ],
          [
            "No live inputs",
            "Neither manual tickers nor an enabled subscribed source.",
          ],
        ]}
      />
      <DocParagraph>
        Delivery status codes are documented under{" "}
        <DocLink to="sessions" heading="delivery-statuses">
          Sessions
        </DocLink>
        .
      </DocParagraph>
    </>
  );
}
