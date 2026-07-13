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
        Under <DocStrong>Settings</DocStrong>, two tabs back every session.{" "}
        <DocStrong>Accounts</DocStrong> holds workspace-level credentials and
        the environment toggle; <DocStrong>Brokers</DocStrong> holds the broker
        accounts that actually route orders and the capital allocated to them.
      </DocParagraph>

      <DocHeading id="accounts" level={2}>
        Accounts
      </DocHeading>
      <DocParagraph>
        The Accounts tab under Settings is where AI provider keys and search
        providers are configured, and where the workspace switches between{" "}
        <DocLink to="environment">paper and live</DocLink> environments. A
        session that uses a web-evidence posture needs a search provider here
        (or a per-session override) before its strategy will validate.
      </DocParagraph>
      <DocParagraph>
        The <DocStrong>Ops & notifications</DocStrong> card on Accounts covers
        database backups (last backup time + Backup now), Telegram bot secrets,
        digest hour, and sink test buttons (ntfy / Telegram / SMTP webhook). The
        Dev Panel footer also shows last-backup time and one-click{" "}
        <DocStrong>trigger test alarm</DocStrong> buttons for every supervisor
        alarm kind.
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
        headers={["Broker", "Classes", "Paper story"]}
        rows={[
          [
            "Alpaca",
            "stock, crypto, options",
            "Paper API + websocket trade_updates (poll fallback)",
          ],
          [
            "Kalshi",
            "prediction_market",
            "demo.kalshi.co RSA keys; Create Order V2",
          ],
          [
            "Tradier",
            "stock, options (+ verticals)",
            "sandbox.tradier.com bearer token",
          ],
          [
            "Kraken",
            "crypto",
            "No sandbox — validate-only + GhostFillSimulator; persisted paper_balances",
          ],
          [
            "Polymarket",
            "prediction_market",
            "CLOB live; paper ghost fills via GhostFillSimulator + paper_balances + gamma resolution settle",
          ],
          [
            "Coinbase / Tradovate / Mock",
            "crypto / futures / all",
            "As labeled",
          ],
        ]}
      />
      <DocParagraph>
        Interactive Brokers and Schwab are <DocStrong>not</DocStrong> supported
        and are not on the roadmap — Alpaca + Tradier cover equities/options;
        Kalshi covers US event contracts.
      </DocParagraph>
      <DocTable
        headers={["Concept", "Meaning"]}
        rows={[
          [
            "Supported classes",
            "Instrument classes a broker can route — stock, crypto, futures, options, prediction market.",
          ],
          [
            "Allocation",
            "Allocated capital is what a session may use from a broker; free capital is what the broker currently has available.",
          ],
          [
            "Broker health",
            "Healthy means recent balance data is available. Stale or over-allocated badges mean it needs attention before sessions rely on it.",
          ],
          [
            "Test connection",
            "Runs the adapter auth check (same path as cert:broker auth) before save.",
          ],
          [
            "Paper balance (ghost venues)",
            "Polymarket and Kraken paper accounts keep a persisted paper_balances row. Brokers → Reset paper balance restores the starting USDC; insufficient funds reject with BROKER_INSUFFICIENT_FUNDS.",
          ],
          [
            "Ghost resting limits",
            "Paper limit orders rest until the real mid crosses them (poll cadence). Not a full book match — fills can be optimistic vs queue priority.",
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
