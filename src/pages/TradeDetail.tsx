import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AgentLabel, Badge } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import type { HelpGlossaryId } from "@/lib/help-glossary";
import { api } from "@/lib/exva";
import { cn } from "@/lib/utils";
import type {
  AgentMessage,
  AgentRun,
  EventSourceType,
  Trade,
} from "@/lib/types";
import { Dialog, DialogContent, HelpTooltip } from "@/components/ui";
import type {
  TechnicalSignal,
  FundamentalSignal,
  ReviewSignal,
  TradeSignal,
} from "@electron/shared/ai/trade-signals";

const PALETTE: Record<string, { bar: string; bg: string }> = {
  technical: { bar: "var(--color-success)", bg: "var(--color-success-dim)" },
  fundamental: { bar: "var(--color-error)", bg: "var(--color-error-dim)" },
  review: { bar: "var(--color-info)", bg: "var(--color-info-dim)" },
  decision: { bar: "var(--color-market)", bg: "var(--color-market-dim)" },
  selector: { bar: "var(--color-warning)", bg: "var(--color-warning-dim)" },
};
const EMPTY_VALUE = "—";

function previewJson(raw: string | null, max = 2400): string {
  if (raw == null || raw === "") return EMPTY_VALUE;
  try {
    const parsed: unknown = JSON.parse(raw);
    const s = JSON.stringify(parsed, null, 2);
    return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
  } catch {
    return raw.length > max ? `${raw.slice(0, max)}…` : raw;
  }
}

// ---------------------------------------------------------------------------
// AgentTrace — single agent run row (collapsible)
// ---------------------------------------------------------------------------

