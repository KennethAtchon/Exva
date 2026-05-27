import { Fragment, useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
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
    color: "var(--color-success)",
    label: "Technical",
    bg: "var(--color-success-dim)",
  },
  fundamental: {
    color: "var(--color-error)",
    label: "Fundamental",
    bg: "var(--color-error-dim)",
  },
  review: {
    color: "var(--color-info)",
    label: "Review",
    bg: "var(--color-info-dim)",
  },
  decision: {
    color: "var(--color-market)",
    label: "Decision",
    bg: "var(--color-market-dim)",
  },
  selector: {
    color: "var(--color-warning)",
    label: "Universe",
    bg: "var(--color-warning-dim)",
  },
};
const LEVEL_COLOR: Record<string, string> = {
  DEBUG: "var(--color-log-debug)",
  INFO: "var(--color-log-info)",
  WARN: "var(--color-log-warn)",
  ERROR: "var(--color-log-error)",
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
          ? "var(--color-success)"
          : "var(--color-error)"
        : undefined,
    },
    {
      label: "Daily P&L",
      value: fmt.pnl(stats.daily_pnl_usd),
      sub: fmt.pct(stats.daily_pnl_pct),
      subColor:
        stats.daily_pnl_usd >= 0
          ? "var(--color-success)"
          : "var(--color-error)",
      valColor:
        stats.daily_pnl_usd >= 0
          ? "var(--color-success)"
          : "var(--color-error)",
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
    <div className={stripClass}>
      {items.map((item, i) => (
        <Fragment key={item.label}>
          {i > 0 && <Divider vertical />}
          <div className={stripItemClass}>
            <span className={stripLabelClass}>{item.label}</span>
            <span
              className={stripValueClass}
              style={item.valColor ? { color: item.valColor } : undefined}
            >
              {item.value}
            </span>
            <div className="flex items-center gap-2">
              <span
                className="font-mono text-[12px]"
                style={{ color: item.subColor || "var(--text3)" }}
              >
                {item.sub}
              </span>
              {item.meter != null && (
                <div className="h-[3px] w-[52px] overflow-hidden rounded-[2px] bg-[var(--surface3)]">
                  <div
                    className="h-full rounded-[2px]"
                    style={{
                      width: `${Math.min(item.meter * 100, 100)}%`,
                      background:
                        item.meter > 0.8
                          ? "var(--color-error)"
                          : "var(--accent)",
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
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={tradeRowClass}
      style={{
        background: selected ? "var(--surface2)" : "transparent",
      }}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="w-[46px] font-mono text-[14px] font-bold text-[var(--text1)]">
            {trade.instrumentSymbol}
          </span>
          {trade.instrumentDisplayName ? (
            <span className="max-w-[120px] overflow-hidden text-ellipsis text-[12px] text-[var(--text3)]">
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
      <span className={trCellClass}>
        {trade.entry_price != null ? fmt.usd(trade.entry_price) : "—"}
      </span>
      <span className={trCellClass}>
        {isOpen && trade.current_price != null
          ? fmt.usd(trade.current_price)
          : "—"}
      </span>
      <span
        className={cn(
          trCellClass,
          "font-semibold",
          pos ? "text-success" : "text-error",
        )}
      >
        {pnl != null ? fmt.pnl(pnl) : "—"}
      </span>
      <span className={trCellClass}>{fmt.usd(trade.position_size_usd, 0)}</span>
      <div className="flex items-center gap-2">
        <div className="h-[3px] w-9 overflow-hidden rounded-[2px] bg-[var(--surface3)]">
          <div
            className="h-full rounded-[2px] bg-[var(--accent)]"
            style={{
              width: `${(trade.confidence_score ?? 0) * 100}%`,
            }}
          />
        </div>
        <span className={cn(trCellClass, "w-7")}>
          {Math.round((trade.confidence_score ?? 0) * 100)}%
        </span>
      </div>
      <Badge variant={isOpen ? "success" : "default"} size="sm">
        {trade.status}
      </Badge>
      <span className={cn(trCellClass, "text-[var(--text3)]")}>
        {trade.opened_at ? fmt.time(trade.opened_at) : "—"}
      </span>
    </div>
  );
};

const TradesPanel = () => {
  const trades = useTradeStore((s) => s.trades);
  const selectedId = useTradeStore((s) => s.selectedId);
  const setSelected = useTradeStore((s) => s.setSelected);
  const sorted = trades.toSorted((a, b) => {
    const at = a.opened_at ? new Date(a.opened_at).getTime() : 0;
    const bt = b.opened_at ? new Date(b.opened_at).getTime() : 0;
    return bt - at;
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={tradesScrollClass}>
        <div className={tradesTableMinClass}>
          <div className={trHeadClass}>
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
          <div className="min-h-0 flex-1 overflow-y-auto">
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
    <div className="relative flex gap-0">
      <div className="flex w-8 shrink-0 flex-col items-center pt-3.5">
        <div
          className="h-2 w-2 shrink-0 rounded-full border-2 border-[var(--surface)]"
          style={{
            background: ap ? ap.color : LEVEL_COLOR[ev.level],
            boxShadow: ap ? `0 0 6px ${ap.color}60` : "none",
          }}
        />
        {!isLast && (
          <div className="mt-1 min-h-2 w-px flex-1 bg-[var(--border)]" />
        )}
      </div>
      <div className="min-w-0 flex-1 pr-4 pb-2.5">
        <div
          className={cn("flex items-center gap-[7px] pt-2.5", ap && "mb-1.5")}
        >
          {ap ? (
            <span
              className="text-[12px] font-semibold tracking-[0.02em]"
              style={{ color: ap.color }}
            >
              {ap.label}
            </span>
          ) : (
            <span
              className="font-mono text-[12px] font-semibold tracking-[0.04em]"
              style={{ color: LEVEL_COLOR[ev.level] }}
            >
              {ev.level}
            </span>
          )}
          {ev.trade_id && (
            <span className="rounded-[4px] bg-[var(--surface3)] px-1.5 py-px font-mono text-[12px] text-[var(--text3)]">
              {ev.trade_id}
            </span>
          )}
          <span className="ml-auto font-mono text-[12px] text-[var(--text3)]">
            {fmt.time(ev.created_at)}
          </span>
        </div>
        {ap ? (
          <div
            className="rounded-r-lg py-2 px-2.5"
            style={{
              background: ap.bg,
              borderLeft: `2px solid ${ap.color}`,
            }}
          >
            <span className="text-[12px] leading-[1.55] text-[var(--text2)]">
              {ev.message}
            </span>
          </div>
        ) : (
          <span
            className={cn(
              "text-[12px] leading-[1.4]",
              ev.level === "WARN" && "text-warning",
              ev.level === "ERROR" && "text-error",
              ev.level !== "WARN" &&
                ev.level !== "ERROR" &&
                "text-[var(--text3)]",
            )}
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
      <div className={cn(pageClass, "justify-center px-10 py-9")}>
        <div className="text-[14px] text-[var(--text3)]">Loading…</div>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      <div className={headerRowClass}>
        <div className={headerTitleBlockClass}>
          <div className={headerEyebrowClass}>Control room</div>
          <h1 className={headerH1Class}>Dashboard</h1>
          <p className={headerSubClass}>
            {viewMode === "global"
              ? "Global workspace metrics"
              : "Focused session metrics"}
          </p>
        </div>
        <div className={headerChipWrapClass}>
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
        <div className={archivedToggleClass}>
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
        </div>
      )}
      <StatStrip stats={stats} />
      <div className={approvalsWrapClass}>
        <PendingApprovalsPanel
          approvals={approvalList.approvals}
          workspaceViewMode={approvalList.workspaceViewMode}
          onRefresh={refreshApprovals}
          onDecide={(input) => api.decideApproval(input)}
        />
      </div>

      <div className={gridClass}>
        <Card className={tradesCardClass}>
          <div className="flex items-center justify-between px-6 pb-4">
            <SectionTitle>Trades</SectionTitle>
            <div className="flex gap-2">
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

        <Card className={autopsySidebarClass}>
          <div className="flex items-center justify-between px-5 pb-3.5">
            <SectionTitle>Agent Feed</SectionTitle>
            <div className="flex items-center gap-[5px]">
              <Dot color="var(--color-success)" pulse size={6} />
              <span className="text-[12px] text-[var(--text3)]">live</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1 pr-0 pb-2 pl-2">
            {events.map((ev, i) => (
              <FeedRow key={ev.id} ev={ev} isLast={i === events.length - 1} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

const pageClass =
  "box-border flex h-full min-h-0 flex-col gap-0 overflow-hidden px-10 pt-7 pb-8";

const headerRowClass =
  "mb-[18px] flex min-w-0 shrink-0 items-start justify-between gap-4";

const headerTitleBlockClass = "min-w-0 flex-[1_1_auto]";

const headerEyebrowClass =
  "mb-1.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text3)]";

const headerH1Class =
  "m-0 text-[26px] font-bold tracking-[-0.02em] text-[var(--text1)]";

const headerSubClass =
  "mt-1.5 mb-0 max-w-[520px] text-[13px] leading-[1.45] text-[var(--text2)]";

const headerChipWrapClass = "shrink-0 pt-0.5";

const archivedToggleClass =
  "mb-3 flex shrink-0 items-center gap-2 text-[12px] text-[var(--text2)]";

const stripClass =
  "mb-1 flex shrink-0 items-stretch overflow-x-auto overscroll-x-contain rounded-xl border border-[var(--border)] bg-[var(--surface)] [-webkit-overflow-scrolling:touch]";

const stripItemClass =
  "flex min-w-0 flex-[1_0_120px] flex-col gap-[5px] px-5 py-[18px]";

const stripLabelClass =
  "text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text3)]";

const stripValueClass =
  "font-mono text-[28px] font-bold leading-[1.1] text-[var(--text1)]";

const approvalsWrapClass = "min-w-0 shrink-0 pb-3.5";

const gridClass =
  "flex min-h-0 min-w-0 flex-1 flex-wrap content-stretch gap-4 overflow-hidden pt-2";

const tradesScrollClass =
  "flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto overscroll-x-contain";

const tradesTableMinClass = "flex min-h-0 min-w-[720px] flex-1 flex-col";

const trHeadClass =
  "grid shrink-0 grid-cols-[130px_90px_90px_90px_70px_110px_70px_60px] gap-0 border-b border-[var(--border)] px-6 pb-2.5 text-[12px] font-semibold uppercase tracking-[0.07em] text-[var(--text3)]";

const tradeRowClass =
  "grid cursor-pointer grid-cols-[130px_90px_90px_90px_70px_110px_70px_60px] items-center gap-0 border-b border-[var(--border)] px-6 py-[11px] transition-[background] duration-100";

const trCellClass = "font-mono text-[13px] text-[var(--text2)]";

const tradesCardClass =
  "flex min-h-0 min-w-0 flex-[1_1_320px] flex-col overflow-hidden px-0 pt-5 pb-0";

const autopsySidebarClass =
  "flex min-h-0 w-[clamp(280px,32vw,340px)] max-w-full min-w-0 flex-[0_1_320px] flex-col overflow-hidden px-0 pt-5 pb-0";
