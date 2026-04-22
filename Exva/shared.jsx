// Shared mock data, formatters, and tiny components — v2

const MOCK_TRADES = [
  { id: "t-001", asset: "NVDA", side: "BUY", entry_price: 891.20, position_size_usd: 450, stop_loss_price: 873.38, take_profit_price: 927.85, strategy: "passive_income", status: "open", opened_at: "2026-04-21T09:14:22Z", ai_cost_usd: 0.31, confidence_score: 0.82, broker_order_id: "ALP-00421", unrealized_pnl: 38.40, current_price: 898.73 },
  { id: "t-002", asset: "AAPL", side: "BUY", entry_price: 198.55, position_size_usd: 500, stop_loss_price: 194.58, take_profit_price: 206.49, strategy: "passive_income", status: "open", opened_at: "2026-04-21T10:02:11Z", ai_cost_usd: 0.28, confidence_score: 0.74, broker_order_id: "ALP-00422", unrealized_pnl: -6.20, current_price: 196.31 },
  { id: "t-003", asset: "TSLA", side: "SELL", entry_price: 245.80, position_size_usd: 490, stop_loss_price: 250.72, take_profit_price: 235.57, strategy: "passive_income", status: "open", opened_at: "2026-04-21T11:33:05Z", ai_cost_usd: 0.34, confidence_score: 0.79, broker_order_id: "ALP-00423", unrealized_pnl: 14.90, current_price: 238.32 },
  { id: "t-004", asset: "META", side: "BUY", entry_price: 572.10, position_size_usd: 480, stop_loss_price: 560.66, take_profit_price: 595.78, strategy: "passive_income", status: "closed", opened_at: "2026-04-21T07:22:10Z", closed_at: "2026-04-21T08:55:30Z", final_pnl_usd: 22.40, ai_cost_usd: 0.29, confidence_score: 0.81 },
  { id: "t-005", asset: "MSFT", side: "BUY", entry_price: 418.30, position_size_usd: 420, stop_loss_price: 409.93, take_profit_price: 435.03, strategy: "passive_income", status: "closed", opened_at: "2026-04-21T06:10:00Z", closed_at: "2026-04-21T07:18:44Z", final_pnl_usd: -8.40, ai_cost_usd: 0.26, confidence_score: 0.61 },
  { id: "t-006", asset: "AMZN", side: "BUY", entry_price: 198.44, position_size_usd: 500, stop_loss_price: 194.47, take_profit_price: 206.38, strategy: "passive_income", status: "closed", opened_at: "2026-04-21T05:55:00Z", closed_at: "2026-04-21T06:44:10Z", final_pnl_usd: 19.80, ai_cost_usd: 0.27, confidence_score: 0.77 },
];

const MOCK_AGENT_RUNS = [
  { id: "ar-001", trade_id: "t-001", agent_type: "researcher_bull", model: "claude-haiku-4-5", input_tokens: 4820, output_tokens: 612, cost_usd: 0.078, duration_ms: 3241, output_text: "NVDA shows strong momentum following GTC announcements. Blackwell demand remains supply-constrained. Data center capex from hyperscalers continues to accelerate. RSI at 58 — room to run. Suggest bullish entry on current pullback.", created_at: "2026-04-21T09:13:10Z" },
  { id: "ar-002", trade_id: "t-001", agent_type: "researcher_bear", model: "claude-haiku-4-5", input_tokens: 4650, output_tokens: 580, cost_usd: 0.074, duration_ms: 3108, output_text: "Valuation stretched at 35x forward. China export restrictions remain a meaningful headwind. AMD gaining share in inference. Broad market showing signs of fatigue. Downside risk to $860 on any macro catalyst.", created_at: "2026-04-21T09:13:14Z" },
  { id: "ar-003", trade_id: "t-001", agent_type: "reviewer", model: "claude-haiku-4-5", input_tokens: 6200, output_tokens: 420, cost_usd: 0.089, duration_ms: 2870, output_text: "Bull case stronger on near-term catalysts. Bear case valid but longer-dated. Trade thesis is coherent with strategy parameters. Risk/reward acceptable at current levels.", created_at: "2026-04-21T09:13:48Z" },
  { id: "ar-004", trade_id: "t-001", agent_type: "decision_maker", model: "claude-haiku-4-5", input_tokens: 7100, output_tokens: 310, cost_usd: 0.067, duration_ms: 2210, output_text: "Decision: BUY. Confidence: 0.82. Size: 90% of max position. Stop at -2%, target at +4%. Strong near-term catalyst alignment.", created_at: "2026-04-21T09:14:10Z" },
];

