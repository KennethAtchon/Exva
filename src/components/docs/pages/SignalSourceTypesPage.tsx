import { DocLink, DocParagraph, DocTable } from "../primitives";

export function SignalSourceTypesPage() {
  return (
    <>
      <DocParagraph>
        Signal sources are global resources. Create them on the Signals page,
        enable them, then subscribe sessions during session creation or editing.
        Disabling a source keeps subscriptions intact but moves subscribed
        sessions to a waiting state. Rules experiences use{" "}
        <DocLink to="timer-signals">schedules</DocLink> (SessionScheduler), not
        a creatable timer source type.
      </DocParagraph>
      <DocTable
        headers={["Type", "Description", "Typical use"]}
        rows={[
          [
            "edgar_8k",
            <>
              Polls SEC Form 8-K Atom feed; resolves CIK to ticker. See{" "}
              <DocLink to="edgar-overview">EDGAR docs</DocLink>.
            </>,
            "EDGAR Catalyst experience.",
          ],
          [
            "manual",
            <>
              No automated feed; session runs from manual tickers only. See{" "}
              <DocLink to="mock-manual-sources">Mock &amp; manual</DocLink>.
            </>,
            "Operator-driven watchlists.",
          ],
          [
            "mock",
            <>
              Deterministic synthetic signals for rehearsal. See{" "}
              <DocLink to="mock-manual-sources">Mock &amp; manual</DocLink>.
            </>,
            "Development and scripted testing — not for live trading.",
          ],
          [
            "prediction_event",
            <>
              Polls prediction-market platforms for odds/volume dislocations.
              See <DocLink to="prediction-events">Prediction events</DocLink>.
            </>,
            <>
              <DocLink to="experiences">Prediction Event Edge</DocLink>{" "}
              experience.
            </>,
          ],
          [
            "timer",
            <>
              Deprecated DB identity for schedules — not a creatable source. See{" "}
              <DocLink to="timer-signals">Schedules (was timer)</DocLink>.
            </>,
            "Rules experiences via SessionScheduler.",
          ],
          [
            "web_search",
            "Deleted as a source — kept for DB compatibility only. Cannot be created or started.",
            "Removed from the product surface.",
          ],
        ]}
      />
    </>
  );
}
