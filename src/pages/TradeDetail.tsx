import { useEffect, useState, type CSSProperties } from "react";
import { AgentLabel, Badge } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import { api } from "@/lib/exva";
import type { AgentMessage, AgentRun, Trade, TradeAutopsy } from "@/lib/types";
import { Button, Dialog, DialogContent } from "@/components/ui";

const PALETTE: Record<string, { bar: string; bg: string }> = {
  analyst_technical: { bar: "#34d399", bg: "rgba(52,211,153,0.06)" },
  analyst_fundamental: { bar: "#f87171", bg: "rgba(248,113,113,0.06)" },
  reviewer: { bar: "#60a5fa", bg: "rgba(96,165,250,0.06)" },
  decision_maker: { bar: "#a78bfa", bg: "rgba(167,139,250,0.06)" },
  instrument_selector: { bar: "#fbbf24", bg: "rgba(251,191,36,0.08)" },
};

function previewJson(raw: string | null, max = 2400): string {
  if (raw == null || raw === "") return "—";
  try {
    const parsed: unknown = JSON.parse(raw);
    const s = JSON.stringify(parsed, null, 2);
    return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
  } catch {
    return raw.length > max ? `${raw.slice(0, max)}…` : raw;
  }
}

const AgentTrace = ({ run }: { run: AgentRun }) => {
  const [open, setOpen] = useState(false);
  const p = PALETTE[run.agent_type] ?? { bar: "var(--text3)", bg: "var(--surface2)" };
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "11px 14px",
          cursor: "pointer", background: p.bg, borderLeft: `3px solid ${p.bar}`,
        }}
      >
        <AgentLabel type={run.agent_type} />
        <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)" }}>
          {run.provider_key.replace(/^provider-/, "")} · {run.finish_reason} · {fmt.tokens(run.input_tokens + run.output_tokens)} tok ·{" "}
          {fmt.usd(run.cost_usd, 4)} · {fmt.duration(run.duration_ms)}
        </span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: 14, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 12 }}>
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
                <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{k}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text2)" }}>{v}</div>
              </div>
            ))}
          </div>
          <div
            style={{
              fontSize: 13, color: "var(--text2)", lineHeight: 1.65,
              background: "var(--surface2)", borderRadius: 8, padding: "12px 14px",
              fontStyle: "italic", borderLeft: `3px solid ${p.bar}`,
            }}
          >
            "{run.output_text}"
          </div>
        </div>
      )}
    </div>
  );
};

