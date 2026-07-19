import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/custom-ui";
import {
  Checkbox,
  EmptyState,
  HelpTooltip,
  PnL,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { WorkspaceContextChip } from "@/components/WorkspaceContextChip";
import { PendingApprovalsPanel } from "@/components/approvals/PendingApprovalsPanel";
import { fmt } from "@/lib/formatters";
import { formatIpcError } from "@/lib/ipc-error";
import {
  api,
  type ExperienceScorecardSummary,
  type SessionSummary,
} from "@/lib/exva";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { useSessionStore } from "@/store/sessionStore";
import { useTradeStore } from "@/store/tradeStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { cn } from "@/lib/utils";
import type { ApprovalSummary, Trade } from "@/lib/types";
import {
  HubBody,
  HubFrame,
  HubHeader,
  HubPane,
  HubQueryError,
  HubStatusStrip,
} from "./dna";
import { EquityCurvePanel } from "./panels/equity-curve-panel";
import { KillSwitchPanel } from "./panels/kill-switch-panel";
import { MorningBriefingPanel } from "./panels/morning-briefing-panel";
/**
 * Journey: arrive → hero P&L + equity curve → clear attention queue →
 * scan recent trades and sessions → leave knowing what needs a tap.
 */
export function DashboardHub() {
  const stats = useSessionStore((s) => s.stats);
  const trades = useTradeStore((s) => s.trades);
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const preferences = useWorkspaceStore((s) => s.preferences);
  const setViewMode = useWorkspaceStore((s) => s.setViewMode);
  const loadWorkspaceView = useWorkspaceStore((s) => s.loadWorkspaceView);
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [approvalList, setApprovalList] = useState<{
    workspaceViewMode: "session" | "global";
    approvals: ApprovalSummary[];
  }>({ workspaceViewMode: "session", approvals: [] });
  const [scorecards, setScorecards] = useState<ExperienceScorecardSummary[]>(
    [],
  );
  const [scorecardsError, setScorecardsError] = useState<string | null>(null);
  const [backupLabel, setBackupLabel] = useState("—");
  const [sinkOk, setSinkOk] = useState(true);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);

  const refreshSessions = useCallback(() => {
    void api
      .listSessions({
        includeArchived: preferences?.globalIncludeArchived ?? false,
        executionMode:
          environmentMode === "live" ? "live_allowed" : "paper_only",
      })
      .then((res) => {
        setSessions(res.sessions);
        setSessionsError(null);
      })
      .catch((err) => {
        setSessionsError(formatIpcError(err).display);
        setSessions([]);
      });
  }, [environmentMode, preferences?.globalIncludeArchived]);

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
    setSessions([]);
    refreshSessions();
  }, [refreshSessions]);

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

  useExvaEvent("approval_required", () => refreshApprovals());
  useExvaEvent("approval_resolved", () => refreshApprovals());
  useExvaEvent("session_status_changed", () => refreshSessions());
  useExvaEvent("stats_update", () => refreshSessions());

  if (!stats) {
    return (
      <HubFrame>
        <div className="flex flex-1 items-center justify-center font-sans text-body text-text3">
          Loading…
        </div>
      </HubFrame>
    );
  }

  const pendingApprovals = approvalList.approvals.filter(
    (a) => a.status === "pending",
  );
  const attentionSessions = sessions.filter(
    (s) => s.status === "attention_required",
  );
  const needsAttention =
    pendingApprovals.length > 0 || attentionSessions.length > 0;
  const pnlPctTone =
    stats.daily_pnl_pct > 0
      ? "text-success"
      : stats.daily_pnl_pct < 0
        ? "text-error"
        : "text-text2";
  const spendWarn =
    stats.api_budget > 0 && stats.daily_api_spend / stats.api_budget > 0.8;

  return (
    <HubFrame>
      <HubHeader
        eyebrow="Control room"
        title="Dashboard"
        subtitle={
          viewMode === "global"
            ? "Portfolio pulse, attention queue, and session roster."
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

      <HubBody scroll className="flex flex-col gap-3 p-4">
        <div className="grid min-h-[260px] grid-cols-1 gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <PnLTodayCard
            dailyPnlUsd={stats.daily_pnl_usd}
            dailyPnlPct={stats.daily_pnl_pct}
            pnlPctTone={pnlPctTone}
            openTrades={stats.open_trades}
            winRateToday={stats.win_rate_today}
            dailyApiSpend={stats.daily_api_spend}
            pendingCount={pendingApprovals.length}
            spendWarn={spendWarn}
          />
          <HubPane eyebrow="Portfolio" title="Equity curve">
            <EquityCurvePanel />
          </HubPane>
        </div>

        {needsAttention ? (
          <NeedsAttentionSection
            attentionSessions={attentionSessions}
            approvalsError={approvalsError}
            pendingApprovals={pendingApprovals}
            approvalWorkspaceViewMode={approvalList.workspaceViewMode}
            onRefreshApprovals={refreshApprovals}
            onFocusSession={async (id) => {
              await api.focusSession(id);
              await loadWorkspaceView();
            }}
          />
        ) : null}

        <div className="grid min-h-[360px] grid-cols-1">
          <RecentTradesPanel
            trades={trades}
            emptyDay={stats.total_trades_today === 0}
          />
        </div>
        <SessionsColumn
          sessions={sessions}
          sessionsError={sessionsError}
          scorecards={scorecards}
          scorecardsError={scorecardsError}
          viewMode={viewMode}
          includeArchived={preferences?.globalIncludeArchived ?? false}
          onRetrySessions={refreshSessions}
          onRetryScorecards={() => {
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
          onToggleArchived={async (checked) => {
            await api.patchWorkspacePreferences({
              globalIncludeArchived: checked,
            });
            await loadWorkspaceView();
          }}
          onFocusSession={async (id) => {
            await api.focusSession(id);
            await loadWorkspaceView();
          }}
        />
        <div className="grid min-h-[320px] grid-cols-1 gap-3 lg:grid-cols-2">
          <MorningBriefingPanel />
          <KillSwitchPanel />
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
            value: String(pendingApprovals.length),
            ok: pendingApprovals.length === 0,
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

function PnLTodayCard({
  dailyPnlUsd,
  dailyPnlPct,
  pnlPctTone,
  openTrades,
  winRateToday,
  dailyApiSpend,
  pendingCount,
  spendWarn,
}: {
  dailyPnlUsd: number;
  dailyPnlPct: number;
  pnlPctTone: string;
  openTrades: number;
  winRateToday: number;
  dailyApiSpend: number;
  pendingCount: number;
  spendWarn: boolean;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-surface">
      <div className="shrink-0 border-b border-hairline px-4 py-2.5">
        <div className="font-mono text-micro uppercase tracking-wider text-text3">
          Performance
        </div>
        <h2 className="m-0 font-sans text-head text-text1">P&amp;L today</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <PnL value={dailyPnlUsd} size="hero" />
          <span className={cn("font-mono text-stat tabular-nums", pnlPctTone)}>
            {fmt.pct(dailyPnlPct)}
          </span>
        </div>
        <div className="mt-4 border-t border-hairline pt-3">
          <p className="m-0 font-mono text-micro uppercase tracking-wider text-text2">
            <span className="text-text3">POS</span>{" "}
            <span className="text-data text-text1">{openTrades}</span>
            <span className="mx-2 text-text3">·</span>
            <span className="text-text3">WIN</span>{" "}
            <span className="text-data text-text1">
              {Math.round(winRateToday * 100)}%
            </span>
            <span className="mx-2 text-text3">·</span>
            <span className="text-text3">SPEND</span>{" "}
            <span
              className={cn(
                "text-data",
                spendWarn ? "text-warning" : "text-text1",
              )}
            >
              {fmt.usd(dailyApiSpend)}
            </span>
            <span className="mx-2 text-text3">·</span>
            <span className="text-text3">PENDING</span>{" "}
            <span
              className={cn(
                "text-data",
                pendingCount > 0 ? "text-warning" : "text-text1",
              )}
            >
              {pendingCount}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

function NeedsAttentionSection({
  attentionSessions,
  approvalsError,
  pendingApprovals,
  approvalWorkspaceViewMode,
  onRefreshApprovals,
  onFocusSession,
}: {
  attentionSessions: SessionSummary[];
  approvalsError: string | null;
  pendingApprovals: ApprovalSummary[];
  approvalWorkspaceViewMode: "session" | "global";
  onRefreshApprovals: () => void;
  onFocusSession: (id: string) => void | Promise<void>;
}) {
  return (
    <section className="rounded-sm border border-error-border bg-error-dim">
      <div className="border-b border-error-border px-4 py-3">
        <SectionHeader
          eyebrow="Queue"
          title="Needs attention"
          className="mb-0"
        />
      </div>
      <div className="flex flex-col gap-3 p-4">
        {attentionSessions.length > 0 ? (
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {attentionSessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => void onFocusSession(session.id)}
                  className="flex w-full flex-col gap-1 rounded-sm border border-error-border bg-surface px-3 py-2.5 text-left transition-colors duration-hover hover:bg-surface2"
                >
                  <span className="truncate font-sans text-body font-medium text-text1">
                    {session.name}
                  </span>
                  <span className="font-mono text-micro uppercase tracking-wider text-error">
                    Needs attention
                  </span>
                  <span className="font-mono text-caption text-text3">
                    {session.executionMode === "live_allowed"
                      ? "Live"
                      : "Paper"}
                    {session.openTradeCount > 0
                      ? ` · ${session.openTradeCount} open`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {approvalsError ? (
          <HubQueryError
            message={approvalsError}
            onRetry={onRefreshApprovals}
            className="m-0"
          />
        ) : pendingApprovals.length > 0 ? (
          <PendingApprovalsPanel
            approvals={pendingApprovals}
            workspaceViewMode={approvalWorkspaceViewMode}
            onRefresh={onRefreshApprovals}
            onDecide={(input) => api.decideApproval(input)}
          />
        ) : null}
      </div>
    </section>
  );
}

function RecentTradesPanel({
  trades,
  emptyDay,
}: {
  trades: Trade[];
  emptyDay: boolean;
}) {
  const setSelected = useTradeStore((s) => s.setSelected);
  const selectedId = useTradeStore((s) => s.selectedId);

  const recent = trades
    .filter((t) => t.status !== "no_trade")
    .toSorted((a, b) => {
      const at = a.opened_at ? new Date(a.opened_at).getTime() : 0;
      const bt = b.opened_at ? new Date(b.opened_at).getTime() : 0;
      return bt - at;
    })
    .slice(0, 10);

  return (
    <HubPane eyebrow="Activity" title="Recent trades">
      {emptyDay ? (
        <div className="p-4">
          <EmptyState message="No trades yet today. The pipeline runs automatically while a session is active." />
        </div>
      ) : recent.length === 0 ? (
        <EmptyState
          centered
          title="No trades to show"
          message="Trades appear here as the pipeline opens and closes positions."
          className="py-8"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Instrument</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">P&amp;L</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((trade) => (
              <TradeTableRow
                key={trade.id}
                trade={trade}
                selected={trade.id === selectedId}
                onSelect={() => setSelected(trade.id)}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </HubPane>
  );
}

function TradeTableRow({
  trade,
  selected,
  onSelect,
}: {
  trade: Trade;
  selected: boolean;
  onSelect: () => void;
}) {
  const isOpen = trade.status === "open";
  const pnl = (isOpen ? trade.unrealized_pnl : trade.final_pnl_usd) ?? null;

  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className={cn("cursor-pointer", selected && "bg-surface2")}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      role="button"
    >
      <TableCell>
        <span className="font-mono text-data font-semibold text-text1">
          {trade.instrumentSymbol}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={trade.side === "BUY" ? "success" : "danger"} size="sm">
          {trade.side}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <PnL value={pnl} size="body" />
      </TableCell>
      <TableCell>
        <Badge variant={isOpen ? "success" : "default"} size="sm">
          {trade.status}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-mono text-data text-text3">
        {trade.opened_at ? fmt.time(trade.opened_at) : "—"}
      </TableCell>
    </TableRow>
  );
}

function SessionsColumn({
  sessions,
  sessionsError,
  scorecards,
  scorecardsError,
  viewMode,
  includeArchived,
  onRetrySessions,
  onRetryScorecards,
  onToggleArchived,
  onFocusSession,
}: {
  sessions: SessionSummary[];
  sessionsError: string | null;
  scorecards: ExperienceScorecardSummary[];
  scorecardsError: string | null;
  viewMode: "session" | "global";
  includeArchived: boolean;
  onRetrySessions: () => void;
  onRetryScorecards: () => void;
  onToggleArchived: (checked: boolean) => void | Promise<void>;
  onFocusSession: (id: string) => void | Promise<void>;
}) {
  const ready = scorecards.filter((s) => s.meetsPromotion);
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.isFocused !== b.isFocused) return a.isFocused ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return (
    <div className="grid min-h-[360px] min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
      <HubPane
        eyebrow="Roster"
        title="Sessions"
        actions={
          viewMode === "global" ? (
            <label className="flex cursor-pointer items-center gap-2 font-sans text-caption text-text2">
              <Checkbox
                checked={includeArchived}
                onCheckedChange={(checked) =>
                  void onToggleArchived(checked === true)
                }
              />
              Archived
            </label>
          ) : null
        }
      >
        {sessionsError ? (
          <HubQueryError message={sessionsError} onRetry={onRetrySessions} />
        ) : sortedSessions.length === 0 ? (
          <EmptyState
            centered
            title="No sessions"
            message="Create a session from the Sessions hub to start the pipeline."
            className="py-6"
          />
        ) : (
          <ul className="m-0 list-none divide-y divide-hairline p-0">
            {sortedSessions.slice(0, 8).map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => void onFocusSession(session.id)}
                  className={cn(
                    "flex w-full items-start justify-between gap-2 px-4 py-2.5 text-left transition-colors duration-hover hover:bg-surface2",
                    session.isFocused && "bg-surface2",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate font-sans text-body font-medium text-text1">
                      {session.name}
                    </div>
                    <div className="mt-0.5 font-mono text-caption text-text3">
                      {session.executionMode === "live_allowed"
                        ? "Live"
                        : "Paper"}
                      {session.openTradeCount > 0
                        ? ` · ${session.openTradeCount} open`
                        : ""}
                    </div>
                  </div>
                  <SessionStatusBadge status={session.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </HubPane>

      <HubPane
        eyebrow="Ladder"
        title="Promotion ready"
        actions={
          <Badge variant={ready.length > 0 ? "success" : "default"} size="sm">
            {ready.length} ready
          </Badge>
        }
      >
        {scorecardsError ? (
          <HubQueryError
            message={scorecardsError}
            onRetry={onRetryScorecards}
          />
        ) : (
          <PromotionLadder scorecards={scorecards} />
        )}
      </HubPane>
    </div>
  );
}

function SessionStatusBadge({ status }: { status: SessionSummary["status"] }) {
  if (status === "active") {
    return (
      <Badge variant="success" size="sm">
        Active
      </Badge>
    );
  }
  if (status === "attention_required") {
    return (
      <Badge variant="danger" size="sm">
        Attention
      </Badge>
    );
  }
  if (status === "paused") {
    return (
      <Badge variant="warn" size="sm">
        Paused
      </Badge>
    );
  }
  return (
    <Badge variant="default" size="sm">
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

function PromotionLadder({
  scorecards,
}: {
  scorecards: ExperienceScorecardSummary[];
}) {
  const sorted = [...scorecards].sort(
    (a, b) => Number(b.meetsPromotion) - Number(a.meetsPromotion),
  );

  if (sorted.length === 0) {
    return (
      <EmptyState
        centered
        title="No scorecards yet"
        message="Paper sessions populate the promotion ladder."
        className="py-6"
      />
    );
  }

  return (
    <ul className="m-0 list-none divide-y divide-hairline p-0">
      {sorted.slice(0, 5).map((row) => (
        <li
          key={row.experienceId}
          className="flex items-center justify-between gap-2 px-4 py-2.5"
        >
          <div className="min-w-0">
            <div className="truncate font-sans text-body font-medium text-text1">
              {row.displayName}
            </div>
            <div className="font-mono text-caption capitalize text-text3">
              {row.promotionTier} · {row.tradeCount} trades
            </div>
          </div>
          {row.meetsPromotion ? (
            <span className="shrink-0 font-mono text-micro font-semibold uppercase tracking-wider text-success">
              Promote
            </span>
          ) : (
            <span className="max-w-[120px] truncate text-right font-sans text-caption text-text3">
              {row.failedPromotionCriteria[0] ?? "Building"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
