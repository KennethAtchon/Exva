import { DocCallout, DocLink, DocList, DocParagraph } from "../primitives";

export function EnvironmentPage() {
  return (
    <>
      <DocParagraph>
        The workspace operates in one of two environment modes, toggled from the
        Accounts page:
      </DocParagraph>
      <DocList
        items={[
          <>
            <strong>Paper</strong> — Simulated execution. No real broker orders
            are sent regardless of session settings.
          </>,
          <>
            <strong>Live</strong> — Real broker accounts. Sessions must also
            have live execution enabled and pass readiness checks before placing
            live orders.
          </>,
        ]}
      />
      <DocParagraph>
        View modes complement environment: <strong>Global view</strong>{" "}
        aggregates data across non-archived sessions in the current environment;{" "}
        <strong>Focused session view</strong> scopes pages to one session
        selected in the header.
      </DocParagraph>
      <DocCallout variant="warning" title="Live readiness">
        Starting a live-allowed session in Live mode opens a readiness modal
        listing preflight checks (broker connectivity, risk configuration,
        acknowledgment). All checks must pass and be acknowledged before the
        session starts. See <DocLink to="sessions">Sessions</DocLink> for
        lifecycle controls.
      </DocCallout>
    </>
  );
}
