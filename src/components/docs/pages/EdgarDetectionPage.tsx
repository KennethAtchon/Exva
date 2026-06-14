import {
  DocCallout,
  DocCode,
  DocHeading,
  DocInlineCode,
  DocLink,
  DocList,
  DocParagraph,
} from "../primitives";

export function EdgarDetectionPage() {
  return (
    <>
      <DocHeading id="data-source" level={2}>
        Data source
      </DocHeading>
      <DocParagraph>
        The source polls the SEC current-filings Atom endpoint:
      </DocParagraph>
      <DocCode>{`GET https://www.sec.gov/cgi-bin/browse-edgar
  ?action=getcurrent&type=8-K&owner=include&count=40&output=atom

User-Agent: Exva Signal Monitor
Accept: application/atom+xml`}</DocCode>
      <DocParagraph>
        Each poll retrieves up to 40 recent 8-K entries. Polling frequency
        adapts to market hours (Eastern Time): shorter intervals during
        9:30–16:00 ET on weekdays, longer intervals otherwise. Defaults are
        configurable per source (typically 3 minutes market / 15 minutes
        off-hours in the UI).
      </DocParagraph>

      <DocHeading id="filter-pipeline" level={2}>
        Filter pipeline
      </DocHeading>
      <DocParagraph>
        For each Atom entry, <DocInlineCode>EdgarSignalSource</DocInlineCode>{" "}
        applies the following filters in order. Entries that fail any step
        increment the <em>dropped</em> count; entries that pass emit a signal
        and increment <em>passed</em>.
      </DocParagraph>
      <DocList
        items={[
          <>
            <strong>Parse entry</strong> — Extract id, title, updated timestamp,
            summary, and filing link from Atom XML.
          </>,
          <>
            <strong>CIK whitelist</strong> — If configured, only filers whose
            Central Index Key appears in the whitelist continue. Empty whitelist
            = all filers.
          </>,
          <>
            <strong>CIK → ticker resolution</strong> — Look up the filer&apos;s
            primary ticker via{" "}
            <DocInlineCode>
              data.sec.gov/submissions/CIK{"{padded_cik}"}.json
            </DocInlineCode>
            . Results are cached in SQLite to minimize SEC API calls.
          </>,
          <>
            <strong>Minimum filing age</strong> — Optionally ignore filings
            newer than N minutes to avoid acting on incomplete entries.
          </>,
          <>
            <strong>Item code filter</strong> — Parse SEC item codes from the
            filing summary and title. See{" "}
            <DocLink to="edgar-item-codes">Item codes</DocLink>.
          </>,
          <>
            <strong>Emit SignalEvent</strong> — Build a normalized event with
            ticker, company name, document URL, accession number, item codes,
            and instrument class <DocInlineCode>stock</DocInlineCode>.
          </>,
        ]}
      />
      <DocCallout variant="info" title="Test vs live poll">
        The <strong>Test</strong> button on the Signals page runs one immediate
        poll and reports detection counts. It does not enqueue session
        deliveries — use a running session or mock rehearsal to validate
        end-to-end flow via the{" "}
        <DocLink to="signal-architecture">delivery queue</DocLink>.
      </DocCallout>
    </>
  );
}
