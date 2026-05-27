import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AgentLabel, Badge } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import { api } from "@/lib/exva";
import type { AgentMessage, AgentRun, EventSourceType } from "@/lib/types";
import { Dialog, DialogContent } from "@/components/ui";

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
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
        marginBottom: 8,
      }}
    >
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
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "11px 14px",
          cursor: "pointer",
          background: p.bg,
          borderLeft: `3px solid ${p.bar}`,
        }}
      >
        <AgentLabel type={run.agent_type as EventSourceType} />
        <span
          style={{
            flex: 1,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text3)",
          }}
        >
          {run.provider_key.replace(/^provider-/, "")} · {run.finish_reason} ·{" "}
          {fmt.tokens(run.input_tokens + run.output_tokens)} tok ·{" "}
          {fmt.usd(run.cost_usd, 4)} · {fmt.duration(run.duration_ms)}
        </span>
        <span style={{ fontSize: 12, color: "var(--text3)" }}>
          {open ? "▲" : "▼"}
        </span>
      </div>
      {open && (
        <div
          style={{
            padding: 14,
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", gap: 20 }}>
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
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 3,
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text2)",
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
          <div style={{ ...ts.outputText, borderLeft: `3px solid ${p.bar}` }}>
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
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
        marginBottom: 8,
      }}
    >
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
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          cursor: "pointer",
          background: p.bg,
          borderLeft: `3px solid ${p.bar}`,
        }}
      >
        <AgentLabel type={msg.role as EventSourceType} />
        <span
          style={{
            flex: 1,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text3)",
          }}
        >
          {msg.provider_key.replace(/^provider-/, "")} · {msg.model_id}
          {msg.cycle_id ? ` · cycle ${msg.cycle_id.slice(0, 8)}…` : ""}
        </span>
        <span style={{ fontSize: 12, color: "var(--text3)" }}>
          {open ? "▲" : "▼"}
        </span>
      </div>
      {open && (
        <div
          style={{
            padding: 12,
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <pre style={ts.msgJsonPre}>{previewJson(msg.messages_json)}</pre>
          {msg.tool_calls_json ? (
            <div>
              <div
                style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}
              >
                Tool calls
              </div>
              <pre style={ts.toolCallsPre}>
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
  <div style={ts.hero}>
    <div>
      <div style={ts.heroLabel}>{isOpen ? "Unrealized P&L" : "Final P&L"}</div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 40,
          fontWeight: 700,
          color: hasPositivePnl ? "var(--color-success)" : "var(--color-error)",
          lineHeight: 1,
        }}
      >
        {pnl != null ? fmt.pnl(pnl) : EMPTY_VALUE}
      </div>
      {pnl != null && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            color: hasPositivePnl
              ? "var(--color-success)"
              : "var(--color-error)",
            marginTop: 4,
          }}
        >
          {fmt.pct(pnl / positionSizeUsd)}
        </div>
      )}
    </div>
    <div style={{ textAlign: "right" }}>
      <div style={ts.heroLabel}>Confidence</div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 40,
          fontWeight: 700,
          color: "var(--text1)",
          lineHeight: 1,
        }}
      >
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
    <div style={{ padding: "0 24px 20px" }}>
      <div style={ts.secTitle}>Position</div>
      <div>
        <div
          style={{
            position: "relative",
            height: 36,
            background: "var(--surface2)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(to right, var(--color-error-dim) 0%, transparent 38%, transparent 62%, var(--color-success-dim) 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${entryPct}%`,
              top: 6,
              bottom: 6,
              width: 1.5,
              background: "rgba(255,255,255,0.25)",
              borderRadius: 1,
            }}
          />
          <div style={{ ...ts.priceMarkerBase, left: `${curPct}%` }} />
          <span
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 12,
              color: "var(--color-error)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {fmt.usd(lo)}
          </span>
          <span
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 12,
              color: "var(--color-success)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {fmt.usd(hi)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 5,
            fontSize: 12,
            color: "var(--text3)",
          }}
        >
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
  <div
    style={{
      padding: "0 24px 20px",
      borderTop: "1px solid var(--border)",
      paddingTop: 20,
    }}
  >
    <div style={ts.secTitle}>Order Details</div>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 14,
        marginTop: 12,
      }}
    >
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
          ],
          ["Strategy", trade.strategy ?? EMPTY_VALUE],
        ] as [string, string][]
      ).map(([k, v]) => (
        <div key={k}>
          <div
            style={{
              fontSize: 12,
              color: "var(--text3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            {k}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: "var(--text1)",
              fontWeight: 500,
            }}
          >
            {v}
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// TradeHarnessMessages — collapsible harness messages section
// ---------------------------------------------------------------------------

const TradeHarnessMessages = ({ messages }: { messages: AgentMessage[] }) => {
  if (messages.length === 0) return null;
  return (
    <div
      style={{
        padding: "0 24px 20px",
        borderTop: "1px solid var(--border)",
        paddingTop: 20,
      }}
    >
      <div style={{ ...ts.secTitle, marginBottom: 12 }}>Harness messages</div>
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
    <div
      style={{
        padding: "0 24px 20px",
        borderTop: "1px solid var(--border)",
        paddingTop: 20,
      }}
    >
      <div style={{ ...ts.secTitle, marginBottom: 12 }}>Agent runs</div>
      {runs.map((r) => (
        <AgentTrace key={r.id} run={r} />
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 10,
          padding: "10px 14px",
          background: "var(--surface2)",
          borderRadius: 8,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text3)" }}>
          Total ·{" "}
          {fmt.tokens(
            runs.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0),
          )}{" "}
          tokens
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text2)",
            fontWeight: 600,
          }}
        >
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
        <div style={ts.panel}>
          <div style={ts.header}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 22,
                  fontWeight: 700,
                  color: "var(--text1)",
                }}
              >
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
              <button
                onClick={() => onViewAutopsy(tradeId)}
                style={ts.autopsyBtn}
              >
                ⚕ Autopsy
              </button>
            )}
          </div>

          <div
            style={{
              overflowY: "auto",
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 0,
            }}
          >
            {trade.instrumentDisplayName ? (
              <div
                style={{
                  padding: "0 24px 14px",
                  color: "var(--text2)",
                  fontSize: 13,
                }}
              >
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

            <TradeOrderDetails trade={trade} />
            <TradeHarnessMessages messages={messages} />
            <TradeAgentRuns runs={runs} />

            {isOpen && (
              <div style={{ padding: "0 24px 28px" }}>
                <button
                  disabled={closing}
                  onClick={handleForceClose}
                  style={ts.forceCloseBtn}
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

const ts: Record<string, CSSProperties> = {
  outputText: {
    fontSize: 13,
    color: "var(--text2)",
    lineHeight: 1.65,
    background: "var(--surface2)",
    borderRadius: 8,
    padding: "12px 14px",
    fontStyle: "italic",
  },
  msgJsonPre: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--text2)",
    background: "var(--surface2)",
    borderRadius: 8,
    padding: 12,
    overflow: "auto",
    maxHeight: 280,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  toolCallsPre: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--text2)",
    background: "var(--surface2)",
    borderRadius: 8,
    padding: 12,
    overflow: "auto",
    maxHeight: 200,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  autopsyBtn: {
    padding: "5px 11px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text3)",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    flexShrink: 0,
  },
  priceMarkerBase: {
    position: "absolute",
    top: "50%",
    transform: "translate(-50%,-50%)",
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "var(--accent)",
    border: "2px solid var(--bg)",
    boxShadow: "0 0 8px var(--accent)",
  },
  panel: {
    width: 480,
    minHeight: "100%",
    background: "var(--surface)",
    borderLeft: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    animation: "slideIn 0.22s ease-out",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 24px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  hero: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    padding: "24px 24px 20px",
    borderBottom: "1px solid var(--border)",
  },
  heroLabel: {
    fontSize: 12,
    color: "var(--text3)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 8,
    fontWeight: 600,
  },
  secTitle: {
    fontSize: 12,
    color: "var(--text3)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 600,
  },
  forceCloseBtn: {
    width: "100%",
    padding: 12,
    background: "var(--color-error-dim)",
    border: "1px solid var(--color-error-border)",
    borderRadius: 10,
    color: "var(--color-error)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
  },
};
