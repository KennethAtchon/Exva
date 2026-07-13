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
      <DocCallout variant="info" title="Removed from product surface">
        The <DocInlineCode>timer</DocInlineCode> source type has been removed.
        Scheduled scans are now owned by the SessionScheduler via the Experience
        Inputs editor. Migration{" "}
        <DocInlineCode>0006_purge_deprecated_signal_sources</DocInlineCode>{" "}
        deletes leftover <DocInlineCode>timer</DocInlineCode> /{" "}
        <DocInlineCode>web_search</DocInlineCode> rows from{" "}
        <DocInlineCode>signal_sources</DocInlineCode>.
      </DocCallout>
      <DocParagraph>
        Schedules are declared on experience descriptors;{" "}
        <DocInlineCode>SessionScheduler</DocInlineCode> owns cadence and emits{" "}
        <DocInlineCode>scan_hit</DocInlineCode> MarketSignals when a setup
        fires.
      </DocParagraph>

      <DocHeading id="configuration">Schedule fields</DocHeading>
      <DocParagraph>
        Each schedule requires a symbol and cadence.{" "}
        <DocInlineCode>defaultAnalysisTimeframe</DocInlineCode> is the bar size
        the strategy trades on — independent of how often the schedule runs.
      </DocParagraph>
      <DocTable
        headers={["Field", "Required", "Notes"]}
        rows={[
          [
            <DocInlineCode key="f">symbol</DocInlineCode>,
            "Yes",
            "Instrument symbol, e.g. SPY, BTC-USD.",
          ],
          [
            <DocInlineCode key="f">cadence</DocInlineCode>,
            "Yes",
            "How often SessionScheduler re-evaluates, e.g. 15m, 1h.",
          ],
          [
            <DocInlineCode key="f">defaultAnalysisTimeframe</DocInlineCode>,
            "Yes",
            "Bar timeframe the strategy trades on; can differ from cadence.",
          ],
          [
            <DocInlineCode key="f">marketHours</DocInlineCode>,
            "No",
            "regular, extended, or 24_7.",
          ],
          [
            <DocInlineCode key="f">instrumentClass</DocInlineCode>,
            "Yes",
            "stock, crypto, futures, options, or prediction_market.",
          ],
        ]}
      />

      <DocHeading id="cadence">Delivery</DocHeading>
      <DocParagraph>
        Quiet ticks produce nothing. Setups emit one{" "}
        <DocInlineCode>scan_hit</DocInlineCode> with strategy evidence. The
        delivery gate accepts scan_hit when the experience has schedules, even
        though <DocInlineCode>capabilities.signalSourceTypes</DocInlineCode> may
        be empty.
      </DocParagraph>
      <DocList
        items={[
          <>
            <DocStrong>cadence</DocStrong> — schedule interval
            (SessionScheduler).
          </>,
          <>
            <DocStrong>analysisTimeframe</DocStrong> — OHLCV bar size for rules
            engines.
          </>,
          <>
            <DocStrong>kind</DocStrong> — always{" "}
            <DocInlineCode>scan_hit</DocInlineCode> for schedule emissions.
          </>,
        ]}
      />
    </>
  );
}
