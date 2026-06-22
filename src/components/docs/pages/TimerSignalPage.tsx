import {
  DocCallout,
  DocHeading,
  DocInlineCode,
  DocList,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function TimerSignalPage() {
  return (
    <>
      <DocParagraph>
        The <DocInlineCode>timer</DocInlineCode> source is clock-driven rather
        than event-driven. It emits one tick per configured{" "}
        <DocInlineCode>(symbol, cadence)</DocInlineCode> on a fixed interval,
        which makes it the feed for rules-based pipelines — mean reversion,
        momentum, and trend strategies that evaluate on each bar close rather
        than reacting to a catalyst.
      </DocParagraph>

      <DocHeading id="configuration">Configuration</DocHeading>
      <DocParagraph>
        Both <DocInlineCode>symbol</DocInlineCode> and{" "}
        <DocInlineCode>cadence</DocInlineCode> are required — the source throws
        on construction if either is missing. Experience-owned timer sources
        also carry <DocInlineCode>analysisTimeframe</DocInlineCode> for the OHLCV
        bar size the rules engine uses (distinct from how often the timer fires).
      </DocParagraph>
      <DocTable
        headers={["Field", "Required", "Notes"]}
        rows={[
          [
            <DocInlineCode key="f">symbol</DocInlineCode>,
            "Yes",
            "Instrument symbol, e.g. SPY, BTC-USD. Becomes the event ticker.",
          ],
          [
            <DocInlineCode key="f">cadence</DocInlineCode>,
            "Yes",
            "Poll/trade cadence label, e.g. 15m, 1h, 4h. Drives the default interval.",
          ],
          [
            <DocInlineCode key="f">analysisTimeframe</DocInlineCode>,
            "No",
            "OHLCV bar size for rules engines, e.g. 1h or 4h. May differ from cadence.",
          ],
          [
            <DocInlineCode key="f">intervalMs</DocInlineCode>,
            "No",
            "Explicit interval override; otherwise derived from cadence (min 1s).",
          ],
          [
            <DocInlineCode key="f">instrumentClass</DocInlineCode>,
            "No",
            "stock (default), crypto, futures, or prediction_market.",
          ],
        ]}
      />

      <DocHeading id="cadence">Cadence &amp; payload</DocHeading>
      <DocParagraph>
        When <DocInlineCode>intervalMs</DocInlineCode> is omitted the cadence
        label is parsed as <DocInlineCode>&lt;n&gt;m</DocInlineCode>,{" "}
        <DocInlineCode>&lt;n&gt;h</DocInlineCode>, or{" "}
        <DocInlineCode>&lt;n&gt;d</DocInlineCode> and converted to milliseconds;
        an unparseable cadence falls back to 15 minutes. Each tick fires
        immediately on start, then on every interval.
      </DocParagraph>
      <DocParagraph>The emitted payload carries:</DocParagraph>
      <DocList
        items={[
          <>
            <DocStrong>cadence</DocStrong> /{" "}
            <DocStrong>pollCadence</DocStrong> — when the timer fires a trade
            check.
          </>,
          <>
            <DocStrong>analysisTimeframe</DocStrong> — OHLCV bar size passed
            through to rules engines (when configured).
          </>,
          <>
            <DocStrong>instrumentClass</DocStrong> — from config (default{" "}
            <DocInlineCode>stock</DocInlineCode>).
          </>,
          <>
            <DocStrong>barCloseAt</DocStrong> — the tick timestamp.
          </>,
        ]}
      />

      <DocCallout variant="info" title="No catalyst payload">
        Timer events carry no filing, document URL, or accession — they are pure
        scheduling triggers. Pair them with rules engines, not catalyst analysis
        that expects 8-K content.
      </DocCallout>
    </>
  );
}
