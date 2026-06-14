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
            "Emits on a fixed cadence for a configured symbol.",
            "Rules-based strategies (mean reversion, momentum, trend).",
          ],
          [
            "web_search",
            "Legacy web-search discovery wrapper.",
            "Backward-compatible discovery; lower edge than catalyst feeds.",
          ],
          [
            "manual",
            "No automated feed; session runs from manual tickers only.",
            "Operator-driven watchlists.",
          ],
          [
            "mock",
            "Deterministic synthetic signals for rehearsal.",
            "Development and scripted testing — not for live trading.",
          ],
          [
            "prediction_event",
            "Polls prediction-market platforms for odds/volume dislocations.",
            <>
              <DocLink to="experiences">Prediction Event Edge</DocLink>{" "}
              experience.
            </>,
          ],
        ]}
      />
    </>
  );
}
