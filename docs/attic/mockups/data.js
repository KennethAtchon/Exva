/* Exva M0 — shared mock data & helpers */

const EXVA_MOCK = {
  portfolio: {
    equity: 128_450.32,
    dayPnl: 1_842.17,
    dayPnlPct: 1.45,
    openRisk: 4_200,
  },
  positions: [
    {
      sym: "NVDA",
      qty: 120,
      avg: 118.42,
      last: 124.85,
      pnl: 771.6,
      pnlPct: 5.43,
      side: "long",
      session: "Momentum-AM",
      spark: [3, 5, 4, 6, 7, 8, 6, 9],
    },
    {
      sym: "AAPL",
      qty: 200,
      avg: 189.1,
      last: 191.24,
      pnl: 428.0,
      pnlPct: 1.13,
      side: "long",
      session: "Swing-Core",
      spark: [4, 4, 5, 5, 4, 6, 5, 6],
    },
    {
      sym: "TSLA",
      qty: -80,
      avg: 242.5,
      last: 238.12,
      pnl: 350.4,
      pnlPct: 1.81,
      side: "short",
      session: "MeanRev-PM",
      spark: [6, 5, 4, 5, 3, 4, 3, 2],
    },
    {
      sym: "AMD",
      qty: 150,
      avg: 156.8,
      last: 154.22,
      pnl: -387.0,
      pnlPct: -1.65,
      side: "long",
      session: "Momentum-AM",
      spark: [5, 5, 4, 3, 3, 2, 2, 1],
    },
    {
      sym: "META",
      qty: 60,
      avg: 512.3,
      last: 518.9,
      pnl: 396.0,
      pnlPct: 1.29,
      side: "long",
      session: "Swing-Core",
      spark: [3, 4, 4, 5, 5, 6, 6, 7],
    },
    {
      sym: "SPY",
      qty: 100,
      avg: 548.2,
      last: 549.85,
      pnl: 165.0,
      pnlPct: 0.3,
      side: "long",
      session: "Hedge-Basket",
      spark: [4, 4, 4, 5, 4, 5, 5, 5],
    },
    {
      sym: "COIN",
      qty: 40,
      avg: 228.0,
      last: 221.45,
      pnl: -262.0,
      pnlPct: -2.87,
      side: "long",
      session: "Crypto-Proxy",
      spark: [7, 6, 5, 4, 3, 2, 2, 1],
    },
    {
      sym: "PLTR",
      qty: 300,
      avg: 24.15,
      last: 25.88,
      pnl: 519.0,
      pnlPct: 7.16,
      side: "long",
      session: "Momentum-AM",
      spark: [2, 3, 4, 5, 6, 7, 8, 9],
    },
  ],
  sessions: [
    {
      id: "s1",
      name: "Momentum-AM",
      status: "live",
      pnl: 903.6,
      trades: 14,
      winRate: 64,
      broker: "Alpaca",
      started: "09:32",
      agent: "scout-v2",
    },
    {
      id: "s2",
      name: "Swing-Core",
      status: "live",
      pnl: 824.0,
      trades: 3,
      winRate: 100,
      broker: "Alpaca",
      started: "08:15",
      agent: "swing-v1",
    },
    {
      id: "s3",
      name: "MeanRev-PM",
      status: "paper",
      pnl: 350.4,
      trades: 8,
      winRate: 75,
      broker: "Paper",
      started: "13:01",
      agent: "revert-v3",
    },
    {
      id: "s4",
      name: "Crypto-Proxy",
      status: "stopped",
      pnl: -262.0,
      trades: 5,
      winRate: 20,
      broker: "Alpaca",
      started: "10:45",
      agent: "scout-v2",
    },
    {
      id: "s5",
      name: "Hedge-Basket",
      status: "live",
      pnl: 165.0,
      trades: 1,
      winRate: 100,
      broker: "Alpaca",
      started: "09:00",
      agent: "hedge-v1",
    },
  ],
  agentTrace: [
    {
      time: "14:32:08",
      msg: "Scanned <strong>42 symbols</strong> — 3 candidates above threshold",
    },
    {
      time: "14:31:55",
      msg: "NVDA tick +0.4% — <strong>holding</strong>, stop intact at 122.10",
    },
    {
      time: "14:31:12",
      msg: "Risk check passed — <strong>gross exposure 68%</strong> of limit",
    },
    {
      time: "14:30:44",
      msg: "AMD breach — <strong>trailing stop</strong> triggered in 2.1s",
    },
    {
      time: "14:29:30",
      msg: "Rebalance signal for Hedge-Basket — <strong>no action</strong> (within band)",
    },
    {
      time: "14:28:01",
      msg: "Paper session MeanRev-PM — <strong>filled TSLA short</strong> @ 238.12",
    },
  ],
  attention: [
    {
      level: "crit",
      text: "AMD stop triggered — position closed at 154.22",
      sym: "AMD",
    },
    {
      level: "warn",
      text: "COIN down 2.9% — approaching session max-loss",
      sym: "COIN",
    },
    {
      level: "warn",
      text: "Alpaca feed latency 340ms (threshold 250ms)",
      sym: null,
    },
    {
      level: "info",
      text: "Momentum-AM agent queued rebalance for 15:00 ET",
      sym: null,
    },
    {
      level: "info",
      text: "PLTR +7.2% — consider partial take-profit",
      sym: "PLTR",
    },
  ],
  cmdItems: [
    {
      icon: "⌘",
      label: "Go to Dashboard",
      hint: "⌘1",
      action: "nav",
      target: "dashboard",
    },
    {
      icon: "⌘",
      label: "Go to Sessions",
      hint: "⌘2",
      action: "nav",
      target: "sessions",
    },
    {
      icon: "▶",
      label: "Start session Momentum-AM",
      hint: "session",
      action: "start",
      target: "Momentum-AM",
    },
    {
      icon: "■",
      label: "Stop session Crypto-Proxy",
      hint: "session",
      action: "stop",
      target: "Crypto-Proxy",
    },
    {
      icon: "◎",
      label: "View NVDA position",
      hint: "NVDA",
      action: "position",
      target: "NVDA",
    },
    {
      icon: "◎",
      label: "View AMD position",
      hint: "AMD",
      action: "position",
      target: "AMD",
    },
    {
      icon: "⚡",
      label: "Flatten all positions",
      hint: "danger",
      action: "flatten",
    },
    { icon: "↻", label: "Refresh market data", hint: "⌘R", action: "refresh" },
    { icon: "⚙", label: "Open settings", hint: "⌘,", action: "settings" },
    { icon: "?", label: "Show keyboard shortcuts", hint: "⌘?", action: "help" },
  ],
};

