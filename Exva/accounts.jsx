// Accounts + Trades page v2

const InputField = ({ label, hint, type = 'text', value, onChange, placeholder, mono }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)' }}>{label}</label>
      {hint && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{hint}</span>}
    </div>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 14px', color: 'var(--text1)', fontSize: 13, outline: 'none', fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)', letterSpacing: mono ? '0.04em' : 'normal', transition: 'border-color 0.15s' }} />
  </div>
);

const ConnBadge = ({ ok }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 20, background: ok ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${ok ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}` }}>
    <Dot color={ok ? '#34d399' : '#f87171'} size={6} />
    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: ok ? '#34d399' : '#f87171', fontWeight: 600 }}>{ok ? 'Connected' : 'Error'}</span>
  </div>
);

const AccountsPage = () => {
  const [anthropicKey, setAnthropicKey]   = React.useState('sk-ant-•••••••••••••••••••');
  const [alpacaKey, setAlpacaKey]         = React.useState('PK••••••••••••••••');
  const [alpacaSecret, setAlpacaSecret]   = React.useState('••••••••••••••••••••••••••••••••');
  const [alpacaMode, setAlpacaMode]       = React.useState('paper');
  const [testing, setTesting]             = React.useState(false);
  const [status, setStatus]               = React.useState({ broker: true, ai: true });

  const test = () => {
    setTesting(true);
    setTimeout(() => { setTesting(false); setStatus({ broker: true, ai: true }); }, 1400);
  };

  return (
    <PageShell>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text1)', margin: 0 }}>Accounts</h1>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>API keys stored in OS keychain — never written to disk or logs</p>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Anthropic */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)', marginBottom: 3 }}>Anthropic</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>Powers all AI agents — researcher, reviewer, decision maker</div>
              </div>
              <ConnBadge ok={status.ai} />
            </div>
            <InputField label="API Key" hint="stored in OS keychain" type="password"
              value={anthropicKey} onChange={setAnthropicKey} placeholder="sk-ant-..." mono />
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)', borderRadius: 9 }}>
              <span style={{ fontSize: 12, color: '#34d399' }}>Prompt caching active</span>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>— saves ~30–40% on repeated agent calls</span>
            </div>
          </Card>

          {/* Broker */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)', marginBottom: 3 }}>Broker — Alpaca</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>Trade execution and portfolio data</div>
              </div>
              <ConnBadge ok={status.broker} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[['paper', '🧪 Paper Trading'], ['live', '⚡ Live Trading']].map(([m, lbl]) => (
                <button key={m} onClick={() => setAlpacaMode(m)}
                  style={{ flex: 1, padding: '9px 14px', fontSize: 13, borderRadius: 9, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'var(--font-sans)', fontWeight: alpacaMode === m ? 600 : 400,
                    background: alpacaMode === m ? (m === 'live' ? 'rgba(248,113,113,0.12)' : 'rgba(96,165,250,0.1)') : 'var(--surface2)',
                    border: alpacaMode === m ? (m === 'live' ? '1px solid rgba(248,113,113,0.3)' : '1px solid rgba(96,165,250,0.3)') : '1px solid var(--border)',
                    color: alpacaMode === m ? (m === 'live' ? '#f87171' : '#60a5fa') : 'var(--text2)' }}>
                  {lbl}
                </button>
              ))}
            </div>
            {alpacaMode === 'live' && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 9 }}>
                <span style={{ fontSize: 12, color: '#f87171', fontWeight: 500 }}>Live mode — trades will use real money and execute on the market</span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <InputField label="API Key ID" type="password" value={alpacaKey} onChange={setAlpacaKey} placeholder="PKXXXXXXXX" mono />
              <InputField label="Secret Key" type="password" value={alpacaSecret} onChange={setAlpacaSecret} placeholder="Secret…" mono />
            </div>
          </Card>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Web search */}
          <Card>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)', marginBottom: 3 }}>Web Search</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Researcher agents use this to fetch live news and market data</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {['Brave', 'Tavily'].map(p => (
                <div key={p} style={{ flex: 1, padding: '14px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 500 }}>{p}</span>
                  <Badge variant="default" size="sm">configure</Badge>
                </div>
              ))}
            </div>
          </Card>

          {/* Security */}
          <Card accent>
            <SectionTitle>Security Model</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              {[
                ['OS Keychain',   'Secrets stored in system keychain, never SQLite'],
                ['In-memory only','Keys retrieved at call time, not held in process'],
                ['Never logged',  'Log macros only reference IDs — no key values'],
                ['No cloud sync', 'Local-only app — no data leaves this device'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ color: '#34d399', fontSize: 13, flexShrink: 0, marginTop: 1 }}>✓</span>
                  <div>
                    <span style={{ fontSize: 13, color: 'var(--text1)', fontWeight: 500 }}>{k}</span>
                    <span style={{ fontSize: 13, color: 'var(--text3)' }}> — {v}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={test} disabled={testing}
              style={{ flex: 1, padding: '11px 20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 500 }}>
              {testing ? 'Testing…' : 'Test Connections'}
            </button>
            <button style={{ flex: 1, padding: '11px 20px', background: 'var(--accent)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
              Save Keys
            </button>
          </div>
        </div>
      </div>
    </PageShell>
  );
};

// Trades page
const TradesPage = ({ onSelectTrade, selectedTradeId }) => {
  const [filter, setFilter] = React.useState('all');
  const trades  = MOCK_TRADES.filter(t => filter === 'all' || t.status === filter);
  const closed  = MOCK_TRADES.filter(t => t.status === 'closed');
  const wins    = closed.filter(t => t.final_pnl_usd > 0);
  const realPnl = closed.reduce((s, t) => s + (t.final_pnl_usd || 0), 0);

  return (
    <PageShell>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text1)', margin: 0 }}>Trades</h1>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>All trade history and open positions</p>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 14 }}>
        {[
          ['Realized P&L', fmt.pnl(realPnl), realPnl >= 0 ? '#34d399' : '#f87171'],
          ['Win Rate', closed.length ? `${Math.round(wins.length/closed.length*100)}%` : '—', 'var(--text1)'],
          ['Total Trades', MOCK_TRADES.length, 'var(--text1)'],
          ['Open', MOCK_TRADES.filter(t => t.status === 'open').length, '#60a5fa'],
        ].map(([lbl, val, color]) => (
          <Card key={lbl} style={{ flex: 1, padding: '18px 22px' }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontWeight: 600 }}>{lbl}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
          </Card>
        ))}
      </div>

      {/* Filter + table */}
      <Card style={{ padding: '0 0', overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 6, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          {['all', 'open', 'closed'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: '5px 14px', fontSize: 12, borderRadius: 7, cursor: 'pointer', background: filter === s ? 'var(--surface3)' : 'transparent', border: `1px solid ${filter === s ? 'var(--border)' : 'transparent'}`, color: filter === s ? 'var(--text1)' : 'var(--text3)', fontFamily: 'var(--font-sans)' }}>
              {s}
            </button>
          ))}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 60px 70px 90px 90px 90px 80px 60px 55px 60px', padding: '10px 20px 8px', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, borderBottom: '1px solid var(--border)', minWidth: 780 }}>
            {['Asset', 'Side', 'Size', 'Entry', 'Cur/Exit', 'P&L', 'AI Cost', 'Conf', 'Status', 'Time'].map(h => <span key={h}>{h}</span>)}
          </div>
          {trades.map(t => {
            const isOpen = t.status === 'open';
            const pnl    = isOpen ? t.unrealized_pnl : t.final_pnl_usd;
            const pos    = pnl >= 0;
            return (
              <div key={t.id} onClick={() => onSelectTrade(t.id === selectedTradeId ? null : t.id)}
                style={{ display: 'grid', gridTemplateColumns: '130px 60px 70px 90px 90px 90px 80px 60px 55px 60px', padding: '11px 20px', gap: 0, alignItems: 'center', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: t.id === selectedTradeId ? 'var(--surface2)' : 'transparent', transition: 'background 0.1s', minWidth: 780 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--text1)' }}>{t.asset}</span>
                <Badge variant={t.side === 'BUY' ? 'success' : 'danger'} size="sm">{t.side}</Badge>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)' }}>{fmt.usd(t.position_size_usd, 0)}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)' }}>{fmt.usd(t.entry_price)}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)' }}>{isOpen ? fmt.usd(t.current_price) : '—'}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: pos ? '#34d399' : '#f87171', fontWeight: 600 }}>{pnl != null ? fmt.pnl(pnl) : '—'}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>{fmt.usd(t.ai_cost_usd, 3)}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)' }}>{t.confidence_score ? `${Math.round(t.confidence_score * 100)}%` : '—'}</span>
                <Badge variant={t.status === 'open' ? 'success' : 'default'} size="sm">{t.status}</Badge>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>{fmt.time(t.opened_at)}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </PageShell>
  );
};

Object.assign(window, { AccountsPage, TradesPage });
