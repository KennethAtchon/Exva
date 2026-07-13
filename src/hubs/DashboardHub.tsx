import { useEffect, useState } from "react";
import { Badge, Dot } from "@/components/custom-ui";
import { Checkbox, HelpTooltip } from "@/components/ui";
import { WorkspaceContextChip } from "@/components/WorkspaceContextChip";
import { PendingApprovalsPanel } from "@/components/approvals/PendingApprovalsPanel";
import { VirtualList } from "@/components/hub/VirtualList";
import { fmt } from "@/lib/formatters";
import { formatIpcError } from "@/lib/ipc-error";
import { api, type ExperienceScorecardSummary } from "@/lib/exva";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { useSessionStore } from "@/store/sessionStore";
import { useTradeStore } from "@/store/tradeStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { cn } from "@/lib/utils";
import type {
  ApprovalSummary,
  EventRow,
  EventSourceType,
  Trade,
} from "@/lib/types";
import {
  HubBody,
  HubEmptyState,
  HubFrame,
  HubHeader,
  HubMetricStrip,
  HubPane,
  HubQueryError,
  HubStatusStrip,
} from "./dna";
import { EquityCurvePanel } from "./panels/equity-curve-panel";
import { KillSwitchPanel } from "./panels/kill-switch-panel";
import { MorningBriefingPanel } from "./panels/morning-briefing-panel";

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

/**
 * Journey: arrive → equity/P&L at a glance → clear attention queue →
 * scan promotion ladder → leave knowing whether money and risk need a tap.
 */