function fmtSigned(n, decimals = 2) {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return abs;
}

function fmtPct(n) {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
}

function tickGlyph(n) {
  return n >= 0 ? "▲" : "▼";
}

function statusMark(status) {
  const map = { live: "●", paper: "○", stopped: "■" };
  return map[status] || "·";
}

function statusPill(status) {
  const cls = { live: "live", paper: "paper", stopped: "stop" }[status] || "";
  return `<span class="pill ${cls}">${status}</span>`;
}

function renderSparkline(values) {
  const max = Math.max(...values);
  return values
    .map((v, i) => {
      const h = Math.max(2, Math.round((v / max) * 16));
      const cls = i > 0 && v >= values[i - 1] ? "up" : i > 0 ? "down" : "";
      return `<span class="bar ${cls}" style="height:${h}px"></span>`;
    })
    .join("");
}

function renderPositionsTable(positions, selectedSym) {
  return positions
    .map((p) => {
      const pnlCls = p.pnl >= 0 ? "up" : "down";
      const sel = p.sym === selectedSym ? " selected" : "";
      return `<tr class="tick-flash${sel}" data-sym="${p.sym}">
      <td class="sym">${p.sym}</td>
      <td class="dim">${p.side}</td>
      <td class="num mono">${p.qty}</td>
      <td class="num mono dim">${p.avg.toFixed(2)}</td>
      <td class="num mono">${p.last.toFixed(2)}</td>
      <td class="num mono ${pnlCls}">${fmtSigned(p.pnl)}</td>
      <td class="num mono ${pnlCls}">${tickGlyph(p.pnlPct)} ${fmtPct(p.pnlPct)}</td>
      <td class="dim">${p.session}</td>
      <td><span class="eq-sparkline">${renderSparkline(p.spark)}</span></td>
    </tr>`;
    })
    .join("");
}

