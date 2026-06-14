import {
  DocHeading,
  DocLink,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function EdgarItemCodesPage() {
  return (
    <>
      <DocParagraph>
        Form 8-K item codes identify the type of material event disclosed in an
        SEC filing. Exva parses these from filing text and can filter signals by
        whitelist during <DocLink to="edgar-detection">detection</DocLink>.
      </DocParagraph>

      <DocHeading id="research-codes" level={2}>
        Tracked item codes
      </DocHeading>
      <DocTable
        headers={["Item code", "Typical event"]}
        rows={[
          ["1.01", "Entry into a material definitive agreement"],
          ["1.03", "Bankruptcy or receivership"],
          ["2.02", "Results of operations and financial condition (earnings)"],
          ["2.03", "Creation of a direct financial obligation"],
          ["3.02", "Unregistered sales of equity securities"],
          ["5.02", "Departure or appointment of directors/officers"],
          ["8.01", "Other events (catch-all material disclosures)"],
        ]}
      />

      <DocHeading id="recommended-whitelist" level={2}>
        Recommended whitelist
      </DocHeading>
      <DocParagraph>
        The EDGAR Catalyst experience default whitelist includes all research
        codes. For production, a common starting subset is{" "}
        <DocStrong>1.01</DocStrong>, <DocStrong>2.02</DocStrong>, and{" "}
        <DocStrong>8.01</DocStrong> — material agreements, earnings, and other
        significant events.
      </DocParagraph>
      <DocParagraph>
        Configure item code filters when creating or editing an EDGAR source on
        the Signals page, or review defaults in the{" "}
        <DocLink to="experiences">Experiences</DocLink> reference.
      </DocParagraph>
    </>
  );
}
