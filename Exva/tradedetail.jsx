// Trade Detail v2

const AgentTrace = ({ run }) => {
  const [open, setOpen] = React.useState(false);
  const palette = {
    researcher_bull: { bar: '#34d399', bg: 'rgba(52,211,153,0.06)' },
    researcher_bear: { bar: '#f87171', bg: 'rgba(248,113,113,0.06)' },
    reviewer:        { bar: '#60a5fa', bg: 'rgba(96,165,250,0.06)'  },
    decision_maker:  { bar: '#a78bfa', bg: 'rgba(167,139,250,0.06)' },
  };
  const p = palette[run.agent_type] || { bar: 'var(--text3)', bg: 'var(--surface2)' };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', background: p.bg, borderLeft: `3px solid ${p.bar}` }}>
        <AgentLabel type={run.agent_type} />
        <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>
          {fmt.tokens(run.input_tokens + run.output_tokens)} tok · {fmt.usd(run.cost_usd, 4)} · {fmt.duration(run.duration_ms)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ padding: '14px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 20 }}>
            {[['In', `${fmt.tokens(run.input_tokens)} tok`], ['Out', `${fmt.tokens(run.output_tokens)} tok`], ['Cost', fmt.usd(run.cost_usd, 4)], ['Time', fmt.duration(run.duration_ms)]].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{k}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)' }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.65, background: 'var(--surface2)', borderRadius: 8, padding: '12px 14px', fontStyle: 'italic', borderLeft: `3px solid ${p.bar}` }}>
            "{run.output_text}"
          </div>
        </div>
      )}
    </div>
  );
};

const TradeDetail = ({ tradeId, onClose }) => {
  const trade = MOCK_TRADES.find(t => t.id === tradeId);
  const runs  = MOCK_AGENT_RUNS.filter(r => r.trade_id === tradeId);
  if (!trade) return null;

  const isOpen = trade.status === 'open';
  const pnl    = isOpen ? trade.unrealized_pnl : trade.final_pnl_usd;
  const pos    = pnl >= 0;

  return (
    <div style={tdStyles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={tdStyles.panel}>
        {/* Header */}
        <div style={tdStyles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--text1)' }}>{trade.asset}</span>
            <Badge variant={trade.side === 'BUY' ? 'success' : 'danger'}>{trade.side}</Badge>
            <Badge variant={isOpen ? 'success' : 'default'}>{trade.status}</Badge>
          </div>
          <button onClick={onClose} style={tdStyles.closeBtn}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* P&L hero */}
          <div style={tdStyles.hero}>
            <div>
              <div style={tdStyles.heroLabel}>{isOpen ? 'Unrealized P&L' : 'Final P&L'}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 40, fontWeight: 700, color: pos ? '#34d399' : '#f87171', lineHeight: 1 }}>
                {pnl != null ? fmt.pnl(pnl) : '—'}
              </div>
              {pnl != null && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: pos ? '#34d399' : '#f87171', marginTop: 4 }}>
                  {fmt.pct(pnl / trade.position_size_usd)}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={tdStyles.heroLabel}>Confidence</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 40, fontWeight: 700, color: 'var(--text1)', lineHeight: 1 }}>
                {Math.round(trade.confidence_score * 100)}%
              </div>
            </div>
          </div>

          {/* Risk bar */}
          {isOpen && (
            <div style={{ padding: '0 24px 20px' }}>
              <div style={tdStyles.secTitle}>Position</div>
              {(() => {
                const lo = trade.stop_loss_price, hi = trade.take_profit_price;
                const cur = trade.current_price, en = trade.entry_price;
                const range = hi - lo;
                const entryPct = ((en - lo) / range) * 100;
                const curPct   = ((cur - lo) / range) * 100;
                return (
                  <div>
                    <div style={{ position: 'relative', height: 36, background: 'var(--surface2)', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(248,113,113,0.18) 0%, transparent 38%, transparent 62%, rgba(52,211,153,0.18) 100%)' }} />
                      <div style={{ position: 'absolute', left: `${entryPct}%`, top: 6, bottom: 6, width: 1.5, background: 'rgba(255,255,255,0.25)', borderRadius: 1 }} />
                      <div style={{ position: 'absolute', left: `${curPct}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 12, height: 12, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--bg)', boxShadow: '0 0 8px var(--accent)' }} />
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#f87171', fontFamily: 'var(--font-mono)' }}>{fmt.usd(lo)}</span>
                      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#34d399', fontFamily: 'var(--font-mono)' }}>{fmt.usd(hi)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10, color: 'var(--text3)' }}>
                      <span>Stop Loss</span><span>● current price</span><span>Take Profit</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Details grid */}
          <div style={{ padding: '0 24px 20px', borderTop: '1px solid var(--border)', paddingTop: 20 }}>
            <div style={tdStyles.secTitle}>Order Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
              {[
                ['Position Size', fmt.usd(trade.position_size_usd)],
                ['Broker ID',     trade.broker_order_id || '—'],
                ['Stop Loss',     fmt.usd(trade.stop_loss_price)],
                ['Take Profit',   fmt.usd(trade.take_profit_price)],
                ['Opened',        fmt.time(trade.opened_at)],
                ['Closed',        trade.closed_at ? fmt.time(trade.closed_at) : '—'],
                ['AI Cost',       fmt.usd(trade.ai_cost_usd, 4)],
                ['Strategy',      trade.strategy],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{k}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text1)', fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Agent traces */}
          {runs.length > 0 && (
            <div style={{ padding: '0 24px 20px', borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              <div style={{ ...tdStyles.secTitle, marginBottom: 12 }}>Agent Traces</div>
              {runs.map(r => <AgentTrace key={r.id} run={r} />)}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>Total · {fmt.tokens(runs.reduce((s,r) => s + r.input_tokens + r.output_tokens, 0))} tokens</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>{fmt.usd(runs.reduce((s,r) => s + r.cost_usd, 0), 4)}</span>
              </div>
            </div>
          )}

          {isOpen && (
            <div style={{ padding: '0 24px 28px' }}>
              <button style={tdStyles.forceCloseBtn}>Force Close Position</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const tdStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'flex-end', zIndex: 100, backdropFilter: 'blur(2px)' },
  panel:   { width: 480, height: '100%', background: 'var(--surface)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', animation: 'slideIn 0.22s ease-out' },
  header:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  closeBtn:{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 18, padding: '2px 6px', borderRadius: 6 },
  hero:    { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '24px 24px 20px', borderBottom: '1px solid var(--border)' },
  heroLabel: { fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontWeight: 600 },
  secTitle:{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 },
  forceCloseBtn: { width: '100%', padding: '12px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 10, color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)' },
};

Object.assign(window, { TradeDetail });
