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
        directional call/put skew, and trades on the resulting read. The screen
        is fully deterministic — no LLM calls in v1.
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
            <DocStrong>Trade the read.</DocStrong> v1 trades the underlying
            equity on the directional signal; confidence scales with how
            unusual and how lopsided the flow is, capped at 0.85.
          </>,
        ]}
      />

      <DocHeading id="why-search">Why most flow is ignored</DocHeading>
      <DocParagraph>
        Most unusual volume is hedging or noise, not informed bets. The detector
        is deliberately strict — balanced flow, or volume that is merely above
        average, is skipped. The next phase adds an AI-search step that asks{" "}
        <DocStrong>why</DocStrong> the flow is happening (earnings, M&amp;A
        chatter, a known event) before committing, the same
        challenge-your-bias discipline used by the prediction-market pipeline.
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

      <DocHeading id="roadmap">Contract-level execution (next phase)</DocHeading>
      <DocParagraph>
        v1 trades the underlying so it can reuse the proven equity order path.
        The defined-risk options upgrade — selecting a specific contract (a long
        call/put or vertical, max loss = debit paid) via the contract selector —
        is the next phase. The selector picks the contract whose delta is
        closest to target among liquid, tight-spread strikes inside the expiry
        window.
      </DocParagraph>

      <DocCallout variant="warning" title="Paper-only until validated">
        Options Flow Edge ships <DocStrong>disabled by default</DocStrong> and
        paper-only. It must clear its research contract — 100 out-of-sample
        trades with a positive lower-bound expectancy — before it is considered
        for real capital.
      </DocCallout>
    </>
  );
}
