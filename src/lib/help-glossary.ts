export type HelpEntry = {
  title?: string;
  body: string;
};

export const HELP_GLOSSARY = {
  experience: {
    title: "Experience",
    body: "A packaged trading setup: signal source, pipeline, presets, and supported instruments.",
  },
  signal: {
    title: "Signal",
    body: "An event the system can react to, such as a filing, news hit, or timer tick.",
  },
  "signal-source": {
    title: "Signal source",
    body: "A feed that emits signals. Sessions subscribe to one active source at a time.",
  },
  "signal-delivery": {
    title: "Signal delivery",
    body: "A signal queued for one session.",
  },
  "dead-letter": {
    title: "Dead letter",
    body: "A signal the session skipped because it could not act on it, usually because of source, instrument, or broker mismatch.",
  },
  session: {
    title: "Session",
    body: "A configured trading run: one experience, one active signal source, broker assignments, and strategy settings.",
  },
  pipeline: {
    title: "Pipeline",
    body: "The ordered AI workflow that runs after a signal arrives.",
  },
  "instrument-class": {
    title: "Instrument class",
    body: "Asset type: stock, crypto, futures, options, or prediction market.",
  },
  "signal-type-edgar-8k": {
    title: "EDGAR 8-K",
    body: "Listens for SEC Form 8-K filings and turns matching filings into tradeable signals.",
  },
  "signal-type-web-search": {
    title: "Web search",
    body: "Searches the web for relevant news and turns matching results into signals.",
  },
  "signal-type-manual": {
    title: "Manual",
    body: "No automated feed. The session runs only from the manual tickers you enter.",
  },
  "signal-type-mock": {
    title: "Mock",
    body: "Deterministic test signals for rehearsal and development. Not for real trading.",
  },
  "fire-rehearsal-signal": {
    title: "Fire rehearsal signal",
    body: "Emits one synthetic filing-style signal through the full delivery path for subscribed rehearsal sessions.",
  },
  "signal-type-timer": {
    title: "Timer",
    body: "Fires on a schedule for strategies that do not depend on external news.",
  },
  "signal-type-prediction-event": {
    title: "Prediction event",
    body: "Events from prediction-market platforms for prediction-market experiences.",
  },
  "experience-edgar-catalyst": {
    title: "EDGAR catalyst",
    body: "Trades post-8-K drift on US equities using filing-driven signals and a catalyst-focused pipeline.",
  },
  "experience-rules-mean-reversion": {
    title: "Rules mean reversion",
    body: "A rule-based mean reversion strategy on a timer-driven stock universe defined by the experience signal source.",
  },
  "experience-rules-qqq-mean-reversion": {
    title: "QQQ mean reversion",
    body: "A timer-driven mean reversion strategy focused on QQQ.",
  },
  "experience-btc-momentum-breakout": {
    title: "BTC momentum breakout",
    body: "A timer-driven BTC momentum breakout strategy.",
  },
  "experience-commodities-trend-following": {
    title: "Commodities trend following",
    body: "A futures trend-following strategy for commodities.",
  },
  "experience-prediction-event-edge": {
    title: "Prediction event edge",
    body: "An event-driven strategy for prediction markets. An LLM forecaster researches each market (web search + primary sources), estimates a probability, a red-team pass challenges it, and a deterministic edge gate sizes the trade.",
  },
  "experience-options-flow-edge": {
    title: "Options Flow Edge",
    body: "Detects unusual options activity (option volume well above open interest with a directional call/put skew) on liquid underlyings and trades the resulting directional read. Deterministic; disabled and paper-only until validated.",
  },
  "unusual-options-activity": {
    title: "Unusual options activity (UOA)",
    body: "A session where option volume runs far above standing open interest. Lopsided toward calls it reads bullish, toward puts bearish. Used as an information signal, not a guarantee — most UOA is hedging or noise.",
  },
  "defined-risk-structure": {
    title: "Defined-risk structure",
    body: "An options position whose maximum loss is capped at the debit paid (e.g. a long call/put or a vertical spread). No naked short legs.",
  },
  forecaster: {
    title: "Forecaster",
    body: "The LLM step that researches a prediction market and produces a calibrated probability of the outcome from the evidence it gathered.",
  },
  "red-team": {
    title: "Red team / adversarial review",
    body: "A separate pass that tries to prove the forecaster wrong — searching for disconfirming evidence and already-priced-in information. Disagreement widens the uncertainty band, which shrinks position size.",
  },
  "implied-probability-edge": {
    title: "Implied probability / edge",
    body: "A prediction-market price is the market's implied probability. Edge is the gap between the forecaster's probability and that price, after spread and fees.",
  },
  "information-freshness": {
    title: "Information freshness",
    body: "Whether the news driving a market is already priced in. Stale catalysts are skipped — the move already happened.",
  },
  "insufficient-bars": {
    title: "Insufficient bars / data-starved",
    body: "A deterministic engine could not fetch enough price history to compute its signal, so it skips. Surfaced as a session-health warning, not a normal no-trade, because it usually means a data-feed or credential problem.",
  },
  "session-status-draft": {
    title: "Draft",
    body: "Created, but never started.",
  },
  "session-status-idle": {
    title: "Idle",
    body: "Stopped cleanly and ready to start again.",
  },
  "session-status-active": {
    title: "Active",
    body: "Running now: processing signals and managing open positions.",
  },
  "session-status-paused": {
    title: "Paused",
    body: "Not taking new research cycles. Existing positions are still monitored.",
  },
  "session-status-monitoring-only": {
    title: "Stopping when flat",
    body: "No new entries. Existing positions stay managed until they close.",
  },
  "session-status-attention-required": {
    title: "Needs attention",
    body: "The runtime hit an error or blocking condition and needs operator action before it can continue.",
  },
  "session-status-stopped": {
    title: "Stopped",
    body: "Fully halted. If positions are still open, no automated exits are running.",
  },
  "session-status-archived": {
    title: "Archived",
    body: "Hidden from normal active workflows, but still available for historical review and optional aggregate reporting.",
  },
  "environment-paper": {
    title: "Paper environment",
    body: "Simulated execution. No real broker orders are sent.",
  },
  "environment-live": {
    title: "Live environment",
    body: "Uses real broker accounts. Sessions still need live execution enabled before they can place live orders.",
  },
  "execution-mode-paper-only": {
    title: "Paper-only execution",
    body: "This session never sends live orders, even when the workspace is in Live mode.",
  },
  "execution-mode-live-allowed": {
    title: "Live execution allowed",
    body: "This session may send live orders when the workspace is in Live mode and readiness checks pass.",
  },
  "view-global": {
    title: "Global view",
    body: "Show data across non-archived sessions in the current environment by default. Some pages also let you include archived sessions.",
  },
  "view-session-focused": {
    title: "Focused session view",
    body: "Show data for one focused session only.",
  },
  "focus-session": {
    title: "Focused session",
    body: "Choose which session drives session-specific pages and header controls.",
  },
  "promotion-tier": {
    title: "Promotion tier",
    body: "Readiness stage for an experience scorecard: scripted, rehearsal, paper, or live.",
  },
  "approval-queue": {
    title: "Approval queue",
    body: "Trade proposals waiting for a human approve or reject decision before execution.",
  },
  "dashboard-scope": {
    title: "Dashboard scope",
    body: "In focused mode the dashboard shows one session. In global mode it aggregates non-archived sessions in the current environment by default, with optional archived inclusion.",
  },
  "portfolio-value": {
    title: "Portfolio value",
    body: "Shows a real broker-backed portfolio value when available. Otherwise Exva shows a dash instead of guessing.",
  },
  "daily-pnl": {
    title: "Daily P&L",
    body: "Profit and loss for today inside the current page scope.",
  },
  "win-rate": {
    title: "Win rate",
    body: "Percentage of closed trades in the current scope that finished positive.",
  },
  "ai-cost": {
    title: "AI cost",
    body: "Model spend attributed to the current scope, compared against the daily budget where available.",
  },
  "agent-technical": {
    title: "Technical phase",
    body: "Examines price action, levels, momentum, and chart context.",
  },
  "agent-fundamental": {
    title: "Fundamental phase",
    body: "Examines catalyst details, company context, and broader evidence behind the trade.",
  },
  "agent-review": {
    title: "Review phase",
    body: "Challenges the thesis and looks for reasons to reject a weak setup.",
  },
  "agent-decision": {
    title: "Decision phase",
    body: "Turns the research output into a concrete trade or no-trade decision.",
  },
  "agent-selector": {
    title: "Universe phase",
    body: "Finds and narrows candidate instruments before deeper analysis starts.",
  },
  "source-readiness-armed": {
    title: "Armed",
    body: "The session has at least one live input and can start processing signals immediately. For listener experiences, that means an enabled subscribed source — not manual tickers.",
  },
  "source-readiness-manual-only": {
    title: "Manual only",
    body: "The session has manual tickers but no enabled automated source. It can still run from your manual list.",
  },
  "source-readiness-waiting-for-source-enable": {
    title: "Waiting for source enable",
    body: "The session is subscribed to a source, but all subscribed sources are disabled, so it will wait idle until one is enabled.",
  },
  "source-readiness-no-inputs": {
    title: "No live inputs",
    body: "The session has neither manual tickers nor an enabled subscribed source.",
  },
  "signal-delivery-status-queued": {
    title: "Queued",
    body: "The signal is waiting its turn for this session.",
  },
  "signal-delivery-status-waiting-for-resume": {
    title: "Waiting for resume",
    body: "The signal was queued while the session was paused and will continue once the session resumes.",
  },
  "signal-delivery-status-processing": {
    title: "Evaluating",
    body: "The session is actively running the pipeline for this signal.",
  },
  "signal-delivery-status-triggered": {
    title: "Triggered cycle",
    body: "The signal started a research cycle, but no trade is confirmed yet.",
  },
  "signal-delivery-status-traded": {
    title: "Trade opened",
    body: "This signal led to an executed trade.",
  },
  "signal-delivery-status-rejected": {
    title: "Rejected",
    body: "The pipeline reviewed the signal but decided not to trade it.",
  },
  "signal-delivery-status-dropped": {
    title: "Dropped",
    body: "The signal was discarded before a trade could be placed, usually because of a routing or compatibility issue.",
  },
  "signal-delivery-status-expired": {
    title: "Expired",
    body: "The signal sat too long while paused and is no longer valid to process.",
  },
  "dead-letter-reason-unsupported-by-experience": {
    title: "Unsupported by experience",
    body: "The selected experience does not support this signal's type or instrument class.",
  },
  "dead-letter-reason-unsupported-by-signal-source": {
    title: "Unsupported by source",
    body: "The session's source configuration cannot produce or use this kind of signal.",
  },
  "dead-letter-reason-unsupported-by-assigned-broker": {
    title: "Unsupported by assigned broker",
    body: "None of the assigned brokers can trade the required instrument class.",
  },
  "dead-letter-reason-no-compatible-broker-route": {
    title: "No compatible broker route",
    body: "The session had brokers assigned, but no valid route existed for this specific signal and instrument.",
  },
  "search-provider-override": {
    title: "Search provider override",
    body: "Use a specific search provider for this session instead of the workspace default.",
  },
  "research-focus": {
    title: "Research focus",
    body: "Bias the selector toward one instrument class while keeping the broader broker-backed universe available.",
  },
  "manual-tickers": {
    title: "Manual tickers",
    body: "Symbols that seed or constrain research for manual-only or web-search sessions. Listener experiences ignore this field — instruments come from the signal feed.",
  },
  "broker-accounts": {
    title: "Broker accounts",
    body: "These are the broker accounts the session may route orders through.",
  },
  allocation: {
    title: "Allocation",
    body: "Allocated capital is the amount this session may use from a broker. Free capital is what the broker currently has available.",
  },
  launchability: {
    title: "Launchability",
    body: "A session is launchable when its assigned brokers cover at least one instrument class supported by the experience.",
  },
  confidence: {
    title: "Confidence",
    body: "Model-estimated confidence for a proposal or trade. It is an internal score, not a guaranteed probability.",
  },
  expectancy: {
    title: "Expectancy",
    body: "Average profit or loss per trade after costs.",
  },
  "max-drawdown": {
    title: "Max drawdown",
    body: "Maximum peak-to-trough loss over the measured equity curve.",
  },
  "cost-per-trade": {
    title: "Cost per trade",
    body: "Average model spend attributed to each closed trade.",
  },
  "out-of-sample": {
    title: "Out of sample",
    body: "Performance measured on data held back from the fitting or tuning period.",
  },
  "cost-by-agent": {
    title: "Cost by agent",
    body: "Breaks model spend down by pipeline phase so you can see where cost is concentrated.",
  },
  "cost-per-trade-attribution": {
    title: "Cost per trade attribution",
    body: "Rolls relevant model spend back onto individual trades when Exva can connect the run history to a trade outcome.",
  },
  projections: {
    title: "Projections",
    body: "These estimates extrapolate from current spend and trade pace. They are planning signals, not guarantees.",
  },
  "cache-savings": {
    title: "Cache savings",
    body: "Prompt cache reduced spend by this amount compared with sending the full prompt every time.",
  },
  "net-pnl-after-costs": {
    title: "Net P&L after costs",
    body: "Profit or loss after AI and data fees are subtracted from trading results.",
  },
  "stop-when-flat": {
    title: "Stop when flat",
    body: "Stops new research immediately and completes shutdown once all open trades close.",
  },
  "force-stop": {
    title: "Force stop",
    body: "Force stop ends automated exit management for open positions and may leave them unmanaged.",
  },
  "resume-session": {
    title: "Resume session",
    body: "Resumes new research cycles. Open-position monitoring and strategy settings stay as they were.",
  },
  "session-edit-locked": {
    title: "Edit locked",
    body: "Active, paused, and stopping-when-flat sessions lock config so runtime behavior cannot change mid-cycle.",
  },
  "duplicate-session": {
    title: "Duplicate session",
    body: "Creates a new draft session with the same experience, sources, brokers, and strategy settings.",
  },
  "save-template": {
    title: "Save template",
    body: "Saves the session setup as a reusable template. Broker credentials and runtime state are not copied.",
  },
  "risk-limits": {
    title: "Risk limits",
    body: "Caps position sizing, loss, and concurrent exposure for this session.",
  },
  "live-readiness-gate": {
    title: "Live readiness",
    body: "Checks required before live execution can start.",
  },
  "session-metrics-scope": {
    title: "Session metrics",
    body: "Counts reflect the current page scope: filtered sessions in global mode, or the focused session context in session mode.",
  },
  "status-filter": {
    title: "Status filter",
    body: "Filter sessions by lifecycle status. Hover a status badge elsewhere for what each state means.",
  },
  "trade-autopsy": {
    title: "Trade autopsy",
    body: "Open an AI-generated post-trade review for this trade.",
  },
  "trade-cost-attribution": {
    title: "Cost attribution",
    body: "AI and data spend attributed to the research cycles that led to this trade.",
  },
  "strategy-style-vs-instructions": {
    title: "Style vs instructions",
    body: "Research posture sets high-level trading style. Worker instructions add hard guidance injected into every AI phase.",
  },
  "strategy-trade-rules": {
    title: "Trade rules",
    body: "Hard constraints the decision flow must obey, such as setup type, side bias, and entry or exit style.",
  },
  "strategy-risk-controls": {
    title: "Risk controls",
    body: "Sizing, max loss, exposure caps, and approval settings the runtime enforces.",
  },
  "strategy-timeframe": {
    title: "Timeframe",
    body: "Expected holding horizon and catalyst window for this session's trades.",
  },
  "strategy-ai-phases": {
    title: "AI phases",
    body: "Per-phase model, prompt, and tool configuration for the research pipeline.",
  },
  "session-templates": {
    title: "Session templates",
    body: "Reusable session setups you can apply when creating a new session.",
  },
  "edgar-poll-interval": {
    title: "Poll interval",
    body: "How often Exva checks the SEC feed for new filings during market or off-hours periods.",
  },
  "edgar-cik-whitelist": {
    title: "CIK whitelist",
    body: "Limit detection to these SEC filers. Leave empty to watch all filers.",
  },
  "edgar-min-filing-age": {
    title: "Min filing age",
    body: "Ignore very fresh filings until they are old enough to trust.",
  },
  "remove-signal-source": {
    title: "Remove source",
    body: "Deleting a source unsubscribes attached sessions but keeps historical records.",
  },
  "session-objective": {
    title: "Objective",
    body: "Natural-language goal the AI should keep in mind while making decisions.",
  },
  "broker-connection-health": {
    title: "Broker health",
    body: "Healthy means recent balance data is available. Stale or over-allocated badges mean the broker needs attention before sessions can rely on it.",
  },
  "broker-instrument-classes": {
    title: "Supported classes",
    body: "Instrument classes this broker can route orders for.",
  },
} as const satisfies Record<string, HelpEntry>;

