// Developer Panel v2

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

const DevPanel = () => {
  const [minLevel, setMinLevel] = React.useState('DEBUG');
  const [agentFilter, setAgentFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [selectedId, setSelectedId] = React.useState(null);

  const filtered = MOCK_EVENTS.filter(ev => {
    if (LEVELS.indexOf(ev.level) < LEVELS.indexOf(minLevel)) return false;
    if (agentFilter !== 'all' && ev.agent_type !== agentFilter) return false;
    if (search && !ev.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const sel = selectedId ? MOCK_EVENTS.find(e => e.id === selectedId) : null;
  const selRuns = sel?.trade_id ? MOCK_AGENT_RUNS.filter(r => r.trade_id === sel.trade_id) : [];

  const levelColor = { DEBUG: '#374151', INFO: '#60a5fa', WARN: '#fbbf24', ERROR: '#f87171' };

  return (
    <PageShell>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text1)', margin: 0 }}>Developer</h1>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>Event log, agent traces, system diagnostics</p>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 16, minHeight: 0, overflow: 'hidden' }}>
        {/* Log panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', flexShrink: 0 }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search events…"
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', color: 'var(--text1)', fontSize: 12, outline: 'none', fontFamily: 'var(--font-mono)', width: 200 }} />

            <div style={{ display: 'flex', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {LEVELS.map(l => (
                <button key={l} onClick={() => setMinLevel(l)}
                  style={{ padding: '6px 10px', fontSize: 11, cursor: 'pointer', background: minLevel === l ? 'var(--surface3)' : 'transparent', border: 'none', color: minLevel === l ? levelColor[l] : 'var(--text3)', fontFamily: 'var(--font-mono)', fontWeight: minLevel === l ? 700 : 400, letterSpacing: '0.04em' }}>
                  {l}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {['all', 'researcher_bull', 'researcher_bear', 'reviewer', 'decision_maker'].map(a => (
                <button key={a} onClick={() => setAgentFilter(a)}
                  style={{ padding: '5px 9px', fontSize: 10, borderRadius: 6, cursor: 'pointer', background: agentFilter === a ? 'var(--surface3)' : 'transparent', border: `1px solid ${agentFilter === a ? 'var(--text3)' : 'var(--border)'}`, color: agentFilter === a ? 'var(--text2)' : 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                  {a === 'all' ? 'all' : a.replace('researcher_', 'res/')}
                </button>
              ))}
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dot color="#34d399" pulse size={6} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>{filtered.length} events</span>
            </div>
          </div>

          {/* Rows */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.map(ev => (
              <div key={ev.id} onClick={() => setSelectedId(ev.id === selectedId ? null : ev.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.03)', background: ev.id === selectedId ? 'var(--surface2)' : 'transparent', borderLeft: `3px solid ${ev.id === selectedId ? 'var(--accent)' : levelColor[ev.level] + '60'}`, transition: 'background 0.1s' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', width: 44, flexShrink: 0 }}>{fmt.time(ev.created_at)}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: levelColor[ev.level], width: 40, flexShrink: 0, letterSpacing: '0.04em' }}>{ev.level}</span>
                {ev.agent_type && <AgentLabel type={ev.agent_type} />}
                {ev.trade_id && <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', background: 'var(--surface3)', padding: '1px 6px', borderRadius: 4 }}>{ev.trade_id}</span>}
                <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1, lineHeight: 1.4 }}>{ev.message}</span>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No events match filters</div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div style={{ width: 320, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {sel ? (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {/* Event metadata */}
              <div style={{ padding: '18px 18px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14, fontWeight: 600 }}>Event</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[['Level', sel.level], ['Time', sel.created_at.replace('T', ' ').replace('Z', '')], ['Trade', sel.trade_id || '—'], ['Agent', sel.agent_type || '—']].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', gap: 10 }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)', width: 44, flexShrink: 0, paddingTop: 1 }}>{k}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text2)', flex: 1, wordBreak: 'break-all' }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--text1)', lineHeight: 1.55 }}>{sel.message}</span>
                  </div>
                </div>
              </div>

              {/* Agent runs */}
              {selRuns.length > 0 && (
                <div style={{ padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14, fontWeight: 600 }}>Agent Runs · {sel.trade_id}</div>
                  {selRuns.map(r => {
                    const ac = { researcher_bull: '#34d399', researcher_bear: '#f87171', reviewer: '#60a5fa', decision_maker: '#a78bfa' };
                    return (
                      <div key={r.id} style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', borderLeft: `3px solid ${ac[r.agent_type]}` }}>
                        <div style={{ padding: '8px 12px', background: 'var(--surface2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <AgentLabel type={r.agent_type} />
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginLeft: 'auto' }}>
                            {fmt.tokens(r.input_tokens + r.output_tokens)} · {fmt.usd(r.cost_usd, 4)} · {fmt.duration(r.duration_ms)}
                          </span>
                        </div>
                        <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text2)', lineHeight: 1.6, fontStyle: 'italic' }}>
                          "{r.output_text}"
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '18px 18px', overflow: 'auto', flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, fontWeight: 600 }}>System</div>
              {[['Runtime', 'Electron / TypeScript'], ['Database', 'SQLite · exva.db'], ['Broker', 'Alpaca Paper'], ['Model', 'claude-sonnet'], ['Session ID', 'sess-20260421-001'], ['Uptime', fmt.uptime(MOCK_DASHBOARD_STATS.session_uptime_min)], ['Events', `${MOCK_EVENTS.length}`], ['Agent runs', `${MOCK_AGENT_RUNS.length}`]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>{k}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)' }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 9, fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
                Click any event row to inspect detail and agent traces
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
};

Object.assign(window, { DevPanel });
