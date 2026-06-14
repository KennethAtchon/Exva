import {
  DocCallout,
  DocCardGrid,
  DocCard,
  DocLink,
  DocParagraph,
} from "../primitives";

export function EdgarOverviewPage() {
  return (
    <>
      <DocParagraph>
        The EDGAR 8-K source is Exva&apos;s primary catalyst feed for US
        equities. It polls the SEC&apos;s public Atom feed for Form 8-K filings
        — material corporate events — and converts matching filings into
        tradeable signals. No API key is required.
      </DocParagraph>
      <DocParagraph>
        EDGAR signals feed the{" "}
        <DocLink to="experiences">EDGAR Catalyst experience</DocLink>, which
        routes each candidate through the specialized{" "}
        <DocLink to="edgar-pipeline">edgar-8k-cycle pipeline</DocLink>.
      </DocParagraph>
      <DocCardGrid>
        <DocCard
          title="Detection process"
          description="Atom feed polling, CIK resolution, and filtering steps."
          to="edgar-detection"
        />
        <DocCard
          title="Item codes"
          description="SEC 8-K item numbers and which events Exva tracks."
          to="edgar-item-codes"
        />
        <DocCard
          title="Tradability"
          description="Liquidity and quality filters before AI analysis."
          to="edgar-tradability"
        />
        <DocCard
          title="Pipeline stages"
          description="Catalyst analysis, adversarial review, and decision."
          to="edgar-pipeline"
        />
      </DocCardGrid>
      <DocCallout variant="info" title="Configure in the app">
        Create and tune EDGAR sources on the Signals page: poll intervals, CIK
        whitelist, minimum filing age, and item code filters. See{" "}
        <DocLink to="signal-source-types">Signal source types</DocLink> for
        global source behavior.
      </DocCallout>
    </>
  );
}