export type HelpGlossaryId = keyof typeof HELP_GLOSSARY;

export const SESSION_STATUS_HELP_IDS = {
  draft: "session-status-draft",
  idle: "session-status-idle",
  active: "session-status-active",
  paused: "session-status-paused",
  monitoring_only: "session-status-monitoring-only",
  attention_required: "session-status-attention-required",
  stopped: "session-status-stopped",
  archived: "session-status-archived",
} as const satisfies Record<string, HelpGlossaryId>;

export const SIGNAL_DELIVERY_STATUS_HELP_IDS = {
  queued: "signal-delivery-status-queued",
  waiting_for_resume: "signal-delivery-status-waiting-for-resume",
  processing: "signal-delivery-status-processing",
  triggered: "signal-delivery-status-triggered",
  traded: "signal-delivery-status-traded",
  rejected: "signal-delivery-status-rejected",
  dropped: "signal-delivery-status-dropped",
  expired: "signal-delivery-status-expired",
} as const satisfies Record<string, HelpGlossaryId>;

export const EXPERIENCE_HELP_IDS = {
  "edgar-catalyst": "experience-edgar-catalyst",
  "rules-mean-reversion": "experience-rules-mean-reversion",
  "rules-qqq-mean-reversion": "experience-rules-qqq-mean-reversion",
  "btc-momentum-breakout": "experience-btc-momentum-breakout",
  "commodities-trend-following": "experience-commodities-trend-following",
  "prediction-event-edge": "experience-prediction-event-edge",
} as const satisfies Record<string, HelpGlossaryId>;

export function getHelpEntry({
  glossaryId,
  title,
  body,
}: {
  glossaryId?: HelpGlossaryId;
  title?: string;
  body?: string;
}): HelpEntry {
  if (title || body) {
    if (!body) {
      throw new Error("Inline help entries require a body.");
    }
    return { title, body };
  }

  if (!glossaryId) {
    throw new Error("Help entry requires a glossaryId or inline body.");
  }

  return HELP_GLOSSARY[glossaryId];
}