function renderSessionsTable(sessions, selectedId) {
  return sessions
    .map((s) => {
      const pnlCls = s.pnl >= 0 ? "up" : "down";
      const sel = s.id === selectedId ? " selected" : "";
      return `<tr class="${sel}" data-id="${s.id}">
      <td class="sym">${s.name}</td>
      <td>${statusPill(s.status)}</td>
      <td class="num mono ${pnlCls}">${fmtSigned(s.pnl)}</td>
      <td class="num mono">${s.trades}</td>
      <td class="num mono">${s.winRate}%</td>
      <td class="dim">${s.broker}</td>
      <td class="mono faint">${s.started}</td>
      <td class="dim">${s.agent}</td>
    </tr>`;
    })
    .join("");
}

function renderAttention(items) {
  return items
    .map(
      (a) =>
        `<div class="attention-item" data-sym="${a.sym || ""}">
      <span class="attention-dot ${a.level}"></span>
      <span>${a.text}</span>
    </div>`,
    )
    .join("");
}

function renderTrace(items) {
  return items
    .map(
      (t) =>
        `<div class="trace-item">
      <span class="trace-time">${t.time}</span>
      <span class="trace-msg">${t.msg}</span>
    </div>`,
    )
    .join("");
}

function renderCmd(items, filter) {
  const q = (filter || "").toLowerCase();
  const filtered = items.filter((item) => {
    if (!q) return true;
    return (
      item.label.toLowerCase().includes(q) ||
      (item.hint || "").toLowerCase().includes(q) ||
      (item.target || "").toLowerCase().includes(q)
    );
  });
  return filtered
    .map(
      (item, i) =>
        `<div class="cmd-item${i === 0 ? " active" : ""}" data-action="${item.action}" data-target="${item.target || ""}">
      <span class="cmd-icon">${item.icon}</span>
      <span class="cmd-label">${item.label}</span>
      <span class="cmd-hint">${item.hint || ""}</span>
    </div>`,
    )
    .join("");
}

function initCmdPalette(opts = {}) {
  const overlay = document.getElementById("cmd-overlay");
  const input = document.getElementById("cmd-input");
  const list = document.getElementById("cmd-list");
  if (!overlay || !input || !list) return;

  function open(prefill) {
    overlay.classList.remove("hidden");
    input.value = prefill || "";
    list.innerHTML = renderCmd(EXVA_MOCK.cmdItems, input.value);
    input.focus();
  }
  function close() {
    overlay.classList.add("hidden");
    input.value = "";
  }
  function filter() {
    list.innerHTML = renderCmd(EXVA_MOCK.cmdItems, input.value);
  }

  document.querySelectorAll(".cmd-trigger, [data-cmd-open]").forEach((el) => {
    el.addEventListener("click", () => open());
  });
  input.addEventListener("input", filter);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      overlay.classList.contains("hidden") ? open() : close();
    }
    if (e.key === "Escape") close();
  });

  if (opts.openDefault) open(opts.prefill || "");
}

function flashTick() {
  document.querySelectorAll(".tick-flash").forEach((row, i) => {
    setTimeout(() => {
      const up = Math.random() > 0.4;
      row.classList.add(up ? "flash-up" : "flash-down");
      setTimeout(() => row.classList.remove("flash-up", "flash-down"), 300);
    }, i * 400);
  });
}

if (typeof window !== "undefined") {
  window.EXVA_MOCK = EXVA_MOCK;
  window.fmtSigned = fmtSigned;
  window.fmtPct = fmtPct;
  window.tickGlyph = tickGlyph;
  window.statusMark = statusMark;
  window.renderCmd = renderCmd;
  window.initCmdPalette = initCmdPalette;
  window.flashTick = flashTick;
}
