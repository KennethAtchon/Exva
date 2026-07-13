import { DocLink, GlossaryTerm } from "../primitives";

export function GlossaryPage() {
  return (
    <dl>
      <GlossaryTerm
        id="term-accession"
        term="Accession number"
        definition="SEC unique identifier for a filing, used for deduplication and document retrieval."
        related={
          <>
            <DocLink to="edgar-detection">EDGAR detection</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-cik"
        term="CIK"
        definition="Central Index Key — SEC numeric identifier for a filer, resolved to a trading ticker during EDGAR signal detection."
        related={
          <>
            <DocLink to="edgar-detection">EDGAR detection</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-catalyst"
        term="Catalyst"
        definition="A specific, verifiable corporate event (filing, announcement) that may move a stock before the market fully prices it in."
        related={
          <>
            <DocLink to="edgar-overview">EDGAR overview</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-dead-letter"
        term="Dead letter"
        definition="A signal the session skipped because it could not act on it — usually source, instrument, or broker mismatch."
        related={
          <>
            <DocLink to="signal-architecture">Signal architecture</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-experience"
        term="Experience"
        definition="A general trading theme that groups one or more toggleable signals, one pipeline, capability constraints, and default presets. Sessions pick an experience and enable the signals they want; all enabled signals route to the same pipeline."
        related={
          <>
            <DocLink to="experiences">Experiences</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-instrument-class"
        term="Instrument class"
        definition="Asset type a session or broker supports: stock, crypto, futures, options, or prediction market."
        related={
          <>
            <DocLink to="experiences">Experiences</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-broker-account"
        term="Broker account"
        definition="A Keychain-backed connection that routes orders. Launch-capable adapters: Alpaca, Kalshi (demo/prod), Tradier (sandbox/prod), Kraken (validate-only paper), Polymarket, Coinbase, Tradovate, Mock. IBKR and Schwab are not supported."
        related={
          <>
            <DocLink to="accounts-brokers">Accounts & brokers</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-ghost-fill"
        term="Ghost fill"
        definition="Paper-mode simulated fill used when a venue has no sandbox (Kraken validate-only; Polymarket paper). Shares GhostFillSimulator across adapters. Market orders fill at mid; limits rest until marketable against live quotes. Persisted via paper_balances; Settings → Brokers can reset."
        related={
          <>
            <DocLink to="accounts-brokers">Accounts & brokers</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-signalbus"
        term="SignalBus"
        definition="Central main-process component that receives events from sources and routes them to subscribed sessions."
        related={
          <>
            <DocLink to="architecture">System architecture</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-tradability"
        term="Tradability"
        definition="Deterministic liquidity and quality filters applied before AI analysis on EDGAR candidates."
        related={
          <>
            <DocLink to="edgar-tradability">EDGAR tradability</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-hub"
        term="Hub"
        definition="One of five primary operator surfaces: Dashboard, Sessions, Signals & Schedules, Research, and Settings. Docs stays standalone; trade detail remains a drill-in overlay."
        related={
          <>
            <DocLink to="app-pages">App pages</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-command-palette"
        term="Command palette"
        definition="⌘K fuzzy actions and entity search. Destructive actions confirm with a second Enter. Assistant is a palette action."
        related={
          <>
            <DocLink to="app-pages">App pages</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-backtest-lab"
        term="Backtest Lab"
        definition="Research hub runner for deterministic strategies: run, compare, and threshold-sweep with every sweep trial recorded in experience_experiments."
      />
      <GlossaryTerm
        id="term-data-doctor"
        term="Data Doctor"
        definition="Signals hub coverage matrix with gap detection, backfill, and provider health. Nightly gap checks notify on holes."
      />
      <GlossaryTerm
        id="term-morning-briefing"
        term="Morning briefing"
        definition="Nightly operator digest persisted as briefings and delivered via notification sinks; shown on the Dashboard."
      />
      <GlossaryTerm
        id="term-kill-switch"
        term="Kill switch panel"
        definition="Dashboard emergency controls: pause-all, per-session kill, risk gauges, and flatten-everything (type FLATTEN)."
      />
    </dl>
  );
}
