// Strategy Config v2

const Slider = ({ label, hint, value, min, max, step, format, onChange }) => {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={cfgS.field}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div>
          <span style={cfgS.fieldLabel}>{label}</span>
          {hint && <span style={cfgS.hint}> — {hint}</span>}
        </div>
        <span style={cfgS.fieldVal}>{format ? format(value) : value}</span>
      </div>
      <div style={{ position: 'relative', height: 4, background: 'var(--surface3)', borderRadius: 2 }}>
        <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: `calc(${pct}% - 7px)`, top: -5, width: 14, height: 14, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--bg)', pointerEvents: 'none' }} />
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ position: 'absolute', inset: '-10px 0', opacity: 0, width: '100%', cursor: 'pointer' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
        <span style={cfgS.rangeHint}>{format ? format(min) : min}</span>
        <span style={cfgS.rangeHint}>{format ? format(max) : max}</span>
      </div>
    </div>
  );
};

const SegmentedControl = ({ label, hint, value, options, onChange }) => (
  <div style={cfgS.field}>
    <div style={{ marginBottom: 10 }}>
      <span style={cfgS.fieldLabel}>{label}</span>
      {hint && <span style={cfgS.hint}> — {hint}</span>}
    </div>
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          style={{ ...cfgS.seg, ...(value === opt.value ? cfgS.segActive : {}) }}>
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

const Toggle = ({ label, hint, value, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
    <div>
      <div style={cfgS.fieldLabel}>{label}</div>
      {hint && <div style={{ ...cfgS.hint, marginTop: 3, display: 'block' }}>{hint}</div>}
    </div>
    <div onClick={() => onChange(!value)}
      style={{ width: 42, height: 24, borderRadius: 12, background: value ? 'var(--accent)' : 'var(--surface3)', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginTop: 2 }}>
      <div style={{ position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', left: value ? 21 : 3, boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }} />
    </div>
  </div>
);

const StrategyConfig = () => {
  const [cfg, setCfg] = React.useState({
    strategy: 'passive_income', max_position_usd: 500, stop_loss_pct: 2.0,
    take_profit_pct: 4.0, max_concurrent_trades: 3, research_depth: 'balanced',
    daily_loss_limit_usd: 200, profit_target_usd: 1000, max_api_spend_usd: 5.0,
    human_approval_required: false,
  });
  const [saved, setSaved] = React.useState(false);
  const set = (k, v) => { setCfg(c => ({ ...c, [k]: v })); setSaved(false); };
  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const rrRatio = (cfg.take_profit_pct / cfg.stop_loss_pct).toFixed(1);
  const worstCase = (cfg.max_position_usd * cfg.stop_loss_pct / 100).toFixed(2);
  const bestCase  = (cfg.max_position_usd * cfg.take_profit_pct / 100).toFixed(2);

  return (
    <PageShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text1)', margin: 0 }}>Strategy</h1>
          <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>Trading parameters and risk controls</p>
        </div>
        <button onClick={save} style={{ padding: '9px 22px', background: saved ? '#34d399' : 'var(--accent)', border: 'none', borderRadius: 9, color: saved ? '#0a1a12' : '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 0.2s' }}>
          {saved ? '✓ Saved' : 'Save Config'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        {/* Left */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <SectionTitle>Mode</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 18 }}>
              <SegmentedControl label="Strategy" value={cfg.strategy}
                options={[{ value: 'passive_income', label: 'Passive Income' }, { value: 'growth', label: 'Growth' }, { value: 'conservative', label: 'Conservative' }]}
                onChange={v => set('strategy', v)} />
              <SegmentedControl label="Research Depth" hint="affects latency and AI cost"
                value={cfg.research_depth}
                options={[{ value: 'light', label: 'Light' }, { value: 'balanced', label: 'Balanced' }, { value: 'deep', label: 'Deep' }]}
                onChange={v => set('research_depth', v)} />
              <Toggle label="Human Approval Required"
                hint="Pause before each trade — you review and confirm in-app"
                value={cfg.human_approval_required} onChange={v => set('human_approval_required', v)} />
            </div>
          </Card>

          <Card>
            <SectionTitle>Position Sizing</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 18 }}>
              <Slider label="Max Position Size" value={cfg.max_position_usd} min={100} max={2000} step={50} format={v => `$${v}`} onChange={v => set('max_position_usd', v)} />
              <Slider label="Max Concurrent Trades" value={cfg.max_concurrent_trades} min={1} max={10} step={1} onChange={v => set('max_concurrent_trades', v)} />
            </div>
          </Card>
        </div>

        {/* Right */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <SectionTitle>Trade Risk</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 18 }}>
              <Slider label="Stop Loss" value={cfg.stop_loss_pct} min={0.5} max={10} step={0.5} format={v => `${v}%`} onChange={v => set('stop_loss_pct', v)} />
              <Slider label="Take Profit" value={cfg.take_profit_pct} min={1} max={20} step={0.5} format={v => `${v}%`} onChange={v => set('take_profit_pct', v)} />
              {/* R:R display */}
              <div style={{ display: 'flex', gap: 14 }}>
                {[['Risk / Reward', `1 : ${rrRatio}`], ['Max loss/trade', `-$${worstCase}`], ['Max gain/trade', `+$${bestCase}`]].map(([k, v]) => (
                  <div key={k} style={{ flex: 1, background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{k}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--text1)' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle>Session Limits</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 18 }}>
              <Slider label="Daily Loss Limit" value={cfg.daily_loss_limit_usd} min={50} max={1000} step={50} format={v => `$${v}`} onChange={v => set('daily_loss_limit_usd', v)} />
              <Slider label="Profit Target" value={cfg.profit_target_usd} min={100} max={5000} step={100} format={v => `$${v}`} onChange={v => set('profit_target_usd', v)} />
              <Slider label="Max API Spend / Day" value={cfg.max_api_spend_usd} min={1} max={25} step={0.5} format={v => `$${v}`} onChange={v => set('max_api_spend_usd', v)} />
            </div>
          </Card>
        </div>
      </div>
    </PageShell>
  );
};

const cfgS = {
  field:    { display: 'flex', flexDirection: 'column' },
  fieldLabel: { fontSize: 14, fontWeight: 500, color: 'var(--text1)' },
  hint:     { fontSize: 12, color: 'var(--text3)' },
  fieldVal: { fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: 'var(--accent)' },
  rangeHint:{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)' },
  seg:      { flex: 1, padding: '7px 10px', fontSize: 13, borderRadius: 8, cursor: 'pointer', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--font-sans)', transition: 'all 0.1s' },
  segActive:{ background: 'rgba(96,165,250,0.1)', borderColor: 'rgba(96,165,250,0.3)', color: '#60a5fa', fontWeight: 600 },
};

Object.assign(window, { StrategyConfig });
