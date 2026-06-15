import {
  DocCallout,
  DocInlineCode,
  DocLink,
  DocParagraph,
  DocStrong,
} from "../primitives";

export function WebSearchSignalPage() {
  return (
    <>
      <DocParagraph>
        The <DocInlineCode>web_search</DocInlineCode> source is a legacy
        discovery wrapper kept for backward compatibility. It is the fallback
        type the registry instantiates for unknown source records, so existing
        configurations keep loading.
      </DocParagraph>

      <DocParagraph>
        Unlike the catalyst feeds, it does <DocStrong>not</DocStrong> poll an
        external source on a schedule and emits no automatic signals — its test
        action returns zero detected, passed, and dropped. It reports{" "}
        <DocInlineCode>running</DocInlineCode> once started but produces no
        events on its own. Its only configuration is{" "}
        <DocInlineCode>instrumentClasses</DocInlineCode>, which scopes the
        classes it would emit (defaulting to{" "}
        <DocInlineCode>["stock"]</DocInlineCode>).
      </DocParagraph>

      <DocCallout variant="warning" title="Lower edge">
        Web search offers a weaker signal than the catalyst-driven feeds. For
        new setups prefer <DocLink to="edgar-overview">EDGAR 8-K</DocLink> or{" "}
        <DocLink to="prediction-events">prediction events</DocLink>; reach for{" "}
        <DocInlineCode>web_search</DocInlineCode> only when maintaining an older
        discovery-style configuration.
      </DocCallout>
    </>
  );
}
