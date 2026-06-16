import {
  DocCallout,
  DocHeading,
  DocInlineCode,
  DocLink,
  DocMermaid,
  DocParagraph,
  DocStrong,
  DocTable,
} from "../primitives";
import { RISK_GATE_CHART } from "../diagrams";

export function RiskPage() {
  return (
    <>
      <DocParagraph>
        The <DocStrong>Risk</DocStrong> section sets sizing, stops, loss and
        exposure caps, and approval. Unlike Style and Rules, risk is{" "}
        <DocStrong>enforced deterministically</DocStrong>: every proposed trade
        passes through a risk engine that can reject it or shrink it,
        independent of how confident the AI was. This page covers both the
        config fields and how risk is actually computed per trade.
      </DocParagraph>

      <DocHeading id="fields" level={2}>
        Risk config fields
      </DocHeading>
      <DocTable
        headers={["Field", "Role"]}
        rows={[
          [
            <DocInlineCode>maxPositionUsd</DocInlineCode>,
            "Hard cap on a single position's notional. Oversized proposals are reduced to this value.",
          ],
          [
            <DocInlineCode>stopLossType</DocInlineCode>,
            "fixed_pct, trailing_atr, broker_native_trailing, or none.",
          ],
          [
            <DocInlineCode>stopLossPct / atrStopMultiplier</DocInlineCode>,
            "Stop distance: a fixed percent, or an ATR multiple for trailing stops.",
          ],
          [
            <DocInlineCode>takeProfitPct</DocInlineCode>,
            "Optional fixed take-profit distance handed to the order policy.",
          ],
          [
            <DocInlineCode>kellyFraction</DocInlineCode>,
            "Fraction of full Kelly used when sizing edge-based (prediction) positions.",
          ],
          [
            <DocInlineCode>predictionEdgeThreshold</DocInlineCode>,
            "Minimum probability edge before a prediction-market contract is worth trading.",
          ],
          [
            <DocInlineCode>maxExposureUsd</DocInlineCode>,
            "Cap on total exposure across open prediction-market contracts.",
          ],
          [
            <DocInlineCode>waitForOpenThreshold</DocInlineCode>,
            "Confidence floor below which a decision waits instead of opening (enforced by the trade aggregator).",
          ],
          [
            <DocInlineCode>maxConcurrentTrades</DocInlineCode>,
            "Most open positions allowed at once.",
          ],
          [
            <DocInlineCode>maxConsecutiveLosers</DocInlineCode>,
            "Stops new entries after this many losses in a row (0 disables).",
          ],
          [
            <DocInlineCode>volatilityHaltMaxSpreadPct</DocInlineCode>,
            "Rejects entries when the quoted spread is wider than this percent.",
          ],
          [
            <DocInlineCode>dailyLossLimitUsd / profitTargetUsd</DocInlineCode>,
            "Halts new trades for the day once daily P&L crosses either bound.",
          ],
          [
            <DocInlineCode>maxAiSpendUsd / maxDataSpendUsd</DocInlineCode>,
            "Daily AI and data budgets; reaching the AI budget halts new research.",
          ],
          [
            <DocInlineCode>humanApprovalRequired</DocInlineCode>,
            "When on, every proposal lands in the approval queue before execution.",
          ],
        ]}
      />

      <DocHeading id="gates" level={2}>
        How risk is calculated per trade
      </DocHeading>
      <DocParagraph>
        When a decision proposes a trade, the risk engine runs two passes. First{" "}
        <DocStrong>stats gates</DocStrong> check session-wide state; then{" "}
        <DocStrong>decision gates</DocStrong> size and bound the specific order.
        Some gates reject the trade; others silently reduce its size.
      </DocParagraph>
      <DocMermaid chart={RISK_GATE_CHART} />

      <DocHeading id="gate-types" level={3}>
        Gate reference
      </DocHeading>
      <DocTable
        headers={["Gate", "Effect"]}
        rows={[
          [
            <DocInlineCode>api_budget</DocInlineCode>,
            "Daily AI spend ≥ budget → reject (no new research).",
          ],
          [
            <DocInlineCode>daily_loss</DocInlineCode>,
            "Daily P&L ≤ −loss limit → reject.",
          ],
          [
            <DocInlineCode>profit_target</DocInlineCode>,
            "Daily P&L ≥ profit target → reject (done for the day).",
          ],
          [
            <DocInlineCode>consecutive_losers</DocInlineCode>,
            "Loss streak ≥ cap → reject.",
          ],
          [
            <DocInlineCode>concurrent_cap</DocInlineCode>,
            "Open trades ≥ max concurrent → reject.",
          ],
          [
            <DocInlineCode>position_size</DocInlineCode>,
            "Size ≤ 0 or asset-group cap breached → reject; over max position → reduced.",
          ],
          [
            <DocInlineCode>volatility_halt</DocInlineCode>,
            "Quote spread over the halt threshold → reject.",
          ],
          [
            <DocInlineCode>confidence</DocInlineCode>,
            "Below wait-for-open threshold → wait, not a hard reject.",
          ],
          [
            <DocInlineCode>broker_disconnected / ai_key_missing</DocInlineCode>,
            "Preflight gates: a session cannot trade without a connected broker and an AI key.",
          ],
        ]}
      />

      <DocHeading id="sizing" level={3}>
        Position sizing
      </DocHeading>
      <DocParagraph>
        Default sizing is <DocStrong>flat USD</DocStrong> — the order arrives
        with a proposed notional and is clamped down to{" "}
        <DocInlineCode>maxPositionUsd</DocInlineCode>. When{" "}
        <DocStrong>ATR vol-target</DocStrong> sizing is active and an ATR value
        is available, the engine instead sizes from a risk budget:{" "}
        <DocInlineCode>riskBudget = equity × riskPerTradePct</DocInlineCode>,
        then <DocInlineCode>sizeUsd = riskBudget ÷ ATR</DocInlineCode>, and uses
        whichever is smaller. Prediction-market positions are additionally
        capped to <DocInlineCode>maxExposureUsd</DocInlineCode> across open
        contracts.
      </DocParagraph>

      <DocHeading id="stops" level={2}>
        Stops & approval
      </DocHeading>
      <DocParagraph>
        The stop type and distance are passed to the order policy as the exit
        policy alongside the timeframe&apos;s max-hold window. If{" "}
        <DocInlineCode>humanApprovalRequired</DocInlineCode> is on, the sized,
        gated proposal is routed to the approval queue rather than executed —
        see the queue on the <DocLink to="dashboard">Dashboard</DocLink> and{" "}
        <DocLink to="sessions">Sessions</DocLink>.
      </DocParagraph>

      <DocHeading id="presets" level={2}>
        Risk presets
      </DocHeading>
      <DocTable
        headers={["Preset", "Shape"]}
        rows={[
          [
            "Conservative",
            "Max $200, fixed 2% stop, $100 daily loss cap, approval required, high confidence floor.",
          ],
          [
            "Moderate",
            "Max $500, trailing ATR (×2), $200 loss cap, up to 3 concurrent, approval optional.",
          ],
          [
            "Aggressive",
            "Max $1000, wider ATR (×3) stops, $500 loss cap, up to 5 concurrent.",
          ],
          [
            "Prediction Market",
            "Kelly 0.25, 8% edge threshold, $2000 max exposure, market-resolution exits (no fixed stop).",
          ],
          [
            "Custom Risk",
            "All fields set manually; runtime uses live values with no preset tolerance assumptions.",
          ],
        ]}
      />

      <DocCallout variant="warning" title="Risk overrides the model">
        Even a maximally confident AI decision is reduced or rejected when a
        gate is breached. Risk is the last word on whether and how big a trade
        goes out.
      </DocCallout>
    </>
  );
}