const MOCK_EVENTS = [
  { id: "e-001", trade_id: "t-003", level: "INFO",  agent_type: "decision_maker",  message: "Trade cycle complete — TSLA SELL opened at $245.80",                           created_at: "2026-04-21T11:33:05Z" },
  { id: "e-002", trade_id: "t-003", level: "INFO",  agent_type: "researcher_bear", message: "Web search: TSLA Q1 delivery miss confirmed, analyst downgrades incoming",       created_at: "2026-04-21T11:31:44Z" },
  { id: "e-003", trade_id: "t-003", level: "INFO",  agent_type: "researcher_bull", message: "Cybertruck ramp improving, energy division outperforming expectations",           created_at: "2026-04-21T11:31:42Z" },
  { id: "e-004", trade_id: "t-002", level: "INFO",  agent_type: "decision_maker",  message: "Trade cycle complete — AAPL BUY opened at $198.55",                             created_at: "2026-04-21T10:02:11Z" },
  { id: "e-005", trade_id: null,    level: "WARN",  agent_type: null,              message: "Daily P&L approaching 35% of loss limit — monitoring closely",                   created_at: "2026-04-21T09:58:00Z" },
  { id: "e-006", trade_id: "t-001", level: "INFO",  agent_type: "decision_maker",  message: "Trade cycle complete — NVDA BUY opened at $891.20",                             created_at: "2026-04-21T09:14:22Z" },
  { id: "e-007", trade_id: "t-004", level: "INFO",  agent_type: null,              message: "META closed at $594.10 — P&L: +$22.40 (+4.7%)",                                 created_at: "2026-04-21T08:55:30Z" },
  { id: "e-008", trade_id: "t-001", level: "DEBUG", agent_type: "reviewer",        message: "Prompt cache hit — system block reused (saved ~4,200 tokens)",                   created_at: "2026-04-21T09:13:48Z" },
  { id: "e-009", trade_id: "t-005", level: "INFO",  agent_type: null,              message: "MSFT closed at $411.04 — P&L: -$8.40 (stop-loss triggered)",                    created_at: "2026-04-21T07:18:44Z" },
  { id: "e-010", trade_id: "t-006", level: "INFO",  agent_type: null,              message: "AMZN closed at $206.38 — P&L: +$19.80 (+4.0%)",                                 created_at: "2026-04-21T06:44:10Z" },
  { id: "e-011", trade_id: null,    level: "INFO",  agent_type: null,              message: "Session started — strategy: passive_income",                                     created_at: "2026-04-21T05:50:00Z" },
  { id: "e-012", trade_id: null,    level: "DEBUG", agent_type: null,              message: "Broker connection verified — Alpaca paper trading",                              created_at: "2026-04-21T05:50:01Z" },
];

const MOCK_DASHBOARD_STATS = {
  session_status: "active",
  daily_pnl_usd: 86.50,
  daily_pnl_pct: 0.0043,
  total_trades_today: 6,
  closed_trades_today: 3,
  win_rate_today: 0.667,
  open_trades: 3,
  daily_api_spend: 2.14,
  api_budget: 5.00,
  portfolio_value: 12840.50,
  unrealized_pnl: 47.10,
  session_uptime_min: 371,
};

const MOCK_COST_BREAKDOWN = {
  total: 2.14,
  by_agent: [
    { name: "researcher_bull", tokens: 18200, cost: 0.58 },
    { name: "researcher_bear", tokens: 17800, cost: 0.56 },
    { name: "reviewer",        tokens: 12400, cost: 0.48 },
    { name: "decision_maker",  tokens: 8800,  cost: 0.32 },
  ],
  by_trade: [
    { asset: "NVDA", cost: 0.31 }, { asset: "AAPL", cost: 0.28 },
    { asset: "TSLA", cost: 0.34 }, { asset: "META", cost: 0.29 },
    { asset: "MSFT", cost: 0.26 }, { asset: "AMZN", cost: 0.27 },
  ],
  cache_savings_usd: 0.84,
  daily_history: [
    { date: "15", cost: 1.82 }, { date: "16", cost: 2.31 },
    { date: "17", cost: 1.94 }, { date: "18", cost: 0 },
    { date: "19", cost: 0 },    { date: "20", cost: 2.08 },
    { date: "21", cost: 2.14 },
  ]
};

