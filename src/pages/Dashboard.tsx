import { Fragment, useEffect, useState, type CSSProperties } from "react";
import {
  Badge,
  Card,
  Divider,
  Dot,
  SectionTitle,
} from "@/components/custom-ui";
import { Checkbox } from "@/components/ui";
import { WorkspaceContextChip } from "@/components/WorkspaceContextChip";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { fmt } from "@/lib/formatters";
import { useSessionStore } from "@/store/sessionStore";
import { useTradeStore } from "@/store/tradeStore";
import { api } from "@/lib/exva";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { PendingApprovalsPanel } from "@/components/approvals/PendingApprovalsPanel";
import type {
  ApprovalSummary,
  DashboardStats,
  EventRow,
  EventSourceType,
  Trade,
} from "@/lib/types";

const AGENT_PALETTE: Partial<
  Record<EventSourceType, { color: string; label: string; bg: string }>
> = {
  technical: {
    color: "#34d399",
    label: "Technical",
    bg: "rgba(52,211,153,0.07)",
  },
  fundamental: {
    color: "#f87171",
    label: "Fundamental",
    bg: "rgba(248,113,113,0.07)",
  },
  review: { color: "#60a5fa", label: "Review", bg: "rgba(96,165,250,0.07)" },
  decision: {
    color: "#a78bfa",
    label: "Decision",
    bg: "rgba(167,139,250,0.07)",
  },
  selector: {
    color: "#fbbf24",
    label: "Universe",
    bg: "rgba(251,191,36,0.07)",
  },
};
const LEVEL_COLOR: Record<string, string> = {
  DEBUG: "#374151",
  INFO: "#60a5fa",
  WARN: "#fbbf24",
  ERROR: "#f87171",
};