const MessageTrace = ({ msg }: { msg: AgentMessage }) => {
  const [open, setOpen] = useState(false);
  const p = PALETTE[msg.role] ?? { bar: "var(--text3)", bg: "var(--surface2)" };
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div
        onClick={() => setOpen((o) => !o)}
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
        <AgentLabel type={msg.role} />
        <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)" }}>
          {msg.provider_key.replace(/^provider-/, "")} · {msg.model_id}
          {msg.cycle_id ? ` · cycle ${msg.cycle_id.slice(0, 8)}…` : ""}
        </span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
          <pre
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.45,
              color: "var(--text2)",
              background: "var(--surface2)",
              borderRadius: 8,
              padding: 12,
              overflow: "auto",
              maxHeight: 280,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {previewJson(msg.messages_json)}
          </pre>
          {msg.tool_calls_json ? (
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 6 }}>Tool calls</div>
              <pre
                style={{
                  margin: 0,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: "var(--text2)",
                  background: "var(--surface2)",
                  borderRadius: 8,
                  padding: 12,
                  overflow: "auto",
                  maxHeight: 200,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {previewJson(msg.tool_calls_json, 1600)}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export const TradeDetail = ({ tradeId, onClose }: { tradeId: string; onClose: () => void }) => {
  const [trade, setTrade] = useState<Trade | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [autopsies, setAutopsies] = useState<TradeAutopsy[]>([]);
  const [autopsyLoading, setAutopsyLoading] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getTradeDetail(tradeId).then((d) => {
      if (cancelled) return;
      setTrade(d.trade);
      setRuns(d.runs);
      setMessages(d.messages ?? []);
    }).catch(() => {});
    api.listTradeAutopsies(tradeId).then((rows) => {
      if (!cancelled) setAutopsies(rows);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [tradeId]);

  const handleForceClose = async () => {
    setClosing(true);
    try {
      await api.forceCloseTrade(tradeId);
      onClose();
    } finally {
      setClosing(false);
    }
  };

  const handleGenerateAutopsy = async () => {
    setAutopsyLoading(true);
    try {
      const row = await api.summarizeTradeAutopsy(tradeId);
      setAutopsies((prev) => [row, ...prev]);
    } finally {
      setAutopsyLoading(false);
    }
  };

  if (!trade) return null;
  const isOpen = trade.status === "open";
  const pnl = (isOpen ? trade.unrealized_pnl : trade.final_pnl_usd) ?? null;
  const pos = pnl != null && pnl >= 0;

  return (
    <Dialog open={!!trade} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="h-[92vh] max-w-[96vw] overflow-auto border-border bg-transparent p-0 sm:max-w-[480px]">
      <div style={ts.panel}>
        <div style={ts.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: "var(--text1)" }}>
              {trade.instrumentSymbol}
            </span>
            {trade.predictionOutcome ? <Badge variant="purple">{trade.predictionOutcome}</Badge> : null}
            <Badge variant={trade.side === "BUY" ? "success" : "danger"}>{trade.side}</Badge>
            <Badge variant={isOpen ? "success" : "default"}>{trade.status}</Badge>
          </div>
          <Button onClick={onClose} variant="ghost" className="h-auto p-1 text-[var(--text3)]">✕</Button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 0 }}>
          {trade.instrumentDisplayName ? (
            <div style={{ padding: "0 24px 14px", color: "var(--text2)", fontSize: 13 }}>{trade.instrumentDisplayName}</div>
          ) : null}

          <div style={ts.hero}>
            <div>
              <div style={ts.heroLabel}>{isOpen ? "Unrealized P&L" : "Final P&L"}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 40, fontWeight: 700, color: pos ? "#34d399" : "#f87171", lineHeight: 1 }}>
                {pnl != null ? fmt.pnl(pnl) : "—"}
              </div>
              {pnl != null && (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: pos ? "#34d399" : "#f87171", marginTop: 4 }}>
                  {fmt.pct(pnl / trade.position_size_usd)}
                </div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={ts.heroLabel}>Confidence</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 40, fontWeight: 700, color: "var(--text1)", lineHeight: 1 }}>
                {Math.round((trade.confidence_score ?? 0) * 100)}%
              </div>
            </div>
          </div>

          {isOpen && trade.stop_loss_price != null && trade.take_profit_price != null && trade.current_price != null && trade.entry_price != null && (
            <div style={{ padding: "0 24px 20px" }}>
              <div style={ts.secTitle}>Position</div>
              {(() => {
                const lo = trade.stop_loss_price ?? 0;
                const hi = trade.take_profit_price ?? 0;
                const cur = trade.current_price ?? 0;
                const en = trade.entry_price ?? 0;
                const range = hi - lo;
                const entryPct = ((en - lo) / range) * 100;
                const curPct = Math.max(0, Math.min(100, ((cur - lo) / range) * 100));
                return (
                  <div>
                    <div style={{ position: "relative", height: 36, background: "var(--surface2)", borderRadius: 8, overflow: "hidden" }}>
                      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(248,113,113,0.18) 0%, transparent 38%, transparent 62%, rgba(52,211,153,0.18) 100%)" }} />
                      <div style={{ position: "absolute", left: `${entryPct}%`, top: 6, bottom: 6, width: 1.5, background: "rgba(255,255,255,0.25)", borderRadius: 1 }} />
                      <div style={{ position: "absolute", left: `${curPct}%`, top: "50%", transform: "translate(-50%,-50%)", width: 12, height: 12, borderRadius: "50%", background: "var(--accent)", border: "2px solid var(--bg)", boxShadow: "0 0 8px var(--accent)" }} />
                      <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#f87171", fontFamily: "var(--font-mono)" }}>{fmt.usd(lo)}</span>
                      <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#34d399", fontFamily: "var(--font-mono)" }}>{fmt.usd(hi)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10, color: "var(--text3)" }}>
                      <span>Stop Loss</span><span>● current price</span><span>Take Profit</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div style={{ padding: "0 24px 20px", borderTop: "1px solid var(--border)", paddingTop: 20 }}>
            <div style={ts.secTitle}>Order Details</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
              {(
                [
                  ["Position Size", fmt.usd(trade.position_size_usd)],
                  ["Display Name", trade.instrumentDisplayName ?? "—"],
                  ["Outcome", trade.predictionOutcome ?? "—"],
                  ["Broker ID", trade.broker_order_id ?? "—"],
                  ["Stop Loss", trade.stop_loss_price != null ? fmt.usd(trade.stop_loss_price) : "—"],
                  ["Take Profit", trade.take_profit_price != null ? fmt.usd(trade.take_profit_price) : "—"],
                  ["Opened", trade.opened_at ? fmt.time(trade.opened_at) : "—"],
                  ["Closed", trade.closed_at ? fmt.time(trade.closed_at) : "—"],
                  ["AI Cost", fmt.usd(trade.ai_cost_usd, 4)],
                  ["Strategy", trade.strategy],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{k}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text1)", fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {messages.length > 0 && (
            <div style={{ padding: "0 24px 20px", borderTop: "1px solid var(--border)", paddingTop: 20 }}>
              <div style={{ ...ts.secTitle, marginBottom: 12 }}>Harness messages</div>
              {messages.map((m) => (
                <MessageTrace key={m.id} msg={m} />
              ))}
            </div>
          )}

          {runs.length > 0 && (
            <div style={{ padding: "0 24px 20px", borderTop: "1px solid var(--border)", paddingTop: 20 }}>
              <div style={{ ...ts.secTitle, marginBottom: 12 }}>Agent runs</div>
              {runs.map((r) => <AgentTrace key={r.id} run={r} />)}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, padding: "10px 14px", background: "var(--surface2)", borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  Total · {fmt.tokens(runs.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0))} tokens
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>
                  {fmt.usd(runs.reduce((s, r) => s + r.cost_usd, 0), 4)}
                </span>
              </div>
            </div>
          )}

          {!isOpen && (
            <div style={{ padding: "0 24px 20px", borderTop: "1px solid var(--border)", paddingTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={ts.secTitle}>Trade autopsy</div>
                <button
                  onClick={handleGenerateAutopsy}
                  disabled={autopsyLoading}
                  style={{
                    padding: "6px 10px",
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface2)",
                    color: "var(--text2)",
                  }}
                >
                  {autopsyLoading ? "Generating…" : "Generate autopsy"}
                </button>
              </div>
              {autopsies.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text3)" }}>No autopsy yet.</div>
              ) : (
                autopsies.map((a) => (
                  <div key={a.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--surface2)", marginBottom: 8 }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)", marginBottom: 6 }}>
                      {a.model_id} · {fmt.time(a.created_at)}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{a.summary}</div>
                  </div>
                ))
              )}
            </div>
          )}

          {isOpen && (
            <div style={{ padding: "0 24px 28px" }}>
              <button disabled={closing} onClick={handleForceClose} style={ts.forceCloseBtn}>
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
  panel: {
    width: 480, minHeight: "100%", background: "var(--surface)",
    borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column",
    animation: "slideIn 0.22s ease-out",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "20px 24px", borderBottom: "1px solid var(--border)", flexShrink: 0,
  },
  hero: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-end",
    padding: "24px 24px 20px", borderBottom: "1px solid var(--border)",
  },
  heroLabel: {
    fontSize: 11, color: "var(--text3)", textTransform: "uppercase",
    letterSpacing: "0.08em", marginBottom: 8, fontWeight: 600,
  },
  secTitle: {
    fontSize: 11, color: "var(--text3)", textTransform: "uppercase",
    letterSpacing: "0.08em", fontWeight: 600,
  },
  forceCloseBtn: {
    width: "100%", padding: 12, background: "rgba(248,113,113,0.1)",
    border: "1px solid rgba(248,113,113,0.25)", borderRadius: 10,
    color: "#f87171", fontSize: 13, fontWeight: 600, cursor: "pointer",
    fontFamily: "var(--font-sans)",
  },
};
