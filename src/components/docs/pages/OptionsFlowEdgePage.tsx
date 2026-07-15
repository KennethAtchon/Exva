import {
  DocCallout,
  DocHeading,
  DocInlineCode,
  DocList,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";

export function OptionsFlowEdgePage() {
  return (
    <>
      <DocParagraph>
        <DocStrong>Options Flow Edge</DocStrong> turns unusual options activity
        (UOA) into a directional trading signal. Each cycle it pulls the option
        chain for a liquid underlying, screens for{" "}
        <DocInlineCode>volume &gt;&gt; open interest</DocInlineCode> with a
        directional call/put skew, then selects a{" "}
        <DocStrong>defined-risk debit vertical</DocStrong> (max loss = net
        debit) and places it via Tradier{" "}
        <DocInlineCode>placeSpread</DocInlineCode>. Evidence class is{" "}
        <DocStrong>forward-paper</DocStrong> — historical option-chain
        backtesting is out of reach. The UOA screen is deterministic; no LLM
        calls in the detector.
      </DocParagraph>

      <DocHeading id="how-it-works">How it works</DocHeading>
      <DocList
        items={[
          <>
            <DocStrong>Fetch the chain.</DocStrong> The broker adapter returns
            per-contract day volume, open interest, greeks, and quotes for the
            underlying.
          </>,
          <>
            <DocStrong>Aggregate.</DocStrong> Call and put volume and open
            interest are summed across the chain.
          </>,
          <>
            <DocStrong>Detect UOA.</DocStrong> If total{" "}
            <DocInlineCode>volume / open interest</DocInlineCode> clears the
            threshold (default 2×) and the call/put split leans past 60% one
            way, the flow reads bullish (calls) or bearish (puts).
          </>,
          <>
            <DocStrong>Select a vertical.</DocStrong>{" "}
            <DocInlineCode>selectVerticalSpread</DocInlineCode> picks a
            defined-risk debit vertical on the directional side; size and
            placement go through RiskEngine and{" "}
            <DocInlineCode>placeSpread</DocInlineCode>.
          </>,
        ]}
      />

      <DocHeading id="why-search">Why most flow is ignored</DocHeading>
      <DocParagraph>
        Most unusual volume is hedging or noise, not informed bets. The detector
        is deliberately strict — balanced flow, or volume that is merely above
        average, is skipped. An evidence-enrichment pass can later ask{" "}
        <DocStrong>why</DocStrong> the flow is happening (earnings, M&amp;A
        chatter, a known event) before committing, the same challenge-your-bias
        discipline used by the prediction-market pipeline.
      </DocParagraph>

      <DocHeading id="configuration">Configuration</DocHeading>
      <DocTable
        headers={["Field", "Default", "Notes"]}
        rows={[
          [
            <DocInlineCode key="f">volumeOiRatioThreshold</DocInlineCode>,
            "2",
            "How far volume must exceed open interest to count as unusual.",
          ],
          [
            <DocInlineCode key="f">bullishSkewThreshold</DocInlineCode>,
            "0.6",
            "Call (or put) share of directional volume needed to call a side.",
          ],
          [
            <DocInlineCode key="f">tradableUniverse</DocInlineCode>,
            "AAPL, NVDA",
            "Liquid underlyings only — wide-spread chains kill the edge.",
          ],
        ]}
      />

      <DocHeading id="execution">Contract-level execution</DocHeading>
      <DocParagraph>
        Execution is defined-risk options:{" "}
        <DocInlineCode>selectVerticalSpread</DocInlineCode> chooses long and
        short legs (same expiry, target width/debit), and Tradier{" "}
        <DocInlineCode>placeSpread</DocInlineCode> submits the multileg order.
        Max loss equals net debit for long verticals (plus fees). Monitor mid
        for profit target, stop, and DTE floor exits.
      </DocParagraph>

      <DocCallout variant="warning" title="Paper-only until validated">
        Options Flow Edge ships <DocStrong>disabled by default</DocStrong> and
        paper-only. It must clear its research contract — 100 out-of-sample
        paper fills with positive expectancy after costs — before live
        readiness.
      </DocCallout>
    </>
  );
}
