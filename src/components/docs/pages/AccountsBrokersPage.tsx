import {
  DocCallout,
  DocHeading,
  DocLink,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function AccountsBrokersPage() {
  return (
    <>
      <DocParagraph>
        Two setup pages back every session. <DocStrong>Accounts</DocStrong>{" "}
        holds workspace-level credentials and the environment toggle;{" "}
        <DocStrong>Brokers</DocStrong> holds the broker accounts that actually
        route orders and the capital allocated to them.
      </DocParagraph>

      <DocHeading id="accounts" level={2}>
        Accounts
      </DocHeading>
      <DocParagraph>
        The Accounts page is where AI provider keys and search providers are
        configured, and where the workspace switches between{" "}
        <DocLink to="environment">paper and live</DocLink> environments. A
        session that uses a web-evidence posture needs a search provider here
        (or a per-session override) before its strategy will validate.
      </DocParagraph>

      <DocHeading id="brokers" level={2}>
        Brokers
      </DocHeading>
      <DocParagraph>
        A <DocStrong>broker account</DocStrong> is a connection orders route
        through. Sessions are assigned one or more brokers, and a session is
        only <DocStrong>launchable</DocStrong> when its assigned brokers cover
        at least one instrument class its experience supports.
      </DocParagraph>
      <DocTable
        headers={["Concept", "Meaning"]}
        rows={[
          [
            "Supported classes",
            "Instrument classes a broker can route — stock, crypto, futures, prediction market.",
          ],
          [
            "Allocation",
            "Allocated capital is what a session may use from a broker; free capital is what the broker currently has available.",
          ],
          [
            "Broker health",
            "Healthy means recent balance data is available. Stale or over-allocated badges mean it needs attention before sessions rely on it.",
          ],
        ]}
      />

      <DocCallout variant="warning" title="Routing gates trades">
        If no assigned broker can trade a signal&apos;s instrument class, the
        signal becomes a <DocLink to="core-concepts">dead letter</DocLink>{" "}
        rather than a trade. Broker coverage is part of the live{" "}
        <DocLink to="environment">readiness</DocLink> checks.
      </DocCallout>
    </>
  );
}
