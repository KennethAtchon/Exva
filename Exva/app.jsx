// App v2

const App = () => {
  const [page, setPage]               = React.useState('dashboard');
  const [sessionStatus, setSession]   = React.useState('active');
  const [selectedTrade, setTrade]     = React.useState(null);
  const [tweaksVisible, setTweaks]    = React.useState(false);
  const [tweaks, setTweakState]       = React.useState(window.__TWEAK_DEFAULTS || {});

  // Tweaks host protocol
  React.useEffect(() => {
    const handler = e => {
      if (e.data?.type === '__activate_edit_mode')   setTweaks(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaks(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const applyVars = (t) => {
    const r = document.documentElement;
    if (t.accentColor)   r.style.setProperty('--accent',       t.accentColor);
    if (t.bgColor)       r.style.setProperty('--bg',           t.bgColor);
    if (t.surfaceColor)  r.style.setProperty('--surface',      t.surfaceColor);
    if (t.surface2Color) r.style.setProperty('--surface2',     t.surface2Color);
    if (t.fontMono)      r.style.setProperty('--font-mono',    t.fontMono);
  };

  React.useEffect(() => { applyVars(tweaks); }, []);

  const applyTweak = (key, val) => {
    const next = { ...tweaks, [key]: val };
    setTweakState(next);
    applyVars(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
  };

  const handleSession = action => {
    if (action === 'start' || action === 'resume') setSession('active');
    if (action === 'pause')  setSession('paused');
    if (action === 'stop')   setSession('stopped');
  };

  const handleTrade = id => setTrade(prev => prev === id ? null : id);

  const pageEl = () => {
    switch (page) {
      case 'dashboard': return <Dashboard onSelectTrade={handleTrade} selectedTradeId={selectedTrade} />;
      case 'trades':    return <TradesPage onSelectTrade={handleTrade} selectedTradeId={selectedTrade} />;
      case 'strategy':  return <StrategyConfig />;
      case 'costs':     return <CostBreakdown />;
      case 'devpanel':  return <DevPanel />;
      case 'accounts':  return <AccountsPage />;
      default:          return <Dashboard onSelectTrade={handleTrade} selectedTradeId={selectedTrade} />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', background: 'var(--bg)', color: 'var(--text1)', fontFamily: 'var(--font-sans)' }}>
      <TopNav
        activePage={page}
        onNavigate={p => { setPage(p); setTrade(null); }}
        sessionStatus={sessionStatus}
        onSessionAction={handleSession}
        stats={MOCK_DASHBOARD_STATS}
      />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {pageEl()}
      </div>

      {selectedTrade && (
        <TradeDetail tradeId={selectedTrade} onClose={() => setTrade(null)} />
      )}

      {/* Tweaks panel */}
      {tweaksVisible && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, width: 288, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 12px 48px rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text1)' }}>Tweaks</span>
            <button onClick={() => setTweaks(false)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {[
              {
                label: 'Accent',
                options: [
                  { label: 'Blue',   val: 'oklch(0.65 0.14 240)' },
                  { label: 'Teal',   val: 'oklch(0.65 0.14 195)' },
                  { label: 'Purple', val: 'oklch(0.65 0.14 290)' },
                  { label: 'Amber',  val: 'oklch(0.78 0.14 75)'  },
                ],
                key: 'accentColor', current: tweaks.accentColor,
              },
              {
                label: 'Background',
                options: [
                  { label: 'Darkest', val: '#080b10' },
                  { label: 'Dark',    val: '#0d1117' },
                  { label: 'Slate',   val: '#090d14' },
                  { label: 'Warm',    val: '#0c0e0e' },
                ],
                key: 'bgColor', current: tweaks.bgColor,
              },
              {
                label: 'Mono Font',
                options: [
                  { label: 'JetBrains', val: "'JetBrains Mono', monospace" },
                  { label: 'Fira',      val: "'Fira Code', monospace"      },
                  { label: 'Courier',   val: "'Courier New', monospace"    },
                ],
                key: 'fontMono', current: tweaks.fontMono,
              },
            ].map(group => (
              <div key={group.label}>
                <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontWeight: 700 }}>{group.label}</div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {group.options.map(opt => (
                    <button key={opt.label} onClick={() => applyTweak(group.key, opt.val)}
                      style={{ flex: 1, padding: '6px 4px', fontSize: 11, borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 0.12s',
                        background: group.current === opt.val ? 'var(--surface3)' : 'var(--surface2)',
                        border:     `1px solid ${group.current === opt.val ? 'var(--accent)' : 'var(--border)'}`,
                        color:      group.current === opt.val ? 'var(--text1)' : 'var(--text3)',
                        fontWeight: group.current === opt.val ? 600 : 400 }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