const StatStrip = ({ stats }: { stats: DashboardStats }) => {
  const hasLivePortfolioValue = stats.portfolio_value_source === "broker";
  const items: Array<{
    label: string;
    value: string | number;
    sub: string;
    subColor?: string;
    valColor?: string;
    meter?: number;
  }> = [
    {
      label: hasLivePortfolioValue ? "Portfolio Value" : "Portfolio Value",
      value: hasLivePortfolioValue ? fmt.usd(stats.portfolio_value) : "—",
      sub: hasLivePortfolioValue
        ? `${fmt.pnl(stats.unrealized_pnl)} unrealized`
        : "No live broker balance yet",
      subColor: hasLivePortfolioValue
        ? stats.unrealized_pnl >= 0
          ? "#34d399"
          : "#f87171"
        : undefined,
    },
    {
      label: "Daily P&L",
      value: fmt.pnl(stats.daily_pnl_usd),
      sub: fmt.pct(stats.daily_pnl_pct),
      subColor: stats.daily_pnl_usd >= 0 ? "#34d399" : "#f87171",
      valColor: stats.daily_pnl_usd >= 0 ? "#34d399" : "#f87171",
    },
    {
      label: "Win Rate",
      value: `${Math.round(stats.win_rate_today * 100)}%`,
      sub: `${stats.closed_trades_today} closed today`,
    },
    {
      label: "Open Positions",
      value: stats.open_trades,
      sub: `${stats.total_trades_today} total today`,
    },
    {
      label: "AI Cost",
      value: fmt.usd(stats.daily_api_spend),
      sub: `of ${fmt.usd(stats.api_budget)} budget`,
      meter:
        stats.api_budget > 0 ? stats.daily_api_spend / stats.api_budget : 0,
    },
  ];
  return (
    <div style={ds.strip}>
      {items.map((item, i) => (
        <Fragment key={item.label}>
          {i > 0 && <Divider vertical />}
          <div style={ds.stripItem}>
            <span style={ds.stripLabel}>{item.label}</span>
            <span
              style={{
                ...ds.stripValue,
                color: item.valColor || "var(--text1)",
              }}
            >
              {item.value}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  color: item.subColor || "var(--text3)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {item.sub}
              </span>
              {item.meter != null && (
                <div
                  style={{
                    width: 52,
                    height: 3,
                    background: "var(--surface3)",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(item.meter * 100, 100)}%`,
                      background:
                        item.meter > 0.8 ? "#f87171" : "var(--accent)",
                      borderRadius: 2,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
};

const TradeRow = ({
  trade,
  selected,
  onClick,
}: {
  trade: Trade;
  selected: boolean;
  onClick: () => void;
}) => {
  const isOpen = trade.status === "open";
  const pnl = (isOpen ? trade.unrealized_pnl : trade.final_pnl_usd) ?? null;
  const pos = pnl != null && pnl >= 0;
  return (
    <div
      onClick={onClick}
      style={{
        ...ds.tradeRow,
        background: selected ? "var(--surface2)" : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              fontWeight: 700,
              color: "var(--text1)",
              width: 46,
            }}
          >
            {trade.instrumentSymbol}
          </span>
          {trade.instrumentDisplayName ? (
            <span
              style={{
                fontSize: 10,
                color: "var(--text3)",
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {trade.instrumentDisplayName}
            </span>
          ) : null}
        </div>
        {trade.predictionOutcome ? (
          <Badge variant="purple" size="sm">
            {trade.predictionOutcome}
          </Badge>
        ) : null}
        <Badge variant={trade.side === "BUY" ? "success" : "danger"} size="sm">
          {trade.side}
        </Badge>
      </div>
      <span style={ds.trCell}>
        {trade.entry_price != null ? fmt.usd(trade.entry_price) : "—"}
      </span>
      <span style={ds.trCell}>
        {isOpen && trade.current_price != null
          ? fmt.usd(trade.current_price)
          : "—"}
      </span>
      <span
        style={{
          ...ds.trCell,
          color: pos ? "#34d399" : "#f87171",
          fontWeight: 600,
        }}
      >
        {pnl != null ? fmt.pnl(pnl) : "—"}
      </span>
      <span style={ds.trCell}>{fmt.usd(trade.position_size_usd, 0)}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 36,
            height: 3,
            background: "var(--surface3)",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${(trade.confidence_score ?? 0) * 100}%`,
              background: "var(--accent)",
              borderRadius: 2,
            }}
          />
        </div>
        <span style={{ ...ds.trCell, width: 28 }}>
          {Math.round((trade.confidence_score ?? 0) * 100)}%
        </span>
      </div>
      <Badge variant={isOpen ? "success" : "default"} size="sm">
        {trade.status}
      </Badge>
      <span style={{ ...ds.trCell, color: "var(--text3)" }}>
        {trade.opened_at ? fmt.time(trade.opened_at) : "—"}
      </span>
    </div>
  );
};

const TradesPanel = () => {
  const trades = useTradeStore((s) => s.trades);
  const selectedId = useTradeStore((s) => s.selectedId);
  const setSelected = useTradeStore((s) => s.setSelected);
  const sorted = [...trades].sort((a, b) => {
    const at = a.opened_at ? new Date(a.opened_at).getTime() : 0;
    const bt = b.opened_at ? new Date(b.opened_at).getTime() : 0;
    return bt - at;
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div style={ds.tradesScroll}>
        <div style={ds.tradesTableMin}>
          <div style={ds.trHead}>
            {[
              "Instrument",
              "Entry",
              "Current",
              "P&L",
              "Size",
              "Confidence",
              "Status",
              "Time",
            ].map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
          <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
            {sorted.map((t) => (
              <TradeRow
                key={t.id}
                trade={t}
                selected={t.id === selectedId}
                onClick={() => setSelected(t.id === selectedId ? null : t.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const FeedRow = ({ ev, isLast }: { ev: EventRow; isLast: boolean }) => {
  const ap = ev.agent_type ? AGENT_PALETTE[ev.agent_type] : null;
  return (
    <div style={{ display: "flex", gap: 0, position: "relative" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: 32,
          flexShrink: 0,
          paddingTop: 14,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: ap ? ap.color : LEVEL_COLOR[ev.level],
            flexShrink: 0,
            border: "2px solid var(--surface)",
            boxShadow: ap ? `0 0 6px ${ap.color}60` : "none",
          }}
        />
        {!isLast && (
          <div
            style={{
              width: 1,
              flex: 1,
              minHeight: 8,
              background: "var(--border)",
              marginTop: 4,
            }}
          />
        )}
      </div>
      <div
        style={{ flex: 1, paddingBottom: 10, paddingRight: 16, minWidth: 0 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginBottom: ap ? 6 : 0,
            paddingTop: 10,
          }}
        >
          {ap ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: ap.color,
                letterSpacing: "0.02em",
              }}
            >
              {ap.label}
            </span>
          ) : (
            <span
              style={{
                fontSize: 11,
                color: LEVEL_COLOR[ev.level],
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                letterSpacing: "0.04em",
              }}
            >
              {ev.level}
            </span>
          )}
          {ev.trade_id && (
            <span
              style={{
                fontSize: 10,
                color: "var(--text3)",
                fontFamily: "var(--font-mono)",
                background: "var(--surface3)",
                padding: "1px 6px",
                borderRadius: 4,
              }}
            >
              {ev.trade_id}
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              color: "var(--text3)",
              fontFamily: "var(--font-mono)",
              marginLeft: "auto",
            }}
          >
            {fmt.time(ev.created_at)}
          </span>
        </div>
        {ap ? (
          <div
            style={{
              background: ap.bg,
              borderLeft: `2px solid ${ap.color}`,
              borderRadius: "0 8px 8px 0",
              padding: "8px 10px",
            }}
          >
            <span
              style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.55 }}
            >
              {ev.message}
            </span>
          </div>
        ) : (
          <span
            style={{
              fontSize: 12,
              color:
                ev.level === "WARN"
                  ? "#fbbf24"
                  : ev.level === "ERROR"
                    ? "#f87171"
                    : "var(--text3)",
              lineHeight: 1.4,
            }}
          >
            {ev.message}
          </span>
        )}
      </div>
    </div>
  );
};

export const Dashboard = () => {
  const stats = useSessionStore((s) => s.stats);
  const trades = useTradeStore((s) => s.trades);
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const preferences = useWorkspaceStore((s) => s.preferences);
  const setViewMode = useWorkspaceStore((s) => s.setViewMode);
  const loadWorkspaceView = useWorkspaceStore((s) => s.loadWorkspaceView);
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [approvalList, setApprovalList] = useState<{
    workspaceViewMode: "session" | "global";
    approvals: ApprovalSummary[];
  }>({ workspaceViewMode: "session", approvals: [] });

  const refreshApprovals = () => {
    void api
      .listApprovals({ status: "pending" })
      .then((r) =>
        setApprovalList({
          workspaceViewMode: r.workspaceViewMode,
          approvals: r.approvals,
        }),
      )
      .catch(() => setApprovalList((prev) => ({ ...prev, approvals: [] })));
  };

  useEffect(() => {
    setEvents([]);
    api
      .getEvents({ limit: 30 })
      .then(setEvents)
      .catch(() => {});
  }, [environmentMode]);

  useEffect(() => {
    setApprovalList({ workspaceViewMode: "session", approvals: [] });
    refreshApprovals();
  }, [environmentMode]);

  useExvaEvent("agent_event", () => {
    api
      .getEvents({ limit: 30 })
      .then(setEvents)
      .catch(() => {});
  });

  useExvaEvent("approval_required", () => refreshApprovals());
  useExvaEvent("approval_resolved", () => refreshApprovals());

  if (!stats) {
    return (
      <div
        style={{ ...ds.page, padding: "36px 40px", justifyContent: "center" }}
      >
        <div style={{ color: "var(--text3)", fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={ds.page}>
      <div style={ds.headerRow}>
        <div style={ds.headerTitleBlock}>
          <div style={ds.headerEyebrow}>Control room</div>
          <h1 style={ds.headerH1}>Dashboard</h1>
          <p style={ds.headerSub}>
            {viewMode === "global"
              ? "Global workspace metrics"
              : "Focused session metrics"}
          </p>
        </div>
        <div style={ds.headerChipWrap}>
          <WorkspaceContextChip
            onSwitchSession={async (id) => {
              await api.focusSession(id);
              await loadWorkspaceView();
            }}
            onGoGlobal={async () => {
              await api.goGlobal();
              setViewMode("global", null);
            }}
          />
        </div>
      </div>
      {viewMode === "global" && (
        <label style={ds.archivedToggle}>
          <Checkbox
            checked={preferences?.globalIncludeArchived ?? false}
            onCheckedChange={async (checked) => {
              await api.patchWorkspacePreferences({
                globalIncludeArchived: checked === true,
              });
              await loadWorkspaceView();
            }}
          />
          Include archived sessions
        </label>
      )}
      <StatStrip stats={stats} />
      <div style={ds.approvalsWrap}>
        <PendingApprovalsPanel
          approvals={approvalList.approvals}
          workspaceViewMode={approvalList.workspaceViewMode}
          onRefresh={refreshApprovals}
          onDecide={(input) => api.decideApproval(input)}
        />
      </div>

      <div style={ds.grid}>
        <Card
          style={{
            flex: "1 1 320px",
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: "20px 0 0",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 24px 16px",
            }}
          >
            <SectionTitle>Trades</SectionTitle>
            <div style={{ display: "flex", gap: 8 }}>
              <Badge variant="success" size="sm">
                {trades.filter((t) => t.status === "open").length} open
              </Badge>
              <Badge variant="default" size="sm">
                {trades.filter((t) => t.status === "closed").length} closed
              </Badge>
            </div>
          </div>
          <TradesPanel />
        </Card>

        <Card
          style={{
            flex: "0 1 320px",
            width: "clamp(280px, 32vw, 340px)",
            maxWidth: "100%",
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: "20px 0 0",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 20px 14px",
            }}
          >
            <SectionTitle>Agent Feed</SectionTitle>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Dot color="#34d399" pulse size={6} />
              <span style={{ fontSize: 11, color: "var(--text3)" }}>live</span>
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: "4px 0 8px 8px" }}>
            {events.map((ev, i) => (
              <FeedRow key={ev.id} ev={ev} isLast={i === events.length - 1} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

const ds: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    gap: 0,
    padding: "28px 40px 32px",
    boxSizing: "border-box",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 18,
    flexShrink: 0,
    minWidth: 0,
  },
  headerTitleBlock: { minWidth: 0, flex: "1 1 auto" },
  headerEyebrow: {
    fontSize: 10,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "var(--text3)",
    fontWeight: 600,
    marginBottom: 6,
  },
  headerH1: {
    margin: 0,
    fontSize: 26,
    fontWeight: 700,
    color: "var(--text1)",
    letterSpacing: "-0.02em",
  },
  headerSub: {
    margin: "6px 0 0",
    fontSize: 13,
    color: "var(--text2)",
    lineHeight: 1.45,
    maxWidth: 520,
  },
  headerChipWrap: { flexShrink: 0, paddingTop: 2 },
  archivedToggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "var(--text2)",
    fontSize: 12,
    marginBottom: 12,
    flexShrink: 0,
  },
  strip: {
    display: "flex",
    alignItems: "stretch",
    borderRadius: 12,
    border: "1px solid var(--border)",
    margin: "0 0 4px",
    background: "linear-gradient(180deg, rgba(18,26,36,0.55), var(--surface))",
    flexShrink: 0,
    overflowX: "auto",
    overscrollBehaviorX: "contain",
    WebkitOverflowScrolling: "touch",
  },
  stripItem: {
    flex: "1 0 120px",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: "18px 20px",
    minWidth: 0,
  },
  stripLabel: {
    fontSize: 11,
    color: "var(--text3)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 600,
  },
  stripValue: {
    fontFamily: "var(--font-mono)",
    fontSize: 28,
    fontWeight: 700,
    color: "var(--text1)",
    lineHeight: 1.1,
  },
  approvalsWrap: { padding: "0 0 14px", flexShrink: 0, minWidth: 0 },
  grid: {
    flex: 1,
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    overflow: "hidden",
    minHeight: 0,
    minWidth: 0,
    padding: "8px 0 0",
    alignContent: "stretch",
  },
  tradesScroll: {
    display: "flex",
    flexDirection: "column",
    overflowX: "auto",
    overscrollBehaviorX: "contain",
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  tradesTableMin: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 720,
    minHeight: 0,
  },
  trHead: {
    display: "grid",
    gridTemplateColumns: "130px 90px 90px 90px 70px 110px 70px 60px",
    padding: "0 24px 10px",
    gap: 0,
    borderBottom: "1px solid var(--border)",
    fontSize: 10,
    color: "var(--text3)",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    fontWeight: 600,
    flexShrink: 0,
  },
  tradeRow: {
    display: "grid",
    gridTemplateColumns: "130px 90px 90px 90px 70px 110px 70px 60px",
    padding: "11px 24px",
    gap: 0,
    alignItems: "center",
    cursor: "pointer",
    borderBottom: "1px solid var(--border)",
    transition: "background 0.1s",
  },
  trCell: {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    color: "var(--text2)",
  },
};