const AgentTrace = ({ run }: { run: AgentRun }) => {
  const [open, setOpen] = useState(false);
  const p = PALETTE[run.agent_type] ?? {
    bar: "var(--text3)",
    bg: "var(--surface2)",
  };
  return (
    <div className={traceCardClass}>
      <div
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="flex cursor-pointer items-center gap-2.5 px-3.5 py-[11px]"
        style={{
          background: p.bg,
          borderLeft: `3px solid ${p.bar}`,
        }}
      >
        <AgentLabel type={run.agent_type as EventSourceType} />
        <span className="flex-1 font-mono text-[12px] text-[var(--text3)]">
          {run.provider_key.replace(/^provider-/, "")} · {run.finish_reason} ·{" "}
          {fmt.tokens(run.input_tokens + run.output_tokens)} tok ·{" "}
          {fmt.usd(run.cost_usd, 4)} · {fmt.duration(run.duration_ms)}
        </span>
        <span className="text-[12px] text-[var(--text3)]">
          {open ? "▲" : "▼"}
        </span>
      </div>
      {open && (
        <div className="flex flex-col gap-3 border-t border-[var(--border)] p-3.5">
          <div className="flex gap-5">
            {(
              [
                ["Provider", run.provider_key],
                ["Finish", run.finish_reason],
                ["In", `${fmt.tokens(run.input_tokens)} tok`],
                ["Out", `${fmt.tokens(run.output_tokens)} tok`],
                ["Cost", fmt.usd(run.cost_usd, 4)],
                ["Time", fmt.duration(run.duration_ms)],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k}>
                <div className={traceMetaLabelClass}>{k}</div>
                <div className={traceMetaValueClass}>{v}</div>
              </div>
            ))}
          </div>
          <div
            className={outputTextClass}
            style={{ borderLeft: `3px solid ${p.bar}` }}
          >
            "{run.output_text}"
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// MessageTrace — single harness message row (collapsible)
// ---------------------------------------------------------------------------

const MessageTrace = ({ msg }: { msg: AgentMessage }) => {
  const [open, setOpen] = useState(false);
  const p = PALETTE[msg.role] ?? { bar: "var(--text3)", bg: "var(--surface2)" };
  return (
    <div className={traceCardClass}>
      <div
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2.5"
        style={{
          background: p.bg,
          borderLeft: `3px solid ${p.bar}`,
        }}
      >
        <AgentLabel type={msg.role as EventSourceType} />
        <span className="flex-1 font-mono text-[12px] text-[var(--text3)]">
          {msg.provider_key.replace(/^provider-/, "")} · {msg.model_id}
          {msg.cycle_id ? ` · cycle ${msg.cycle_id.slice(0, 8)}…` : ""}
        </span>
        <span className="text-[12px] text-[var(--text3)]">
          {open ? "▲" : "▼"}
        </span>
      </div>
      {open && (
        <div className="flex flex-col gap-2.5 border-t border-[var(--border)] p-3">
          <pre className={msgJsonPreClass}>
            {previewJson(msg.messages_json)}
          </pre>
          {msg.tool_calls_json ? (
            <div>
              <div className="mb-1.5 text-[12px] text-[var(--text3)]">
                Tool calls
              </div>
              <pre className={toolCallsPreClass}>
                {previewJson(msg.tool_calls_json, 1600)}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TradeHero — PnL + confidence hero block
// ---------------------------------------------------------------------------

const TradeHero = ({
  pnl,
  hasPositivePnl,
  isOpen,
  confidenceScore,
  positionSizeUsd,
}: {
  pnl: number | null;
  hasPositivePnl: boolean;
  isOpen: boolean;
  confidenceScore: number | null;
  positionSizeUsd: number;
}) => (
  <div className={heroClass}>
    <div>
      <div className={heroLabelClass}>
        {isOpen ? "Unrealized P&L" : "Final P&L"}
      </div>
      <div
        className={cn(
          "font-mono text-[40px] font-bold leading-none",
          hasPositivePnl ? "text-success" : "text-error",
        )}
      >
        {pnl != null ? fmt.pnl(pnl) : EMPTY_VALUE}
      </div>
      {pnl != null && (
        <div
          className={cn(
            "mt-1 font-mono text-[14px]",
            hasPositivePnl ? "text-success" : "text-error",
          )}
        >
          {fmt.pct(pnl / positionSizeUsd)}
        </div>
      )}
    </div>
    <div className="text-right">
      <div
        className={cn(
          heroLabelClass,
          "inline-flex items-center justify-end gap-1",
        )}
      >
        Confidence
        <HelpTooltip glossaryId="confidence" />
      </div>
      <div className="font-mono text-[40px] font-bold leading-none text-[var(--text1)]">
        {Math.round((confidenceScore ?? 0) * 100)}%
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// TradePositionBar — stop/entry/take-profit price range visualizer
// ---------------------------------------------------------------------------

const TradePositionBar = ({
  stopLossPrice,
  takeProfitPrice,
  currentPrice,
  entryPrice,
}: {
  stopLossPrice: number;
  takeProfitPrice: number;
  currentPrice: number;
  entryPrice: number;
}) => {
  const lo = stopLossPrice;
  const hi = takeProfitPrice;
  const cur = currentPrice;
  const en = entryPrice;
  const range = hi - lo;
  const entryPct = ((en - lo) / range) * 100;
  const curPct = Math.max(0, Math.min(100, ((cur - lo) / range) * 100));

  return (
    <div className="px-6 pb-5">
      <div className={secTitleClass}>Position</div>
      <div>
        <div className="relative h-9 overflow-hidden rounded-lg bg-[var(--surface2)]">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-error-dim)_0%,transparent_38%,transparent_62%,var(--color-success-dim)_100%)]" />
          <div
            className="absolute top-1.5 bottom-1.5 w-px rounded-[1px] bg-[var(--text3)]"
            style={{ left: `${entryPct}%` }}
          />
          <div className={priceMarkerClass} style={{ left: `${curPct}%` }} />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[12px] text-error">
            {fmt.usd(lo)}
          </span>
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[12px] text-success">
            {fmt.usd(hi)}
          </span>
        </div>
        <div className="mt-[5px] flex justify-between text-[12px] text-[var(--text3)]">
          <span>Stop Loss</span>
          <span>● current price</span>
          <span>Take Profit</span>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// TradeOrderDetails — order details grid section
// ---------------------------------------------------------------------------

type TradeFields = {
  position_size_usd?: number | null;
  instrumentDisplayName?: string | null;
  predictionOutcome?: string | null;
  broker_order_id?: string | null;
  stop_loss_price?: number | null;
  take_profit_price?: number | null;
  opened_at?: string | null;
  closed_at?: string | null;
  ai_cost_usd?: number | null;
  strategy?: string | null;
};

const TradeOrderDetails = ({ trade }: { trade: TradeFields }) => (
  <div className={sectionClass}>
    <div className={secTitleClass}>Order Details</div>
    <div className="mt-3 grid grid-cols-2 gap-3.5">
      {(
        [
          [
            "Position Size",
            trade.position_size_usd != null
              ? fmt.usd(trade.position_size_usd)
              : EMPTY_VALUE,
          ],
          ["Display Name", trade.instrumentDisplayName ?? EMPTY_VALUE],
          ["Outcome", trade.predictionOutcome ?? EMPTY_VALUE],
          ["Broker ID", trade.broker_order_id ?? EMPTY_VALUE],
          [
            "Stop Loss",
            trade.stop_loss_price != null
              ? fmt.usd(trade.stop_loss_price)
              : EMPTY_VALUE,
          ],
          [
            "Take Profit",
            trade.take_profit_price != null
              ? fmt.usd(trade.take_profit_price)
              : EMPTY_VALUE,
          ],
          ["Opened", trade.opened_at ? fmt.time(trade.opened_at) : EMPTY_VALUE],
          ["Closed", trade.closed_at ? fmt.time(trade.closed_at) : EMPTY_VALUE],
          [
            "AI Cost",
            trade.ai_cost_usd != null
              ? fmt.usd(trade.ai_cost_usd, 4)
              : EMPTY_VALUE,
            "trade-cost-attribution",
          ],
          ["Strategy", trade.strategy ?? EMPTY_VALUE],
        ] as [string, string, HelpGlossaryId?][]
      ).map(([k, v, helpId]) => (
        <div key={k}>
          <div
            className={cn(
              orderFieldLabelClass,
              "inline-flex items-center gap-1",
            )}
          >
            {k}
            {helpId ? <HelpTooltip glossaryId={helpId} /> : null}
          </div>
          <div className={orderFieldValueClass}>{v}</div>
        </div>
      ))}
    </div>
  </div>
);

const TradeExitAnalytics = ({
  trade,
}: {
  trade: {
    mfe_usd?: number | null;
    mae_usd?: number | null;
    spread_at_entry_bps?: number | null;
    slippage_bps?: number | null;
    commission_usd?: number | null;
    borrow_cost_usd?: number | null;
    execution_cost_usd?: number | null;
    take_profit_touched_at?: string | null;
    stop_touched_at?: string | null;
    exit_reason?: string | null;
    opened_at?: string | null;
    closed_at?: string | null;
  };
}) => {
  const hasAnalytics =
    trade.mfe_usd != null ||
    trade.mae_usd != null ||
    trade.spread_at_entry_bps != null ||
    trade.slippage_bps != null ||
    trade.execution_cost_usd != null ||
    trade.take_profit_touched_at ||
    trade.stop_touched_at ||
    trade.exit_reason;
  if (!hasAnalytics) return null;

  return (
    <div className={sectionClass}>
      <div className={secTitleClass}>Why this traded / why it closed</div>
      <div className="mt-3 grid grid-cols-2 gap-3.5">
        {(
          [
            [
              "MFE",
              trade.mfe_usd != null ? fmt.usd(trade.mfe_usd) : EMPTY_VALUE,
            ],
            [
              "MAE",
              trade.mae_usd != null ? fmt.usd(trade.mae_usd) : EMPTY_VALUE,
            ],
            [
              "Spread at entry",
              trade.spread_at_entry_bps != null
                ? `${trade.spread_at_entry_bps.toFixed(1)} bps`
                : EMPTY_VALUE,
            ],
            [
              "Slippage",
              trade.slippage_bps != null
                ? `${trade.slippage_bps.toFixed(1)} bps`
                : EMPTY_VALUE,
            ],
            [
              "Execution cost",
              trade.execution_cost_usd != null
                ? fmt.usd(trade.execution_cost_usd, 4)
                : EMPTY_VALUE,
            ],
            [
              "TP touched",
              trade.take_profit_touched_at
                ? fmt.time(trade.take_profit_touched_at)
                : EMPTY_VALUE,
            ],
            [
              "Stop touched",
              trade.stop_touched_at
                ? fmt.time(trade.stop_touched_at)
                : EMPTY_VALUE,
            ],
            ["Exit reason", trade.exit_reason ?? EMPTY_VALUE],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k}>
            <div className={orderFieldLabelClass}>{k}</div>
            <div className={orderFieldValueClass}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const TradeGateTimeline = ({
  steps,
}: {
  steps: Array<{
    stage: string;
    status: string;
    lastErrorCode: string | null;
    updatedAt: string;
  }>;
}) => {
  if (!steps.length) return null;
  return (
    <div className={sectionClass}>
      <div className={secTitleClass}>Gate timeline</div>
      <div className="mt-3 flex flex-col gap-2">
        {steps.map((step) => (
          <div
            key={`${step.stage}-${step.updatedAt}`}
            className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2"
          >
            <span className="font-mono text-[12px] text-[var(--text2)]">
              {step.stage}
            </span>
            <span className="text-[12px] text-[var(--text3)]">
              {step.status}
              {step.lastErrorCode ? ` · ${step.lastErrorCode}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// TradeHarnessMessages — collapsible harness messages section
// ---------------------------------------------------------------------------

const TradeHarnessMessages = ({ messages }: { messages: AgentMessage[] }) => {
  if (messages.length === 0) return null;
  return (
    <div className={sectionClass}>
      <div className={cn(secTitleClass, "mb-3")}>Harness messages</div>
      {messages.map((m) => (
        <MessageTrace key={m.id} msg={m} />
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TradeAgentRuns — agent runs list + token/cost summary
// ---------------------------------------------------------------------------

const TradeAgentRuns = ({ runs }: { runs: AgentRun[] }) => {
  if (runs.length === 0) return null;
  return (
    <div className={sectionClass}>
      <div className={cn(secTitleClass, "mb-3")}>Agent runs</div>
      {runs.map((r) => (
        <AgentTrace key={r.id} run={r} />
      ))}
      <div className="mt-2.5 flex justify-between rounded-lg bg-[var(--surface2)] px-3.5 py-2.5">
        <span className="text-[12px] text-[var(--text3)]">
          Total ·{" "}
          {fmt.tokens(
            runs.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0),
          )}{" "}
          tokens
        </span>
        <span className="font-mono text-[12px] font-semibold text-[var(--text2)]">
          {fmt.usd(
            runs.reduce((s, r) => s + r.cost_usd, 0),
            4,
          )}
        </span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// TradeVerdictPanel — helpers + component
// ---------------------------------------------------------------------------

type ParsedSignals = {
  technical: TechnicalSignal | null;
  fundamental: FundamentalSignal | null;
  review: ReviewSignal | null;
  decision: TradeSignal | null;
};

function parseTradeSignals(messages: AgentMessage[]): ParsedSignals {
  const result: ParsedSignals = {
    technical: null,
    fundamental: null,
    review: null,
    decision: null,
  };
  const sorted = [...messages].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  for (const msg of sorted) {
    if (!msg.output_json || !msg.output_schema_name) continue;
    try {
      const parsed: unknown = JSON.parse(msg.output_json);
      switch (msg.output_schema_name) {
        case "technicalSignal":
          result.technical = parsed as TechnicalSignal;
          break;
        case "fundamentalSignal":
          result.fundamental = parsed as FundamentalSignal;
          break;
        case "reviewSignal":
          result.review = parsed as ReviewSignal;
          break;
        case "tradeSignal":
        case "rules-mean-reversion":
        case "rules-trend-following":
        case "rules-breakout":
        case "catalyst-trade-decision":
          result.decision = parsed as TradeSignal;
          break;
      }
    } catch {
      // unparseable output_json — skip silently
    }
  }
  return result;
}

type VerdictVariant = "success" | "danger" | "warn" | "default";

function resolveVerdict(
  trade: Trade,
  decision: TradeSignal | null,
  gateSteps: Array<{
    stage: string;
    status: string;
    lastErrorCode: string | null;
  }>,
): { label: string; variant: VerdictVariant; summary: string } {
  if (trade.status === "open") {
    return {
      label: "OPEN",
      variant: "success",
      summary: "Decision to trade was approved through all gates.",
    };
  }
  if (trade.status === "closed") {
    return {
      label: "CLOSED",
      variant: "default",
      summary: "Decision to trade was approved through all gates.",
    };
  }
  if (trade.status === "pending") {
    return {
      label: "PENDING",
      variant: "warn",
      summary: "Awaiting pipeline completion or human approval.",
    };
  }
  // rejected
  if (decision?.action === "skip") {
    const isThresholdReject = decision.reasoning
      .toLowerCase()
      .includes("wait-for-open");
    return {
      label: "SKIPPED",
      variant: "default",
      summary: isThresholdReject
        ? "Skipped — confidence below wait-for-open threshold."
        : "AI decided not to trade this instrument.",
    };
  }
  const failedGate = gateSteps.find((s) => s.status === "failed");
  if (failedGate) {
    return {
      label: "REJECTED",
      variant: "danger",
      summary: `Blocked by ${failedGate.stage} gate.`,
    };
  }
  return {
    label: "REJECTED",
    variant: "danger",
    summary: "Trade was rejected.",
  };
}

function buildRejectionChain(
  decision: TradeSignal | null,
  gateSteps: Array<{
    stage: string;
    status: string;
    lastErrorCode: string | null;
  }>,
  trade: Trade,
): string[] {
  if (decision?.action === "skip") return [decision.reasoning];
  const failedGate = gateSteps.find((s) => s.status === "failed");
  if (failedGate) {
    const msg = failedGate.lastErrorCode
      ? `Stage: ${failedGate.stage} · ${failedGate.lastErrorCode}`
      : `Stage: ${failedGate.stage}`;
    return [msg];
  }
  if (trade.exit_reason) return [trade.exit_reason];
  return ["Rejection reason not recorded."];
}

const ScoreBar = ({ score, color }: { score: number; color: string }) => (
  <div className="h-[3px] w-full overflow-hidden rounded-[2px] bg-[var(--surface3)]">
    <div
      className="h-full rounded-[2px]"
      style={{
        width: `${Math.min(Math.max(score * 100, 0), 100)}%`,
        background: color,
      }}
    />
  </div>
);

const SignalCardShell = ({
  type,
  scoreValue,
  metricLabel,
  metricDisplay,
  summary,
}: {
  type: string;
  scoreValue: number;
  metricLabel: string;
  metricDisplay: React.ReactNode;
  summary: string;
}) => {
  const [expanded, setExpanded] = useState(false);
  const p = PALETTE[type] ?? { bar: "var(--text3)", bg: "var(--surface2)" };
  return (
    <div
      className="flex flex-col gap-2.5 rounded-[10px] border border-[var(--border)] p-3"
      style={{ borderLeftColor: p.bar, borderLeftWidth: 3, background: p.bg }}
    >
      <div className="flex items-center justify-between gap-2">
        <AgentLabel type={type as EventSourceType} />
        <ScoreBar score={scoreValue} color={p.bar} />
      </div>
      <div>
        <div className={orderFieldLabelClass}>{metricLabel}</div>
        <div className={orderFieldValueClass}>{metricDisplay}</div>
      </div>
      {summary.trim() && (
        <p
          className={cn(
            "cursor-pointer text-[12px] italic leading-[1.5] text-[var(--text3)]",
            !expanded && "line-clamp-2",
          )}
          onClick={() => setExpanded((e) => !e)}
        >
          {summary}
        </p>
      )}
    </div>
  );
};

const TechnicalCard = ({ signal }: { signal: TechnicalSignal }) => (
  <SignalCardShell
    type="technical"
    scoreValue={signal.trendStrength}
    metricLabel="Trend"
    metricDisplay={
      <span>
        {signal.trendDirection}
        {signal.patternName ? ` · ${signal.patternName}` : ""}
      </span>
    }
    summary={signal.rawSummary}
  />
);

const FundamentalCard = ({ signal }: { signal: FundamentalSignal }) => (
  <SignalCardShell
    type="fundamental"
    scoreValue={signal.catalystScore ?? signal.catalystStrength ?? 0}
    metricLabel="Catalyst"
    metricDisplay={
      <span>
        {signal.catalystType ?? "—"}
        {signal.catalystSummary
          ? ` · ${signal.catalystSummary.slice(0, 40)}`
          : ""}
      </span>
    }
    summary={signal.rawSummary}
  />
);

const ReviewCard = ({ signal }: { signal: ReviewSignal }) => (
  <SignalCardShell
    type="review"
    scoreValue={1 - (signal.technicalFundamentalConflict ?? 0)}
    metricLabel="Recommendation"
    metricDisplay={
      <span>
        {signal.recommendation}
        {signal.overallRisk ? ` · risk: ${signal.overallRisk}` : ""}
      </span>
    }
    summary={signal.rawSummary}
  />
);

const DecisionCard = ({ signal }: { signal: TradeSignal }) => (
  <SignalCardShell
    type="decision"
    scoreValue={signal.confidence}
    metricLabel="Action"
    metricDisplay={
      <span>
        {signal.action} · {Math.round(signal.confidence * 100)}%
        {signal.executionStrategy ? ` · ${signal.executionStrategy}` : ""}
      </span>
    }
    summary={signal.reasoning}
  />
);

const TradeVerdictPanel = ({
  trade,
  messages,
  gateSteps,
}: {
  trade: Trade;
  messages: AgentMessage[];
  gateSteps: Array<{
    stage: string;
    status: string;
    lastErrorCode: string | null;
    updatedAt: string;
  }>;
}) => {
  const signals = parseTradeSignals(messages);
  const hasAny =
    signals.technical ||
    signals.fundamental ||
    signals.review ||
    signals.decision;
  if (!hasAny) return null;

  const { label, variant, summary } = resolveVerdict(
    trade,
    signals.decision,
    gateSteps,
  );
  const rejectionReasons =
    trade.status === "rejected"
      ? buildRejectionChain(signals.decision, gateSteps, trade)
      : [];
  const showSizingRationale =
    trade.status !== "rejected" && signals.decision?.action !== "skip";

  return (
    <div className={sectionClass}>
      <div className="mb-3 flex items-center gap-2.5">
        <div className={secTitleClass}>Verdict</div>
        <Badge variant={variant} size="sm">
          {label}
        </Badge>
      </div>
      <p className="mb-4 text-[13px] leading-[1.5] text-[var(--text2)]">
        {summary}
      </p>

      <div className="grid grid-cols-2 gap-3">
        {signals.technical && <TechnicalCard signal={signals.technical} />}
        {signals.fundamental && (
          <FundamentalCard signal={signals.fundamental} />
        )}
        {signals.review && <ReviewCard signal={signals.review} />}
        {signals.decision && <DecisionCard signal={signals.decision} />}
      </div>

      {rejectionReasons.length > 0 && (
        <div className="mt-4">
          <div className={cn(secTitleClass, "mb-2")}>Why it was blocked</div>
          <div className="flex flex-col gap-2">
            {rejectionReasons.map((reason, i) => (
              <div
                key={i}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2"
                style={{
                  borderLeftColor: "var(--color-error)",
                  borderLeftWidth: 3,
                }}
              >
                <p
                  className="font-mono text-[12px] text-[var(--text2)]"
                  title={reason}
                >
                  {reason.length > 120 ? `${reason.slice(0, 120)}…` : reason}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {showSizingRationale && (
        <p className="mt-4 text-[12px] text-[var(--text3)]">
          Position sized at{" "}
          <span className="font-mono text-[var(--text2)]">
            {fmt.usd(trade.position_size_usd)}
          </span>
          {" · "}
          <span className="font-mono text-[var(--text2)]">
            {Math.round((trade.confidence_score ?? 0) * 100)}%
          </span>{" "}
          confidence
          {trade.execution_strategy ? ` · ${trade.execution_strategy}` : ""}
          {signals.decision?.entryPrice != null
            ? ` · limit @ ${fmt.usd(signals.decision.entryPrice)}`
            : " · market order"}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TradeDetail — main component
// ---------------------------------------------------------------------------

export const TradeDetail = ({
  tradeId,
  onClose,
  onViewAutopsy,
}: {
  tradeId: string;
  onClose: () => void;
  onViewAutopsy?: (tradeId: string) => void;
}) => {
  const queryClient = useQueryClient();
  const [closing, setClosing] = useState(false);

  const { data: detail } = useQuery({
    queryKey: ["trade-detail", tradeId],
    queryFn: () => api.getTradeDetail(tradeId),
  });
  const trade = detail?.trade ?? null;
  const runs = detail?.runs ?? [];
  const messages = detail?.messages ?? [];
  const gateSteps = detail?.gateSteps ?? [];

  const handleForceClose = async () => {
    setClosing(true);
    try {
      await api.forceCloseTrade(tradeId);
      void queryClient.invalidateQueries({
        queryKey: ["trade-detail", tradeId],
      });
      onClose();
    } finally {
      setClosing(false);
    }
  };

  if (!trade) return null;
  const isOpen = trade.status === "open";
  const pnl = (isOpen ? trade.unrealized_pnl : trade.final_pnl_usd) ?? null;
  const hasPositivePnl = pnl != null && pnl >= 0;

  return (
    <Dialog open={!!trade} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="h-[92vh] max-w-[96vw] overflow-auto border-border bg-transparent p-0 sm:max-w-[480px]">
        <div className={panelClass}>
          <div className={headerClass}>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[22px] font-bold text-[var(--text1)]">
                {trade.instrumentSymbol}
              </span>
              {trade.predictionOutcome ? (
                <Badge variant="purple">{trade.predictionOutcome}</Badge>
              ) : null}
              <Badge variant={trade.side === "BUY" ? "success" : "danger"}>
                {trade.side}
              </Badge>
              <Badge variant={isOpen ? "success" : "default"}>
                {trade.status}
              </Badge>
            </div>
            {!isOpen && onViewAutopsy && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onViewAutopsy(tradeId)}
                  className={autopsyBtnClass}
                >
                  ⚕ Review Trade
                </button>
                <HelpTooltip glossaryId="trade-autopsy" />
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-0 overflow-y-auto">
            {trade.instrumentDisplayName ? (
              <div className="px-6 pb-3.5 text-[13px] text-[var(--text2)]">
                {trade.instrumentDisplayName}
              </div>
            ) : null}

            <TradeHero
              pnl={pnl}
              hasPositivePnl={hasPositivePnl}
              isOpen={isOpen}
              confidenceScore={trade.confidence_score ?? null}
              positionSizeUsd={trade.position_size_usd}
            />

            {isOpen &&
              trade.stop_loss_price != null &&
              trade.take_profit_price != null &&
              trade.current_price != null &&
              trade.entry_price != null && (
                <TradePositionBar
                  stopLossPrice={trade.stop_loss_price}
                  takeProfitPrice={trade.take_profit_price}
                  currentPrice={trade.current_price}
                  entryPrice={trade.entry_price}
                />
              )}

            <TradeVerdictPanel
              trade={trade}
              messages={messages}
              gateSteps={gateSteps ?? []}
            />
            <TradeOrderDetails trade={trade} />
            <TradeExitAnalytics trade={trade} />
            <TradeGateTimeline steps={gateSteps} />
            <TradeHarnessMessages messages={messages} />
            <TradeAgentRuns runs={runs} />

            {isOpen && (
              <div className="px-6 pb-7">
                <button
                  disabled={closing}
                  onClick={handleForceClose}
                  className={forceCloseBtnClass}
                >
                  {closing ? "Closing…" : "Force Close Position"}
                </button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const traceCardClass =
  "mb-2 overflow-hidden rounded-[10px] border border-[var(--border)]";

const traceMetaLabelClass =
  "mb-[3px] text-[12px] uppercase tracking-[0.06em] text-[var(--text3)]";

const traceMetaValueClass = "font-mono text-[12px] text-[var(--text2)]";

const outputTextClass =
  "rounded-lg bg-[var(--surface2)] px-3.5 py-3 text-[13px] italic leading-[1.65] text-[var(--text2)]";

const msgJsonPreClass =
  "m-0 max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface2)] p-3 font-mono text-[12px] leading-[1.45] text-[var(--text2)]";

const toolCallsPreClass =
  "m-0 max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface2)] p-3 font-mono text-[12px] leading-[1.45] text-[var(--text2)]";

const autopsyBtnClass =
  "shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-transparent px-[11px] py-[5px] font-mono text-[12px] text-[var(--text3)]";

const priceMarkerClass =
  "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg)] bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]";

const panelClass =
  "flex min-h-full w-[480px] animate-[slideIn_0.22s_ease-out] flex-col border-l border-[var(--border)] bg-[var(--surface)]";

const headerClass =
  "flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-5";

const heroClass =
  "flex items-end justify-between border-b border-[var(--border)] px-6 pb-5 pt-6";

const heroLabelClass =
  "mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text3)]";

const secTitleClass =
  "text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text3)]";

const sectionClass = "border-t border-[var(--border)] px-6 pb-5 pt-5";

const orderFieldLabelClass =
  "mb-1 text-[12px] uppercase tracking-[0.06em] text-[var(--text3)]";

const orderFieldValueClass =
  "font-mono text-[13px] font-medium text-[var(--text1)]";

const forceCloseBtnClass =
  "w-full cursor-pointer rounded-[10px] border border-error-border bg-error-dim px-3 py-3 font-sans text-[13px] font-semibold text-error";
