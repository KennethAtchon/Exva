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
        definition="Packaged trading setup combining signal source type, pipeline, presets, and supported instruments."
        related={
          <>
            <DocLink to="experiences">Experiences</DocLink>
          </>
        }
      />
      <GlossaryTerm
        id="term-instrument-class"
        term="Instrument class"
        definition="Asset type a session or broker supports: stock, crypto, futures, or prediction market."
        related={
          <>
            <DocLink to="experiences">Experiences</DocLink>
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
    </dl>
  );
}
