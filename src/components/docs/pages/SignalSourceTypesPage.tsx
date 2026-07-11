import { DocLink, DocParagraph, DocTable } from "../primitives";

export function SignalSourceTypesPage() {
  return (
    <>
      <DocParagraph>
        Signal sources are global resources. Create them on the Signals page,
        enable them, then subscribe sessions during session creation or editing.
        Disabling a source keeps subscriptions intact but moves subscribed
        sessions to a waiting state.
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
            "timer",
            <>
              Emits on a fixed cadence for a configured symbol. See{" "}
              <DocLink to="timer-signals">Timer signals</DocLink>.
            </>,
            "Rules-based strategies (mean reversion, momentum, trend).",
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
            "web_search",
            "Deprecated — kept for DB compatibility only. Cannot be created or started; use edgar_8k, timer, or prediction_event instead.",
            "Removed from the product surface.",
          ],
        ]}
      />
    </>
  );
}