export function DashboardHub() {
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
  const [scorecards, setScorecards] = useState<ExperienceScorecardSummary[]>(
    [],
  );
  const [backupLabel, setBackupLabel] = useState("—");
  const [sinkOk, setSinkOk] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  const [scorecardsError, setScorecardsError] = useState<string | null>(null);

  const loadEvents = () => {
    api
      .getEvents({ limit: 80 })
      .then((rows) => {
        setEvents(rows);
        setEventsError(null);
      })
      .catch((err) => {
        setEventsError(formatIpcError(err).display);
      });
  };

  const refreshApprovals = () => {
    void api
      .listApprovals({ status: "pending" })
      .then((r) => {
        setApprovalList({
          workspaceViewMode: r.workspaceViewMode,
          approvals: r.approvals,
        });
        setApprovalsError(null);
      })
      .catch((err) => {
        setApprovalsError(formatIpcError(err).display);
      });
  };

  useEffect(() => {
    setEvents([]);
    loadEvents();
  }, [environmentMode]);

  useEffect(() => {
    setApprovalList({ workspaceViewMode: "session", approvals: [] });
    refreshApprovals();
  }, [environmentMode]);

  useEffect(() => {
    void api
      .listExperienceScorecards()
      .then((rows) => {
        setScorecards(rows);
        setScorecardsError(null);
      })
      .catch((err) => {
        setScorecardsError(formatIpcError(err).display);
        setScorecards([]);
      });
  }, [environmentMode]);

  useEffect(() => {
    const ops = window.exva?.ops;
    if (!ops) return;
    void Promise.all([ops.getBackupStatus(), ops.getNotificationRouting()])
      .then(([backup, routing]) => {
        setBackupLabel(
          backup.lastBackup?.backedUpAt
            ? new Date(backup.lastBackup.backedUpAt).toLocaleString()
            : "Never",
        );
        setSinkOk(
          routing.ntfyConfigured ||
            routing.telegramConfigured ||
            routing.smtpConfigured,
        );
      })
      .catch(() => {
        setBackupLabel("Unavailable");
        setSinkOk(false);
      });
  }, []);

  useExvaEvent("agent_event", () => {
    loadEvents();
  });
  useExvaEvent("approval_required", () => refreshApprovals());
  useExvaEvent("approval_resolved", () => refreshApprovals());

  if (!stats) {
    return (
      <HubFrame>
        <div className="flex flex-1 items-center justify-center text-[14px] text-[var(--text3)]">
          Loading…
        </div>
      </HubFrame>
    );
  }

  const ready = scorecards.filter((s) => s.meetsPromotion);
  const pnlTone =
    stats.daily_pnl_usd > 0
      ? "pos"
      : stats.daily_pnl_usd < 0
        ? "neg"
        : "default";

  return (
    <HubFrame>
      <HubHeader
        eyebrow="Control room"
        title="Dashboard"
        subtitle={
          viewMode === "global"
            ? "Portfolio pulse, attention queue, and promotion ladder."
            : "Focused session pulse — clear what needs a tap."
        }
        help={<HelpTooltip glossaryId="dashboard-scope" />}
        actions={
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
        }
      />

      <HubMetricStrip
        items={[
          {
            label:
              stats.portfolio_value_source === "broker"
                ? "Portfolio"
                : "Portfolio",
            value:
              stats.portfolio_value_source === "broker"
                ? fmt.usd(stats.portfolio_value)
                : "—",
            sub:
              stats.portfolio_value_source === "broker"
                ? `${fmt.pnl(stats.unrealized_pnl)} unrealized`
                : "No live broker balance yet",
            tone:
              stats.portfolio_value_source === "broker"
                ? stats.unrealized_pnl >= 0
                  ? "pos"
                  : "neg"
                : "default",
          },
          {
            label: "Daily P&L",
            value: fmt.pnl(stats.daily_pnl_usd),
            sub: fmt.pct(stats.daily_pnl_pct),
            tone: pnlTone,
          },
          {
            label: "Win rate",
            value: `${Math.round(stats.win_rate_today * 100)}%`,
            sub: `${stats.closed_trades_today} closed today`,
          },
          {
            label: "Open",
            value: stats.open_trades,
            sub: `${stats.total_trades_today} total today`,
          },
          {
            label: "AI spend",
            value: fmt.usd(stats.daily_api_spend),
            sub: `of ${fmt.usd(stats.api_budget)}`,
            tone:
              stats.api_budget > 0 &&
              stats.daily_api_spend / stats.api_budget > 0.8
                ? "warn"
                : "default",
          },
        ]}
      />

      {viewMode === "global" && (
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-7 py-2 text-[12px] text-[var(--text2)]">
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

      <HubBody scroll className="flex flex-col gap-3 p-4">
        <div className="grid min-h-[160px] grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
          <HubPane
            eyebrow="Equity"
            title="Portfolio curve"
            className="min-h-[160px]"
          >
            <EquityCurvePanel />
          </HubPane>
          <HubPane
            eyebrow="Ladder"
            title="Promotion ready"
            actions={
              <Badge
                variant={ready.length > 0 ? "success" : "default"}
                size="sm"
              >
                {ready.length} ready
              </Badge>
            }
          >
            <PromotionBoard
              scorecards={scorecards}
              error={scorecardsError}
              onRetry={() => {
                void api
                  .listExperienceScorecards()
                  .then((rows) => {
                    setScorecards(rows);
                    setScorecardsError(null);
                  })
                  .catch((err) => {
                    setScorecardsError(formatIpcError(err).display);
                  });
              }}
            />
          </HubPane>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <MorningBriefingPanel />
          <KillSwitchPanel />
        </div>

        <div className="shrink-0">
          {approvalsError ? (
            <HubQueryError
              message={approvalsError}
              onRetry={refreshApprovals}
            />
          ) : (
            <PendingApprovalsPanel
              approvals={approvalList.approvals}
              workspaceViewMode={approvalList.workspaceViewMode}
              onRefresh={refreshApprovals}
              onDecide={(input) => api.decideApproval(input)}
            />
          )}
        </div>

        <div className="grid min-h-[320px] flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
          <HubPane
            eyebrow="Positions"
            title="Trades"
            actions={
              <div className="flex gap-2">
                <Badge variant="success" size="sm">
                  {trades.filter((t) => t.status === "open").length} open
                </Badge>
                <Badge variant="default" size="sm">
                  {trades.filter((t) => t.status === "closed").length} closed
                </Badge>
              </div>
            }
          >
            <DashboardTradesPanel />
          </HubPane>
          <HubPane
            eyebrow="Live"
            title="Agent feed"
            actions={
              <div className="flex items-center gap-[5px]">
                <Dot color="var(--color-success)" pulse size={6} />
                <span className="text-[12px] text-[var(--text3)]">live</span>
              </div>
            }
          >
            {eventsError ? (
              <HubQueryError message={eventsError} onRetry={loadEvents} />
            ) : (
              <VirtualList
                items={events}
                rowHeight={52}
                className="h-full min-h-[200px] py-1 pr-0 pb-2 pl-2"
                getKey={(ev) => ev.id}
                renderRow={(ev, i) => (
                  <FeedRow ev={ev} isLast={i === events.length - 1} />
                )}
                empty={
                  <HubEmptyState
                    title="No agent events yet"
                    body="Start a session — pipeline steps and decisions appear here live."
                    className="py-8"
                  />
                }
              />
            )}
          </HubPane>
        </div>
      </HubBody>

      <HubStatusStrip
        items={[
          {
            label: "Last backup",
            value: backupLabel,
            ok: backupLabel !== "Never" && backupLabel !== "Unavailable",
          },
          {
            label: "Notify sinks",
            value: sinkOk ? "Configured" : "None",
            ok: sinkOk,
          },
          {
            label: "Approvals",
            value: String(approvalList.approvals.length),
            ok: approvalList.approvals.length === 0,
          },
          {
            label: "Session",
            value: stats.session_status,
            ok:
              stats.session_status === "active" ||
              stats.session_status === "idle",
          },
        ]}
      />
    </HubFrame>
  );
}

function PromotionBoard({
  scorecards,
  error,
  onRetry,
}: {
  scorecards: ExperienceScorecardSummary[];
  error?: string | null;
  onRetry?: () => void;
}) {
  if (error) {
    return <HubQueryError message={error} onRetry={onRetry} />;
  }
  const sorted = [...scorecards].sort(
    (a, b) => Number(b.meetsPromotion) - Number(a.meetsPromotion),
  );
  if (sorted.length === 0) {
    return (
      <HubEmptyState
        title="No scorecards yet"
        body="Paper sessions populate the promotion ladder — create a session from an experience preset."
        className="py-6"
      />
    );
  }
  return (
    <ul className="m-0 list-none divide-y divide-[var(--border)] p-0">
      {sorted.slice(0, 8).map((row) => (
        <li
          key={row.experienceId}
          className="flex items-center justify-between gap-2 px-4 py-2.5"
        >
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-[var(--text1)]">
              {row.displayName}
            </div>
            <div className="font-mono text-[11px] capitalize text-[var(--text3)]">
              {row.promotionTier} · {row.tradeCount} trades
            </div>
          </div>
          {row.meetsPromotion ? (
            <span className="shrink-0 font-mono text-[11px] font-semibold text-success">
              Promote
            </span>
          ) : (
            <span className="max-w-[140px] truncate text-right text-[11px] text-[var(--text3)]">
              {row.failedPromotionCriteria[0] ?? "Building"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function DashboardTradesPanel() {
  const trades = useTradeStore((s) => s.trades);
  const selectedId = useTradeStore((s) => s.selectedId);
  const setSelected = useTradeStore((s) => s.setSelected);
  const [hideNoTrade, setHideNoTrade] = useState(true);

  const sorted = trades.toSorted((a, b) => {
    const at = a.opened_at ? new Date(a.opened_at).getTime() : 0;
    const bt = b.opened_at ? new Date(b.opened_at).getTime() : 0;
    return bt - at;
  });
  const visible = hideNoTrade
    ? sorted.filter((t) => t.status !== "no_trade")
    : sorted;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto">
        <div className="flex min-h-0 min-w-[720px] flex-1 flex-col">
          <div className="grid shrink-0 grid-cols-[130px_90px_90px_90px_70px_110px_minmax(76px,auto)_60px] gap-0 border-b border-[var(--border)] px-6 pb-2.5 text-[12px] font-semibold uppercase tracking-[0.07em] text-[var(--text3)]">
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
            {visible.map((t) => (
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
      <div className="flex items-center gap-2 border-t border-[var(--border)] px-6 py-2.5">
        <Checkbox
          id="hide-no-trade"
          checked={hideNoTrade}
          onCheckedChange={(v) => setHideNoTrade(!!v)}
        />
        <label
          htmlFor="hide-no-trade"
          className="cursor-pointer select-none text-[12px] text-[var(--text3)]"
        >
          Hide no trade
        </label>
      </div>
    </div>
  );
}

function TradeRow({
  trade,
  selected,
  onClick,
}: {
  trade: Trade;
  selected: boolean;
  onClick: () => void;
}) {
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
      className="grid cursor-pointer grid-cols-[130px_90px_90px_90px_70px_110px_minmax(76px,auto)_60px] items-center gap-0 border-b border-[var(--border)] px-6 py-[11px] transition-[background] duration-100"
      style={{ background: selected ? "var(--surface2)" : "transparent" }}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="w-[46px] font-mono text-[14px] font-bold text-[var(--text1)]">
            {trade.instrumentSymbol}
          </span>
        </div>
        <Badge variant={trade.side === "BUY" ? "success" : "danger"} size="sm">
          {trade.side}
        </Badge>
      </div>
      <span className="font-mono text-[13px] text-[var(--text2)]">
        {trade.entry_price != null ? fmt.usd(trade.entry_price) : "—"}
      </span>
      <span className="font-mono text-[13px] text-[var(--text2)]">
        {isOpen && trade.current_price != null
          ? fmt.usd(trade.current_price)
          : "—"}
      </span>
      <span
        className={cn(
          "font-mono text-[13px] font-semibold",
          pos ? "text-success" : "text-error",
        )}
      >
        {pnl != null ? fmt.pnl(pnl) : "—"}
      </span>
      <span className="font-mono text-[13px] text-[var(--text2)]">
        {fmt.usd(trade.position_size_usd, 0)}
      </span>
      <div className="flex items-center gap-2">
        <div className="h-[3px] w-9 overflow-hidden rounded-[2px] bg-[var(--surface3)]">
          <div
            className="h-full rounded-[2px] bg-[var(--accent)]"
            style={{ width: `${(trade.confidence_score ?? 0) * 100}%` }}
          />
        </div>
        <span className="w-7 font-mono text-[13px] text-[var(--text2)]">
          {Math.round((trade.confidence_score ?? 0) * 100)}%
        </span>
      </div>
      <Badge variant={isOpen ? "success" : "default"} size="sm">
        {trade.status}
      </Badge>
      <span className="font-mono text-[13px] text-[var(--text3)]">
        {trade.opened_at ? fmt.time(trade.opened_at) : "—"}
      </span>
    </div>
  );
}

function FeedRow({ ev, isLast }: { ev: EventRow; isLast: boolean }) {
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
              className="font-mono text-[11px] font-semibold"
              style={{ color: LEVEL_COLOR[ev.level] }}
            >
              {ev.level}
            </span>
          )}
          <span className="font-mono text-[11px] text-[var(--text3)]">
            {ev.created_at ? fmt.time(ev.created_at) : ""}
          </span>
        </div>
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
      </div>
    </div>
  );
}