const fmt = {
  usd:     (v, d = 2)  => { const a = Math.abs(v).toFixed(d); return v < 0 ? `-$${a}` : `$${a}`; },
  pct:     (v, d = 1)  => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`,
  pnl:     (v)         => v >= 0 ? `+${fmt.usd(v)}` : fmt.usd(v),
  time:    (iso)       => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
  tokens:  (n)         => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`,
  duration:(ms)        => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`,
  uptime:  (m)         => { const h = Math.floor(m / 60); const mm = m % 60; return h > 0 ? `${h}h ${mm}m` : `${mm}m`; },
};

// ── Atoms ──────────────────────────────────────────────────────────────────
const Badge = ({ children, variant = 'default', size = 'md' }) => {
  const bg   = { default:'var(--chip)',      success:'rgba(52,211,153,0.12)', danger:'rgba(248,113,113,0.12)', warn:'rgba(251,191,36,0.12)',  blue:'rgba(96,165,250,0.12)',  purple:'rgba(167,139,250,0.12)' };
  const fg   = { default:'var(--text2)',     success:'#34d399',               danger:'#f87171',                warn:'#fbbf24',                blue:'#60a5fa',                purple:'#a78bfa'                };
  const pad  = size === 'sm' ? '2px 7px' : '3px 9px';
  const fs   = size === 'sm' ? 10 : 11;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, background:bg[variant], color:fg[variant], borderRadius:5, padding:pad, fontSize:fs, fontFamily:'var(--font-mono)', fontWeight:500, letterSpacing:'0.025em', whiteSpace:'nowrap' }}>
      {children}
    </span>
  );
};

const Dot = ({ color = '#556068', pulse = false, size = 7 }) => (
  <span style={{ display:'inline-block', width:size, height:size, borderRadius:'50%', background:color, flexShrink:0, animation: pulse ? 'pulse-dot 2s ease-in-out infinite' : 'none' }} />
);

const Divider = ({ vertical, style: s }) => (
  <div style={vertical ? { width:1, background:'var(--border)', alignSelf:'stretch', flexShrink:0, ...s } : { height:1, background:'var(--border)', ...s }} />
);

const AgentLabel = ({ type }) => {
  const map = { researcher_bull:{ label:'bull', variant:'success' }, researcher_bear:{ label:'bear', variant:'danger' }, reviewer:{ label:'review', variant:'blue' }, decision_maker:{ label:'decide', variant:'purple' } };
  const m = map[type] || { label: type, variant: 'default' };
  return <Badge variant={m.variant} size="sm">{m.label}</Badge>;
};

const LevelDot = ({ level }) => {
  const c = { DEBUG:'#374151', INFO:'#60a5fa', WARN:'#fbbf24', ERROR:'#f87171' };
  return <Dot color={c[level] || '#374151'} size={6} />;
};

const PageShell = ({ children }) => (
  <div style={{ flex:1, overflow:'auto', padding:'32px 36px', display:'flex', flexDirection:'column', gap:28 }}>
    {children}
  </div>
);

const SectionTitle = ({ children }) => (
  <h2 style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.1em', margin:0 }}>{children}</h2>
);

const Card = ({ children, style: s, accent }) => (
  <div style={{ background:'var(--surface)', border:`1px solid ${accent ? 'var(--accent-dim)' : 'var(--border)'}`, borderRadius:14, padding:'22px 24px', ...s }}>
    {children}
  </div>
);

Object.assign(window, {
  MOCK_TRADES, MOCK_AGENT_RUNS, MOCK_EVENTS, MOCK_DASHBOARD_STATS, MOCK_COST_BREAKDOWN,
  fmt, Badge, Dot, Divider, AgentLabel, LevelDot, PageShell, SectionTitle, Card
});
