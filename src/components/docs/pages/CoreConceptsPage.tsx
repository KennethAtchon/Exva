import { DocLink, DocParagraph, DocTable } from "../primitives";

export function CoreConceptsPage() {
  return (
    <>
      <DocParagraph>
        These terms appear throughout Exva — in the UI, runtime logs, and the
        rest of this documentation. Each links to deeper coverage where
        available.
      </DocParagraph>
      <DocTable
        headers={["Concept", "Definition"]}
        rows={[
          [
            "Experience",
            <>
              A trading theme that groups one or more toggleable signals under
              one pipeline. Sessions pick an experience and enable the signals
              they want. See <DocLink to="experiences">Experiences</DocLink>.
            </>,
          ],
          [
            "Session",
            <>
              A configured trading run — one experience, subscribed signal
              source(s), broker assignments, and strategy settings. See{" "}
              <DocLink to="sessions">Sessions</DocLink>.
            </>,
          ],
          [
            "Signal",
            <>
              An external event Exva can react to: an SEC filing, timer tick,
              prediction-market dislocation, or synthetic test event.
            </>,
          ],
          [
            "Signal source",
            <>
              A global feed that emits signals. Sessions subscribe to sources.
              See{" "}
              <DocLink to="signal-source-types">Signal source types</DocLink>.
            </>,
          ],
          [
            "Signal delivery",
            <>
              One signal enqueued for one session, tracked from queue through
              pipeline completion. See{" "}
              <DocLink to="signal-architecture">Signal architecture</DocLink>.
            </>,
          ],
          [
            "Pipeline",
            <>
              The ordered AI workflow that evaluates a signal after it reaches a
              session. See <DocLink to="pipeline">Pipeline</DocLink>.
            </>,
          ],
          [
            "Dead letter",
            <>
              A signal skipped before processing — usually due to experience,
              source, or broker incompatibility. Defined in the{" "}
              <DocLink to="glossary" heading="term-dead-letter">
                Glossary
              </DocLink>
              .
            </>,
          ],
        ]}
      />
    </>
  );
}
